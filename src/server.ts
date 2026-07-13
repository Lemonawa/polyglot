import { serve } from '@hono/node-server';
import { mountAdmin } from './admin/mount.js';
import { createRelay } from './relay.js';
import { migrate, openDb } from './store/db.js';

const dbPath = process.env.DB_PATH ?? 'polyglot.sqlite';
const port = Number(process.env.PORT ?? 8787);
const adminToken = process.env.ADMIN_TOKEN ?? '';

const db = openDb(dbPath);
migrate(db);
const app = createRelay(db);

if (adminToken) {
  mountAdmin(app, db, adminToken);
  console.log('admin UI mounted at /admin');
} else {
  console.warn(
    'ADMIN_TOKEN not set — admin UI disabled. Set ADMIN_TOKEN to enable. Never expose relay to public without auth.',
  );
}

serve({ fetch: app.fetch, port });
console.log(`polyglot relay listening on :${port} (db: ${dbPath})`);
