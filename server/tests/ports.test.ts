import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapPorts, remapUrlPort, pickFreePort } from '../src/store/ports.js';

test('remaps a busy host port and reports the change', () => {
  const compose = 'services:\n  app:\n    ports:\n      - "3000:3000"\n';
  const { compose: out, remap } = remapPorts(compose, new Set([3000]));
  assert.equal(remap.length, 1);
  assert.equal(remap[0].from, 3000);
  assert.notEqual(remap[0].to, 3000);
  assert.ok(out.includes(`${remap[0].to}:3000`));
  assert.ok(!out.includes('"3000:3000"'));
});

test('leaves a free host port untouched', () => {
  const { compose, remap } = remapPorts('      - "3000:3000"', new Set([8080]));
  assert.equal(remap.length, 0);
  assert.ok(compose.includes('"3000:3000"'));
});

test('handles unquoted and IP-prefixed forms, and two clashes', () => {
  const input = '      - 3000:3000\n      - "127.0.0.1:3000:80"';
  const { compose, remap } = remapPorts(input, new Set([3000]));
  assert.equal(remap.length, 2);
  // The IP prefix is preserved on the rewritten line.
  assert.ok(/127\.0\.0\.1:\d+:80/.test(compose));
});

test('does not touch volume-like lines', () => {
  const { remap } = remapPorts('      - data:/app/data', new Set([3000]));
  assert.equal(remap.length, 0);
});

test('pickFreePort keeps a free preferred port, else scans', () => {
  assert.equal(pickFreePort(new Set([8080]), 3000), 3000);
  assert.equal(pickFreePort(new Set([8000, 8001]), 8000), 8002);
});

test('remapUrlPort updates only a matching port', () => {
  assert.equal(remapUrlPort('https://x.y:3000/', [{ from: 3000, to: 8001 }]), 'https://x.y:8001/');
  assert.equal(remapUrlPort('https://x.y:5000/', [{ from: 3000, to: 8001 }]), 'https://x.y:5000/');
});
