import { serve } from '@hono/node-server';
import { createRelay } from './relay.js';
import { migrate, openDb } from './store/db.js';

const dbPath = process.env.DB_PATH ?? 'polyglot.sqlite';
const port = Number(process.env.PORT ?? 8787);

const db = openDb(dbPath);
migrate(db);
const app = createRelay(db);

serve({ fetch: app.fetch, port });
console.log(`polyglot relay listening on :${port} (db: ${dbPath})`);
