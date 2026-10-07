// Reproduce ChatGPT sign-in as a phone runs it: no instrumentation (an instrumented process is
// treated as foreground), a real browser in front of Research Bot while the researcher reads the
// consent page, then the loopback callback. The authorization code is a dummy, so the token server
// can only reject it; the check is whether the native token POST reaches the server at all.
// Only fixed reason codes, HTTP statuses and process states are printed, never the callback URL.
//
//   node scripts/android-background-exchange.mjs <debug.apk> [--consent-seconds=N] [--data-saver]
//
// --data-saver leaves only the emulator's metered cellular network and turns on Data Saver, an
// Android policy that blocks networking for apps that are not in the foreground.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';

const apk = process.argv[2];
assert.ok(apk, 'Pass a debuggable APK (WebView debugging is enabled only in debug builds)');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}`));
const consentSeconds = Number((option('consent-seconds') ?? '--consent-seconds=75').split('=')[1]);
const dataSaver = Boolean(option('data-saver'));
const packageName = 'com.researchbot.android';
const activity = `${packageName}/.MainActivity`;
const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (...args) =>
  execFileSync('adb', [...serialArgs, ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
const shell = command => {
  try {
    return adb('shell', command).trim();
  } catch (error) {
    return `(unavailable: ${String(error.status ?? 'error')})`;
  }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const label = `${dataSaver ? 'data-saver' : 'stock'} ${consentSeconds}s`;

let uid = '';
function processState() {
  const state = shell(`cmd activity get-uid-state ${uid}`).split('\n')[0];
  const top = shell('dumpsys activity activities')
    .split('\n')
    .filter(line => /topResumedActivity|mResumedActivity/.test(line))
    .map(line => (line.match(/[\w.]+\/[\w.$]+/) ?? ['?'])[0])
    .slice(0, 1)
    .join('');
  const policy = shell('dumpsys netpolicy')
    .split('\n')
    .filter(line => line.includes(`uid=${uid}`) || line.includes(`UID=${uid}`))
    .map(line => line.trim())
    .slice(0, 4)
    .join(' | ');
  return `uid-state=${state}; top=${top}; netpolicy=${policy || 'none'}`;
}

function forward(remote) {
  const local = adb('forward', 'tcp:0', remote).trim();
  return Number(local);
}

class DevTools {
  static async open(port) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        const page = pages.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) {
          const socket = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', reject, { once: true });
          });
          return new DevTools(socket);
        }
      } catch {
        /* The WebView may still be starting. */
      }
      await pause(1_000);
    }
    throw new Error('The Research Bot WebView did not expose DevTools');
  }

  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.waiting = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const request = this.waiting.get(message.id);
      if (!request) return;
      this.waiting.delete(message.id);
      request(message);
    });
  }

  async evaluate(expression) {
    const id = this.next++;
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools evaluation timed out')), 60_000);
      this.waiting.set(id, value => {
        clearTimeout(timer);
        resolve(value);
      });
      this.socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    if (message.error || message.result?.exceptionDetails) throw new Error('A DevTools evaluation failed');
    return message.result.result.value;
  }

  async waitFor(expression, seconds) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await pause(500);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  }

  close() {
    this.socket.close();
  }
}

/** Send the browser's callback request through adb (the device's 127.0.0.1) and read the reply. */
function deliverCallback(port, target) {
  const local = forward(`tcp:${port}`);
  return new Promise((resolve, reject) => {
    const socket = connect(local, '127.0.0.1');
    let reply = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('The loopback callback did not answer'));
    }, 120_000);
    socket.on('connect', () => socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    socket.on('data', chunk => (reply += chunk.toString('utf8')));
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      adb('forward', '--remove', `tcp:${local}`);
      resolve(reply);
    });
  });
}

const safeReason = text => (text.match(/RB-AUTH-[A-Z-]+/) ?? ['no RB-AUTH reason'])[0];

async function main() {
  adb('install', '-r', apk);
  shell(`pm clear ${packageName}`);
  uid = (adb('shell', 'pm', 'list', 'packages', '-U', packageName).match(/uid:(\d+)/) ?? [])[1];
  assert.ok(uid, 'Research Bot is not installed');
  if (dataSaver) {
    shell('svc wifi disable');
    shell('svc data enable');
    shell('cmd netpolicy set restrict-background true');
    await pause(5_000);
  }
  console.log(
    `[${label}] Android ${shell('getprop ro.build.version.release')} (SDK ${shell('getprop ro.build.version.sdk')})`,
  );
  console.log(
    `[${label}] WebView ${shell('dumpsys webviewupdate').match(/Current WebView package \(name, version\): \(([^)]*)\)/)?.[1] ?? '?'}`,
  );
  console.log(`[${label}] restrict-background: ${shell('cmd netpolicy get restrict-background')}`);

  shell(`am start -W -n ${activity}`);
  await pause(3_000);
  const pid = shell(`pidof ${packageName}`);
  const devtools = await DevTools.open(forward(`localabstract:webview_devtools_remote_${pid}`));
  try {
    await devtools.waitFor('window.research && window.Capacitor && window.Capacitor.nativePromise', 60);

    // The same opt-in check the phone ran, while Research Bot is in front. A freshly booted
    // emulator may not have a usable network yet, so wait for it rather than test nothing.
    let check = [];
    for (let attempt = 0; attempt < 9; attempt++) {
      check = await devtools.evaluate(
        'window.research.checkSignInConnection(new AbortController().signal).then(r => r.checks.map(c => `${c.service}: ${c.result}`))',
      );
      if (check[0]?.endsWith('HTTP 200')) break;
      console.log(`[${label}] network not ready yet: ${check.join('; ')}`);
      await pause(10_000);
    }
    assert.ok(check[0]?.endsWith('HTTP 200'), 'The emulator network never became usable in the foreground');
    console.log(`[${label}] foreground connection check: ${check.join('; ')}`);
    console.log(`[${label}] foreground: ${processState()}`);

    await devtools.evaluate(`
      window.__qaAuthorize = null; window.__qaToken = null; window.__qaResult = null;
      const original = window.Capacitor.nativePromise.bind(window.Capacitor);
      window.Capacitor.nativePromise = async (plugin, method, options) => {
        if (plugin === 'ResearchNative' && method === 'openUrl' && !window.__qaAuthorize) {
          window.__qaAuthorize = options.url;
          // A real browser opens in front of the app, on a public page instead of account consent.
          return original(plugin, method, {url: 'https://auth.openai.com/.well-known/openid-configuration'});
        }
        if (plugin === 'ResearchNative' && method === 'openUrl') {
          // The token server rejected the dummy code as invalid_grant, so the app starts one fresh
          // authorization, as it should. That proves the exchange got an answer; stop here.
          window.__qaResult = window.__qaResult || 'fresh attempt after invalid_grant';
          return;
        }
        if (plugin === 'ResearchNative' && method === 'httpOpen' &&
            options.url === 'https://auth.openai.com/api/accounts/oauth/token' && !window.__qaToken) {
          const started = Date.now();
          try {
            const head = await original(plugin, method, options);
            window.__qaToken = {status: head.status, ms: Date.now() - started};
            return head;
          } catch (error) {
            window.__qaToken = {code: String(error.code || 'unknown'), ms: Date.now() - started};
            throw error;
          }
        }
        return original(plugin, method, options);
      };
      window.research.signIn().then(
        () => { window.__qaResult = 'unexpected success'; },
        error => { window.__qaResult = (String(error.message).match(/RB-AUTH-[A-Z-]+/) || ['no reason'])[0]; }
      );
      true;
    `);
    await devtools.waitFor('window.__qaAuthorize', 30);
    // Kept in memory only; never printed.
    const callback = await devtools.evaluate(`(() => {
      const u = new URL(window.__qaAuthorize);
      const r = new URL(u.searchParams.get('redirect_uri'));
      r.search = new URLSearchParams({state: u.searchParams.get('state'), code: 'synthetic-invalid-code',
        client_id: 'oaiapp_background_exchange_fixture'});
      return {port: Number(r.port), target: r.pathname + r.search};
    })()`);

    await pause(3_000);
    console.log(`[${label}] browser opened: ${processState()}`);
    for (let waited = 0; waited < consentSeconds; waited += 15) {
      await pause(Math.min(15, consentSeconds - waited) * 1000);
      console.log(`[${label}] consent +${Math.min(waited + 15, consentSeconds)}s: ${processState()}`);
    }

    const delivery = deliverCallback(callback.port, callback.target);
    const held = await Promise.race([delivery.then(() => false), pause(15_000).then(() => true)]);
    if (held) {
      // Android froze the cached app, so the browser's request waits. A researcher switches back.
      console.log(`[${label}] callback held while Research Bot was frozen: ${processState()}`);
      shell(`am start -n ${activity}`);
    }
    const reply = await delivery;
    console.log(`[${label}] browser callback reply: ${reply.split('\r\n')[0]} (${safeReason(reply)})`);

    let returned = false;
    for (let waited = 0; waited < 10 && !returned; waited++) {
      await pause(1_000);
      returned = processState().includes(`top=${packageName}/`);
    }
    console.log(`[${label}] Research Bot returned to the front by itself: ${returned ? 'yes' : 'no'}`);
    // A researcher who is not returned automatically switches back to the app.
    if (!returned) shell(`am start -n ${activity}`);
    await devtools.waitFor('window.__qaToken', 90);
    const token = await devtools.evaluate('window.__qaToken');
    await devtools.waitFor('window.__qaResult', 60);
    const result = await devtools.evaluate('window.__qaResult');
    console.log(`[${label}] after return: ${processState()}`);
    console.log(
      `[${label}] native token POST: ${token.status ? `HTTP ${token.status}` : token.code} after ${token.ms} ms; sign-in result ${result}`,
    );
    await devtools.evaluate('window.research.cancelSignIn().then(() => true)').catch(() => undefined);
    assert.ok(result !== 'unexpected success', 'A dummy code must never connect an account');
    assert.ok(
      Number.isInteger(token.status) && token.status >= 400,
      `The token exchange after browser consent never reached the token server (${token.code}, ${result})`,
    );
    console.log(`[${label}] PASS: the token exchange reached the server after ${consentSeconds}s of browser consent`);
  } finally {
    devtools.close();
    if (dataSaver) {
      shell('cmd netpolicy set restrict-background false');
      shell('svc wifi enable');
    }
  }
}

await main();
