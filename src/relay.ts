import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { handleRequest } from './convert.js';

export function createRelay(db: Database.Database): Hono {
  const app = new Hono();
  app.post('/v1/chat/completions', async (c) => handleRequest(db, 'chat', await c.req.json()));
  app.post('/v1/responses', async (c) => handleRequest(db, 'responses', await c.req.json()));
  app.post('/v1/messages', async (c) => handleRequest(db, 'anthropic', await c.req.json()));
  return app;
}
