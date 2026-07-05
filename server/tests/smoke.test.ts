import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { slugify, withRandomSuffix } from '../src/utils/slug.js';
import { safeExtractZip, findEntryFile, ZipExtractionError } from '../src/utils/zip.js';

// Minimal env required by modules that read config (crypto).
process.env.MONGO_URI ??= 'mongodb://localhost:27017/test';
process.env.JWT_SECRET ??= 'test-secret-test-secret';
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

test('slugify normalizes names', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  Café Déjà Vu  '), 'cafe-deja-vu');
  assert.equal(slugify('***'), 'app');
  assert.equal(slugify('My_App.v2'), 'my-app-v2');
});

test('withRandomSuffix keeps base and adds entropy', () => {
  const s = withRandomSuffix('my-app');
  assert.match(s, /^my-app-[0-9a-f]{6}$/);
});

test('crypto encrypts and decrypts round-trip', async () => {
  const { encrypt, decrypt, generateBackupCodes } = await import('../src/utils/crypto.js');
  const secret = 'JBSWY3DPEHPK3PXP';
  const enc = encrypt(secret);
  assert.notEqual(enc, secret);
  assert.equal(decrypt(enc), secret);

  // Tampering with the ciphertext must fail (GCM auth tag).
  const [iv, tag, data] = enc.split(':');
  const tampered = `${iv}:${tag}:${data.replace(/.$/, (c) => (c === '0' ? '1' : '0'))}`;
  assert.throws(() => decrypt(tampered));

  const codes = generateBackupCodes(10);
  assert.equal(codes.length, 10);
  for (const c of codes) assert.match(c, /^[0-9a-f]{4}-[0-9a-f]{4}$/);
});

test('parseDeployAdvice extracts JSON from a wrapped reply', async () => {
  const { parseDeployAdvice } = await import('../src/services/deployAdvisor.js');
  const raw =
    'Sure, here you go:\n```json\n' +
    '{"needsPersistence":true,"volumes":[{"name":"db-data","mountPath":"/var/lib/postgresql/data","reason":"database"},],' +
    '"env":[{"key":"DB_PASSWORD","secret":true}]}\n' +
    '```\nHope it helps.';
  const advice = parseDeployAdvice(raw);
  assert.equal(advice.needsPersistence, true);
  assert.equal(advice.volumes[0].name, 'db-data');
  assert.equal(advice.env[0].key, 'DB_PASSWORD');
  assert.equal(advice.env[0].secret, true);
  // Schema defaults applied.
  assert.equal(advice.env[0].required, true);
  assert.equal(advice.notes, '');
});

test('parseDeployAdvice survives reasoning prose and stray braces', async () => {
  const { parseDeployAdvice } = await import('../src/services/deployAdvisor.js');
  const raw =
    '<think>Consider a mount {like this} — Postgres stores data in /var/lib.</think>\n' +
    'Here is the analysis:\n' +
    '{"needsPersistence":true,"volumes":[{"name":"pg-data","mountPath":"/var/lib/postgresql/data"}],' +
    '"env":[{"key":"POSTGRES_PASSWORD","secret":true}]}';
  const advice = parseDeployAdvice(raw);
  assert.equal(advice.volumes[0].name, 'pg-data');
  assert.equal(advice.env[0].key, 'POSTGRES_PASSWORD');
});

test('parseDeployAdvice rejects non-JSON and invalid volume names', async () => {
  const { parseDeployAdvice } = await import('../src/services/deployAdvisor.js');
  assert.throws(() => parseDeployAdvice('there is no json here at all'));
  assert.throws(() =>
    parseDeployAdvice('{"needsPersistence":true,"volumes":[{"name":"bad name!","mountPath":"/x"}]}'),
  );
});

test('safeExtractZip extracts a normal archive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-zip-'));
  const zipPath = path.join(dir, 'site.zip');
  const dest = path.join(dir, 'out');

  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<h1>hi</h1>'));
  zip.addFile('assets/app.js', Buffer.from('console.log(1)'));
  zip.writeZip(zipPath);

  const files = safeExtractZip(zipPath, dest);
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('assets/app.js'));
  assert.equal(findEntryFile(files), 'index.html');
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), '<h1>hi</h1>');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('safeExtractZip rejects path traversal (zip-slip)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-zip-'));
  const zipPath = path.join(dir, 'evil.zip');
  const dest = path.join(dir, 'out');

  const zip = new AdmZip();
  zip.addFile('placeholder.txt', Buffer.from('ok'));
  // Bypass AdmZip's add-time normalization to craft a real zip-slip entry.
  zip.getEntries()[0].entryName = '../../evil.txt';
  zip.writeZip(zipPath);

  assert.throws(() => safeExtractZip(zipPath, dest), ZipExtractionError);
  assert.ok(!fs.existsSync(path.join(dir, 'evil.txt')), 'must not write outside dest');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findEntryFile prefers shallow index.html', () => {
  assert.equal(findEntryFile(['a/b/index.html', 'index.html']), 'index.html');
  assert.equal(findEntryFile(['deep/index.html', 'deep/x/index.html']), 'deep/index.html');
  assert.equal(findEntryFile(['only/page.html']), 'only/page.html');
  assert.equal(findEntryFile(['no-html.txt']), null);
});
