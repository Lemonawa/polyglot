import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { requireAdmin } from './auth.js';
import {
  createLogicalModel,
  deleteLogicalModel,
  listLogicalModels,
} from '../store/logicalModels.js';
import {
  createProvider,
  deleteProvider,
  listProvidersByModelId,
  updateProvider,
  type ProviderInput,
} from '../store/providers.js';

export function createAdminRoutes(db: Database.Database, token: string): Hono {
  const app = new Hono();
  app.use('*', requireAdmin(token));

  app.get('/models', (c) => c.json({ models: listLogicalModels(db) }));

  app.post('/models', async (c) => {
    const body = (await c.req.json()) as { name: string };
    const model = createLogicalModel(db, body.name);
    return c.json({ model }, 201);
  });

  app.delete('/models/:id', (c) => {
    deleteLogicalModel(db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  app.get('/models/:id/providers', (c) => {
    const providers = listProvidersByModelId(db, Number(c.req.param('id')));
    return c.json({ providers });
  });

  app.post('/models/:id/providers', async (c) => {
    const logical_model_id = Number(c.req.param('id'));
    const body = (await c.req.json()) as Omit<ProviderInput, 'logical_model_id'>;
    const provider = createProvider(db, { ...body, logical_model_id });
    return c.json({ provider }, 201);
  });

  app.patch('/providers/:id', async (c) => {
    const patch = (await c.req.json()) as Partial<ProviderInput>;
    updateProvider(db, Number(c.req.param('id')), patch);
    return c.json({ ok: true });
  });

  app.delete('/providers/:id', (c) => {
    deleteProvider(db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  return app;
}
