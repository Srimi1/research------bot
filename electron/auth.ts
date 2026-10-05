import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import type { Account } from '../src/shared/types';
import { fetchNetwork, readLimited, requestJson } from './network';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SIGN_IN_MS = 5 * 60_000;
interface CredentialStore {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}
interface Registration {
  issuer: string;
  subject: string;
  clientId: string;
  name?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  scopes: string[];
  expiresAt: number;
}
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}
interface Metadata { issuer: string; jwks_uri: string; revocation_endpoint: string; }
interface Pending {
  controller: AbortController;
  server: Server;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function randomSecret(): string { return randomBytes(32).toString('base64url'); }
function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cancellation(): Error { return new Error('ChatGPT sign-in was cancelled.'); }
function validatedClient(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length < 256 && !/\s/.test(value) && value !== 'dynamic_agent_client';
}
function publicError(code: unknown): string {
  switch (code) {
    case 'access_denied': return 'ChatGPT authorization was declined. Enable app access in ChatGPT Settings to continue.';
    case 'invalid_grant': return 'This ChatGPT session has expired or was revoked. Continue with ChatGPT again.';
    case 'subscription_sharing_usage_limit_exceeded': return 'The ChatGPT usage allowance for this app has been reached. Review your limits in ChatGPT Settings → Usage.';
    case 'subscription_sharing_usage_unavailable': return 'ChatGPT plan usage is currently unavailable. Review app access in ChatGPT Settings → Usage.';
    default: return 'ChatGPT could not complete this request. Try again or review app access in ChatGPT Settings.';
  }
}

/** Credentials and OAuth traffic never cross the Electron renderer boundary. */
export class AuthService {
  private registration?: Registration;
  private hostId = '';
  private loaded?: Promise<void>;
  private loadMessage?: string;
  private metadataPromise?: Promise<Metadata>;
  private jwksPromise?: Promise<ReturnType<typeof createLocalJWKSet>>;
  private refreshPromise?: Promise<string>;
  private pending?: Pending;
  private epoch = 0;
  private session = new AbortController();
  private signOutMessage?: string;
  private credentialWrites: Promise<void> = Promise.resolve();
  private signInCancellation = 0;
  private signInActive = false;
  private recoveryClientId?: string;

  constructor(private directory: string, private openBrowser: (url: string) => Promise<void>, private credentialStore: CredentialStore) {}

  private async initialize(): Promise<void> {
    if (!this.loaded) this.loaded = (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      try {
        const saved = JSON.parse(await readFile(join(this.directory, 'host.json'), 'utf8')) as { id?: unknown };
        if (typeof saved.id !== 'string' || !/^urn:uuid:[0-9a-f-]{36}$/i.test(saved.id)) throw new Error('Invalid host identity.');
        this.hostId = saved.id;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Research Bot’s host identity could not be read.');
        this.hostId = `urn:uuid:${randomUUID()}`;
        await this.atomicWrite('host.json', Buffer.from(JSON.stringify({ id: this.hostId })));
      }
      if (!this.credentialStore.available()) return;
      try {
        const value = JSON.parse(this.credentialStore.decrypt(await readFile(join(this.directory, 'account.enc')))) as Registration;
        if (value.issuer !== ISSUER || typeof value.subject !== 'string' || !value.subject || !validatedClient(value.clientId)
          || !Array.isArray(value.scopes) || !value.scopes.every(item => typeof item === 'string')
          || !Number.isFinite(value.expiresAt)
          || [value.accessToken, value.refreshToken, value.idToken, value.email, value.name].some(item => item !== undefined && typeof item !== 'string')) {
          throw new Error('Invalid credential record.');
        }
        this.registration = value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.loadMessage = 'Saved ChatGPT credentials could not be unlocked. Continue with ChatGPT to reconnect.';
      }
    })();
    await this.loaded;
  }

  private async atomicWrite(name: string, data: Buffer): Promise<void> {
    const destination = join(this.directory, name);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination);
    } finally { await rm(temporary, { force: true }); }
  }
  private async persist(registration: Registration, valid: () => boolean = () => true): Promise<void> {
    const operation = this.credentialWrites.then(async () => {
      if (!this.credentialStore.available()) throw new Error('Encrypted system credential storage is unavailable. ChatGPT sign-in requires an OS keychain.');
      if (!valid()) throw cancellation();
      await this.atomicWrite('account.enc', this.credentialStore.encrypt(JSON.stringify(registration)));
      // Cancellation/sign-out can happen during an asynchronous file write. Undo
      // that write before releasing the credential queue so old tokens cannot return.
      if (!valid()) {
        if (this.registration) await this.atomicWrite('account.enc', this.credentialStore.encrypt(JSON.stringify(this.registration)));
        else await rm(join(this.directory, 'account.enc'), { force: true });
        throw cancellation();
      }
    });
    this.credentialWrites = operation.catch(() => undefined);
    await operation;
  }

  async account(): Promise<Account> {
    await this.initialize();
    const value = this.registration;
    const signedIn = Boolean(value?.accessToken && (value.expiresAt > Date.now() || value.refreshToken));
    return {
      signedIn,
      storageAvailable: this.credentialStore.available(),
      ...(value?.name ? { name: value.name } : {}),
      ...(value?.email ? { email: value.email } : {}),
      message: !this.credentialStore.available() ? 'An OS keychain is required to store ChatGPT credentials securely.'
        : this.signOutMessage ?? this.loadMessage ?? (signedIn && !value?.scopes.includes(PLAN_SCOPE)
          ? 'Your identity is connected, but ChatGPT plan usage is not authorized. Enable app access in ChatGPT Settings → Usage.' : undefined),
    };
  }

  private async metadata(): Promise<Metadata> {
    if (!this.metadataPromise) this.metadataPromise = requestJson<Metadata>(`${ISSUER}/.well-known/openid-configuration`).then(value => {
      if (value.issuer !== ISSUER || value.jwks_uri !== `${ISSUER}/.well-known/jwks.json`
        || new URL(value.revocation_endpoint).origin !== ISSUER || !value.revocation_endpoint.startsWith(`${ISSUER}/`)) {
        throw new Error('ChatGPT identity metadata did not match its trusted issuer.');
      }
      return value;
    }).catch(error => { this.metadataPromise = undefined; throw error; });
    return this.metadataPromise;
  }

  private async verifyIdentity(token: string, clientId: string, nonce?: string, retried = false): Promise<JWTPayload> {
    if (!this.jwksPromise) this.jwksPromise = this.metadata().then(async metadata => createLocalJWKSet(await requestJson<JSONWebKeySet>(metadata.jwks_uri)))
      .catch(error => { this.jwksPromise = undefined; throw error; });
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, await this.jwksPromise, { issuer: ISSUER, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'] }));
    } catch (error) {
      // A key rotation may happen during a long-running app session. Refetch once.
      if (retried || (error as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw new Error('ChatGPT identity verification failed. Start a new sign-in.');
      this.jwksPromise = undefined;
      return this.verifyIdentity(token, clientId, nonce, true);
    }
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce !== undefined && (typeof payload.nonce !== 'string' || !constantEqual(payload.nonce, nonce)))) {
      throw new Error('ChatGPT identity verification failed. Start a new sign-in.');
    }
    return payload;
  }

  private async tokenRequest(body: URLSearchParams, signal: AbortSignal): Promise<TokenResponse> {
    const response = await fetchNetwork(TOKEN, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    let value: unknown;
    try { value = JSON.parse(await readLimited(response, 1_000_000)); }
    catch { throw new Error(`ChatGPT returned an invalid authorization response (HTTP ${response.status}).`); }
    if (!response.ok) {
      const code = (value as { error?: unknown })?.error;
      const error = new Error(publicError(code));
      Object.assign(error, { oauthCode: code });
      throw error;
    }
    const token = value as TokenResponse;
    if (!token || typeof token !== 'object' || typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer'
      || !Number.isFinite(token.expires_in) || token.expires_in <= 0
      || (token.scope !== undefined && typeof token.scope !== 'string')
      || (token.refresh_token !== undefined && typeof token.refresh_token !== 'string')
      || (token.id_token !== undefined && typeof token.id_token !== 'string')) {
      throw new Error('ChatGPT returned an invalid credential response.');
    }
    return token;
  }

  async signIn(): Promise<Account> {
    if (this.signInActive) throw new Error('A ChatGPT sign-in is already in progress.');
    this.signInActive = true;
    const cancellationGeneration = this.signInCancellation;
    try {
      try { return await this.performSignIn(); }
      catch (error) {
        // Authorization codes are one-use. Start one fresh browser authorization
        // with the issued client retained, rather than reusing an invalid code.
        if ((error as { oauthCode?: string }).oauthCode !== 'invalid_grant' || cancellationGeneration !== this.signInCancellation) throw error;
        return await this.performSignIn();
      }
    } finally { this.signInActive = false; }
  }

  private async performSignIn(): Promise<Account> {
    const cancellationGeneration = this.signInCancellation;
    await this.initialize();
    if (cancellationGeneration !== this.signInCancellation) throw cancellation();
    if (!this.credentialStore.available()) throw new Error('Encrypted system credential storage is unavailable. Enable an OS keychain before signing in.');
    if (this.pending) throw new Error('A ChatGPT sign-in is already in progress.');
    const previous = this.registration;
    const requestedClientId = previous?.clientId ?? this.recoveryClientId;
    const state = randomSecret(); const nonce = randomSecret(); const verifier = randomSecret();
    const controller = new AbortController();
    const epoch = this.epoch;
    let finish!: () => void;
    let reject!: (error: Error) => void;
    const result = new Promise<void>((resolve, rejectResult) => { finish = resolve; reject = rejectResult; });
    // Attach a handler immediately, including while the browser opens asynchronously.
    void result.catch(() => undefined);
    let callbackUsed = false;
    let redirectUri = '';
    const server = createServer((request, response) => {
      void (async () => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'none'");
        const url = new URL(request.url ?? '', redirectUri);
        if (request.method !== 'GET' || url.pathname !== '/auth/callback') { response.writeHead(404).end('Not found'); return; }
        if (url.searchParams.getAll('state').length !== 1 || !constantEqual(url.searchParams.get('state') ?? '', state)) {
          response.writeHead(400).end('Authorization state did not match. Return to Research Bot.'); return;
        }
        if (callbackUsed) { response.writeHead(400).end('This sign-in callback has already been used.'); return; }
        callbackUsed = true;
        try {
          if (url.searchParams.has('error')) throw new Error(publicError(url.searchParams.get('error')));
          const clientId = requestedClientId ?? url.searchParams.get('client_id');
          if (!validatedClient(clientId) || (requestedClientId && url.searchParams.has('client_id') && url.searchParams.get('client_id') !== requestedClientId)) {
            throw new Error('ChatGPT returned an unexpected client registration. Start a new sign-in.');
          }
          const code = url.searchParams.get('code');
          if (!code || code.length > 8192 || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1) throw new Error('ChatGPT did not return a valid authorization code.');
          let tokens: TokenResponse;
          try {
            tokens = await this.tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }), controller.signal);
          } catch (error) {
            if ((error as { oauthCode?: string }).oauthCode === 'invalid_grant') this.recoveryClientId = clientId;
            throw error;
          }
          if (!tokens.id_token) throw new Error('ChatGPT did not return an identity token.');
          const identity = await this.verifyIdentity(tokens.id_token, clientId, nonce);
          if (previous && identity.sub !== previous.subject) throw new Error('The signed-in ChatGPT account does not match this saved registration.');
          const registration: Registration = {
            issuer: ISSUER, subject: identity.sub!, clientId,
            ...(typeof identity.name === 'string' ? { name: identity.name } : {}),
            ...(typeof identity.email === 'string' ? { email: identity.email } : {}),
            accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
            scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? [], expiresAt: Date.now() + tokens.expires_in * 1000,
          };
          if (controller.signal.aborted || epoch !== this.epoch) throw cancellation();
          await this.persist(registration, () => !controller.signal.aborted && epoch === this.epoch);
          if (controller.signal.aborted || epoch !== this.epoch) throw cancellation();
          ++this.epoch; this.session.abort(); this.session = new AbortController();
          this.refreshPromise = undefined;
          this.registration = registration; this.recoveryClientId = undefined;
          this.loadMessage = undefined; this.signOutMessage = undefined;
          response.writeHead(200).end('ChatGPT is connected. You can close this tab and return to Research Bot.');
          finish();
        } catch (error) {
          response.writeHead(400).end('ChatGPT sign-in did not complete. Return to Research Bot to try again.');
          reject(error instanceof Error ? error : new Error('ChatGPT sign-in failed.'));
        }
      })().catch(() => { response.writeHead(400).end('Invalid callback.'); });
    });
    await new Promise<void>((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolve); });
    if (epoch !== this.epoch || cancellationGeneration !== this.signInCancellation) { server.close(); throw cancellation(); }
    const address = server.address();
    if (!address || typeof address === 'string') { server.close(); throw new Error('The local ChatGPT callback could not start.'); }
    redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const timer = setTimeout(() => { controller.abort(); reject(new Error('ChatGPT sign-in timed out. Continue with ChatGPT again.')); }, SIGN_IN_MS);
    this.pending = { controller, server, reject, timer };
    const authorize = new URL(AUTHORIZE);
    authorize.search = new URLSearchParams({
      client_id: requestedClientId ?? 'dynamic_agent_client', ext_agent_host_id: this.hostId,
      response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      ...(requestedClientId ? {} : { agent_name_hint: 'Research Bot' }),
      ...(previous?.idToken ? { id_token_hint: previous.idToken } : {}),
      ...(previous?.email ? { login_hint: previous.email } : {}),
    }).toString();
    try {
      try { await this.openBrowser(authorize.toString()); }
      catch { throw new Error('The system browser could not open ChatGPT sign-in. Try again from Research Bot.'); }
      await result;
      return await this.account();
    } finally {
      clearTimeout(timer); controller.abort(); server.close(); server.closeAllConnections();
      if (this.pending?.controller === controller) this.pending = undefined;
    }
  }

  cancelSignIn(): void {
    ++this.signInCancellation;
    const pending = this.pending;
    if (pending) { pending.controller.abort(); pending.reject(cancellation()); pending.server.close(); pending.server.closeAllConnections(); }
  }

  async signOut(): Promise<void> {
    await this.initialize();
    this.cancelSignIn();
    const epoch = ++this.epoch; this.session.abort(); this.session = new AbortController();
    this.refreshPromise = undefined;
    const registration = this.registration;
    // Stop local token use before attempting network revocation.
    this.registration = registration ? { ...registration, accessToken: undefined, refreshToken: undefined, idToken: undefined, scopes: [], expiresAt: 0 } : undefined;
    this.signOutMessage = undefined;
    if (this.registration) await this.persist(this.registration);
    if (!registration?.refreshToken) return;
    let revoked = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const metadata = await this.metadata();
        const response = await fetchNetwork(metadata.revocation_endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: registration.refreshToken, token_type_hint: 'refresh_token', client_id: registration.clientId }).toString(),
        });
        await response.body?.cancel();
        if (response.status === 200) { revoked = true; break; }
        if (response.status < 500) break;
      } catch { /* Retry transient network failure without exposing credentials. */ }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200 * 2 ** attempt));
    }
    if (!revoked && epoch === this.epoch) this.signOutMessage = 'Signed out locally. Remote session revocation was not confirmed; disconnect Research Bot in ChatGPT Settings.';
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    await this.initialize();
    const value = this.registration;
    if (!value?.accessToken) throw new Error('Continue with ChatGPT before using an AI assistant.');
    if (!value.scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT plan usage is not authorized. Enable app access in ChatGPT Settings → Usage.');
    if (!forceRefresh && value.expiresAt > Date.now() + 60_000) return value.accessToken;
    if (!value.refreshToken) throw new Error('The ChatGPT session has expired. Continue with ChatGPT again.');
    if (!this.refreshPromise) {
      const epoch = this.epoch;
      const signal = this.session.signal;
      const promise = (async () => {
        try {
          const tokens = await this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: value.clientId, refresh_token: value.refreshToken!, resource: RESOURCE }), signal);
          if (tokens.id_token) {
            const identity = await this.verifyIdentity(tokens.id_token, value.clientId);
            if (identity.sub !== value.subject) throw new Error('ChatGPT returned a different account during session renewal.');
          }
          const updated: Registration = {
            ...value, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? value.refreshToken,
            idToken: tokens.id_token ?? value.idToken, expiresAt: Date.now() + tokens.expires_in * 1000,
            scopes: tokens.scope === undefined ? value.scopes : tokens.scope.split(/\s+/).filter(Boolean),
          };
          if (signal.aborted || epoch !== this.epoch) throw new Error('ChatGPT session changed while renewing credentials.');
          await this.persist(updated, () => !signal.aborted && epoch === this.epoch);
          if (signal.aborted || epoch !== this.epoch) throw new Error('ChatGPT session changed while renewing credentials.');
          this.registration = updated;
          if (!updated.scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT plan usage permission was removed. Reauthorize the app in ChatGPT Settings.');
          return updated.accessToken!;
        } catch (error) {
          if ((error as { oauthCode?: string }).oauthCode === 'invalid_grant' && epoch === this.epoch) {
            this.registration = { ...value, accessToken: undefined, refreshToken: undefined, idToken: undefined, scopes: [], expiresAt: 0 };
            await this.persist(this.registration, () => epoch === this.epoch);
          }
          throw error;
        }
      })().finally(() => { if (this.refreshPromise === promise) this.refreshPromise = undefined; });
      this.refreshPromise = promise;
    }
    return this.refreshPromise;
  }

  private async authorized(url: string, init: RequestInit = {}): Promise<Response> {
    const sessionSignal = this.session.signal;
    const signal = init.signal ? AbortSignal.any([init.signal, sessionSignal]) : sessionSignal;
    let token = await this.accessToken();
    const send = () => fetchNetwork(url, { ...init, redirect: 'error', signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    let response = await send();
    if (response.status === 401) {
      await response.body?.cancel();
      token = await this.accessToken(true);
      response = await send();
    }
    if (!response.ok) {
      let code: unknown;
      try { code = (JSON.parse(await readLimited(response, 1_000_000)) as { error?: { code?: unknown } }).error?.code; } catch { /* Do not expose response bodies. */ }
      throw new Error(code ? publicError(code) : `ChatGPT request failed (HTTP ${response.status}). Review app access in ChatGPT Settings.`);
    }
    return response;
  }

  async models(): Promise<string[]> {
    const response = await this.authorized(`${RESOURCE}/models`, { signal: AbortSignal.timeout(30_000) });
    const value = JSON.parse(await readLimited(response, 2_000_000)) as { models?: { visibility?: string; slug?: string }[] };
    if (!Array.isArray(value.models)) throw new Error('ChatGPT returned an invalid model catalog.');
    return value.models.filter(model => model.visibility === 'list' && typeof model.slug === 'string' && model.slug.length > 0).map(model => model.slug!);
  }

  async stream(model: string, instructions: string, input: string, signal: AbortSignal, onDelta: (text: string) => void): Promise<{ text: string; usage?: { input: number; output: number } }> {
    const response = await this.authorized(`${RESOURCE}/responses`, {
      method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model, instructions, input: [{ role: 'user', content: input }], store: false, stream: true }),
    });
    if (!response.body) throw new Error('ChatGPT did not return a response stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = ''; let text = ''; let completed = false;
    let usage: { input: number; output: number } | undefined;
    function consume(block: string): void {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') return;
      const event = JSON.parse(data) as { type?: string; delta?: string; error?: { code?: string }; code?: string; response?: { error?: { code?: string }; usage?: { input_tokens?: number; output_tokens?: number } } };
      if (event.type === 'response.output_text.delta') {
        if (completed || typeof event.delta !== 'string') throw new Error('ChatGPT returned an invalid response stream.');
        text += event.delta;
        if (text.length > 10_000_000) throw new Error('ChatGPT output exceeded the size limit.');
        onDelta(event.delta);
      } else if (event.type === 'response.completed') {
        completed = true;
        const counts = event.response?.usage;
        if (counts && Number.isFinite(counts.input_tokens) && Number.isFinite(counts.output_tokens)) usage = { input: counts.input_tokens!, output: counts.output_tokens! };
      } else if (event.type === 'response.failed' || event.type === 'error') {
        throw new Error(publicError(event.response?.error?.code ?? event.error?.code ?? event.code));
      } else if (event.type === 'response.incomplete') {
        throw new Error('ChatGPT returned an incomplete response. Your input remains saved; retry the assistant.');
      }
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const block = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          consume(block);
        }
        if (buffer.length > 1_000_000) throw new Error('ChatGPT stream event exceeded the size limit.');
        if (done) { if (buffer.trim()) consume(buffer); break; }
      }
      if (!completed) throw new Error('ChatGPT stream ended before completion. Retry the assistant.');
      return { text, ...(usage ? { usage } : {}) };
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
