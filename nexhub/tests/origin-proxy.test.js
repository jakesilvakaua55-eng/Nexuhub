import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nexhub-origin-test-'));
process.env.DB_PATH = join(dir, 'test.sqlite');
process.env.MEDIA_PATH = join(dir, 'media');
process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = 'true';

const { createApp } = await import('../src/server.js');
const server = createApp();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test('trusted Replit proxy origin is accepted and foreign origin is rejected', async () => {
  try {
    const headers = {
      'content-type': 'application/json',
      'x-forwarded-host': 'nexhub.preview.test',
      'x-forwarded-proto': 'https',
    };
    const accepted = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://nexhub.preview.test' },
      body: JSON.stringify({
        username: 'proxy_user',
        email: 'proxy-user@example.test',
        password: 'preview-password',
      }),
    });
    assert.equal(accepted.status, 201, await accepted.text());

    const rejected = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://foreign.example.test' },
      body: JSON.stringify({
        username: 'foreign_user',
        email: 'foreign-user@example.test',
        password: 'preview-password',
      }),
    });
    assert.equal(rejected.status, 403);
    assert.match((await rejected.json()).error, /Origem não autorizada/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
