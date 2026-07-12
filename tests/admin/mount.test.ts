import { expect, test } from 'vitest';
import { Hono } from 'hono';
import { migrate, openDb } from '../../src/store/db.js';
import { mountAdmin } from '../../src/admin/mount.js';

function app() {
  const db = openDb(':memory:');
  migrate(db);
  const a = new Hono();
  mountAdmin(a, db, 't');
  return a;
}

test('GET /admin serves html without token', async () => {
  const res = await app().request('/admin');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('Polyglot');
});

test('admin api under /admin/api requires token', async () => {
  const unauth = await app().request('/admin/api/models');
  expect(unauth.status).toBe(401);
  const ok = await app().request('/admin/api/models', { headers: { Authorization: 'Bearer t' } });
  expect(ok.status).toBe(200);
});
