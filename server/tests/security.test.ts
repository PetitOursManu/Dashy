import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { isHttpUrl, isPrivateAddress, assertPublicHttpUrl } from '../src/utils/urlGuard.js';
import { parseManifest } from '../src/store/manifest.js';
import { safeExtractZip, ZipExtractionError } from '../src/utils/zip.js';
import { parseGitHubRepo } from '../src/store/repoSource.js';

/** Regression tests for the issues found in the security review. */

// --- Dangerous URL schemes (stored XSS via a card link) ---

test('isHttpUrl rejects javascript: and data: URLs', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('JavaScript:alert(1)'), false);
  assert.equal(isHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isHttpUrl('file:///etc/passwd'), false);
  assert.equal(isHttpUrl('not a url'), false);
});

test('a tile manifest with a javascript: URL is rejected', () => {
  const res = parseManifest({
    id: 'evil',
    name: 'Evil',
    type: 'tile',
    tile: { url: 'javascript:fetch("/api/users")' },
  });
  assert.equal(res.ok, false);
});

test('a normal https tile manifest still parses', () => {
  const res = parseManifest({
    id: 'good',
    name: 'Good',
    type: 'tile',
    tile: { url: 'https://example.com/app' },
  });
  assert.equal(res.ok, true);
});

test('a static manifest with a non-http source_url is rejected', () => {
  const res = parseManifest({
    id: 'evil2',
    name: 'Evil2',
    type: 'static',
    static: { source_url: 'file:///etc/passwd', entrypoint: 'index.html' },
  });
  assert.equal(res.ok, false);
});

// --- SSRF ---

test('isPrivateAddress covers loopback, private, link-local and mapped v4', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be private`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be public`);
  }
});

test('assertPublicHttpUrl refuses loopback, metadata and non-http URLs', async () => {
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1:3000/api'));
  await assert.rejects(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/'));
  await assert.rejects(() => assertPublicHttpUrl('http://[::1]:3000/'));
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'));
});

// --- Zip bomb ---

test('safeExtractZip enforces the total-size cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-zip-'));
  const zipPath = path.join(dir, 'bomb.zip');
  const zip = new AdmZip();
  // Highly compressible payload: small archive, large expansion.
  zip.addFile('big.txt', Buffer.alloc(1024 * 1024, 0));
  zip.writeZip(zipPath);
  try {
    assert.throws(
      () => safeExtractZip(zipPath, path.join(dir, 'out'), { maxTotalBytes: 1024 }),
      ZipExtractionError,
    );
    // Under a generous cap the same archive extracts fine.
    const files = safeExtractZip(zipPath, path.join(dir, 'ok'));
    assert.deepEqual(files, ['big.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Repo reference hardening ---

test('parseGitHubRepo rejects owners/names outside GitHub charset', () => {
  assert.equal(parseGitHubRepo('https://github.com/ow ner/repo'), null);
  assert.equal(parseGitHubRepo('https://github.com/own?er/repo'), null);
  assert.ok(parseGitHubRepo('https://github.com/valid-owner/valid.repo_1'));
});
