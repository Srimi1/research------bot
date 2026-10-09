// Normalize copy/paste wrappers only. The release task still verifies the private key and pinned certificate.
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function decodeKeystoreSecret(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ANDROID_KEYSTORE_BASE64 is missing.');
  if (value.length > 2_000_000) throw new Error('ANDROID_KEYSTORE_BASE64 exceeds the keystore size limit.');
  let encoded = value.trim();
  if (/^(["']).*\1$/s.test(encoded)) encoded = encoded.slice(1, -1);
  encoded = encoded
    .replace(/^data:[a-z0-9.+/-]+;base64,/i, '')
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/\s/g, '');
  // Accept standard base64 and its URL-safe spelling, without guessing missing bytes.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded))
    throw new Error(
      'ANDROID_KEYSTORE_BASE64 contains no recoverable base64 keystore. Restore the existing key backup.',
    );
  encoded = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, ''))
    throw new Error('ANDROID_KEYSTORE_BASE64 is incomplete or invalid.');
  const jks = bytes.length > 4 && bytes.readUInt32BE(0) === 0xfeedfeed;
  const pkcs12 = bytes.length > 4 && bytes[0] === 0x30;
  if (!jks && !pkcs12) throw new Error('ANDROID_KEYSTORE_BASE64 does not contain a JKS or PKCS12 keystore.');
  return bytes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const name of [
      'ANDROID_KEYSTORE_BASE64',
      'ANDROID_KEYSTORE_PASSWORD',
      'ANDROID_KEY_ALIAS',
      'ANDROID_KEY_PASSWORD',
    ])
      if (!process.env[name])
        throw new Error(`${name} is missing. Restore the existing release signing configuration.`);
    const output = process.argv[2];
    assert.ok(output, 'Pass the temporary keystore output path.');
    const bytes = decodeKeystoreSecret(process.env.ANDROID_KEYSTORE_BASE64);
    writeFileSync(output, bytes, { mode: 0o600, flag: 'wx' });
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `ANDROID_KEYSTORE_PATH=${output}\n`);
    console.log('Restored the existing keystore for private-key and certificate verification.');
  } catch (error) {
    // Never print the secret, decoded bytes, passwords, or child-process output.
    console.error(error.message);
    process.exitCode = 1;
  }
}
