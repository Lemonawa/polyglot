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
import { createBudget, deleteBudget, listBudgets, type BudgetInput } from '../store/budgets.js';
import { listRequestLogs } from '../store/requestLogs.js';
import { checkBudgets } from '../cost/budget.js';
import { refreshModelsDev } from '../cost/modelsDev.js';
import type { Provider } from '../types.js';

function providerView(p: Provider) {
  const { api_key: _ignored, ...rest } = p;
  return rest;
}

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
    return c.json({ providers: providers.map(providerView) });
  });

  app.post('/models/:id/providers', async (c) => {
    const logical_model_id = Number(c.req.param('id'));
    const body = (await c.req.json()) as Omit<ProviderInput, 'logical_model_id'>;
    const provider = createProvider(db, { ...body, logical_model_id });
    return c.json({ provider: providerView(provider) }, 201);
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

  app.get('/budgets', (c) => c.json({ budgets: listBudgets(db) }));

  app.post('/budgets', async (c) => {
    const body = (await c.req.json()) as BudgetInput;
    const budget = createBudget(db, body);
    return c.json({ budget }, 201);
  });

  app.delete('/budgets/:id', (c) => {
    deleteBudget(db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  app.get('/logs', (c) => {
    const model = c.req.query('model');
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');
    const logs = listRequestLogs(db, {
      logicalModelId: model ? Number(model) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return c.json({ logs });
  });

  app.get('/models/:id/budget-status', (c) => {
    const statuses = checkBudgets(db, Number(c.req.param('id')));
    return c.json({ statuses });
  });

  app.post('/models-dev/refresh', async (c) => {
    try {
      await refreshModelsDev(db);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 502);
    }
  });

  return app;
}
