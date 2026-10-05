import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthService as CoreAuthService } from '../core/auth';
import type { CredentialStore, FileStore, StartLoopback } from '../core/platform';
import { fetchNetwork } from './network';

/** Private files under one directory, created with owner-only permissions. */
export function directoryFiles(directory: string): FileStore {
  let ready: Promise<unknown> | undefined;
  const prepare = () => (ready ??= mkdir(directory, { recursive: true, mode: 0o700 }));
  return {
    async read(name) {
      await prepare();
      try {
        return await readFile(join(directory, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async write(name, data) {
      await prepare();
      const destination = join(directory, name);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async remove(name) {
      await rm(join(directory, name), { force: true });
    },
  };
}

export const nodeLoopback: StartLoopback = async handler => {
  const server = createServer((request, response) => {
    let answered = false;
    handler({
      method: request.method ?? '',
      url: request.url ?? '',
      respond(status, body) {
        if (answered || response.headersSent) return;
        answered = true;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'none'");
        response.writeHead(status).end(body);
      },
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('The local ChatGPT callback could not start.');
  }
  return {
    port: address.port,
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
};

/** The desktop auth service: files in `directory`, the system browser, and Electron safeStorage. */
export class AuthService extends CoreAuthService {
  constructor(directory: string, openBrowser: (url: string) => Promise<void>, credentialStore: CredentialStore) {
    super({
      fetch: fetchNetwork,
      files: directoryFiles(directory),
      openBrowser,
      credentials: credentialStore,
      startLoopback: nodeLoopback,
    });
  }
}
