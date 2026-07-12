import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { createAdminRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function mountAdmin(app: Hono, db: Database.Database, token: string): void {
  const html = readFileSync(join(__dirname, 'ui', 'index.html'), 'utf8');
  app.get('/admin', (c) => c.html(html));
  app.route('/admin/api', createAdminRoutes(db, token));
}
