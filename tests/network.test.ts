import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates } from 'node:tls';
import { loadCertificates } from '../electron/network';

test('missing, unreadable or non-PEM CA bundles are skipped with a warning instead of crashing startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'research-ca-'));
  try {
    const system = getCACertificates('default').length;
    const valid = join(directory, 'corporate.pem');
    writeFileSync(valid, getCACertificates('default')[0]);
    const junk = join(directory, 'junk.txt');
    writeFileSync(junk, 'not a certificate');
    const warnings: string[] = [];
    const certificates = loadCertificates(
      [join(directory, 'missing.pem'), junk, valid, directory],
      undefined,
      message => warnings.push(message),
    );
    assert.equal(certificates.length, system + 1);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /missing\.pem/);
    assert.match(warnings[1], /no PEM certificates/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('with no extra paths only the system roots are used', () => {
  assert.equal(loadCertificates([]).length, getCACertificates('default').length);
});
