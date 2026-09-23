import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { migrate, waitForDb } from './db.js';
import crudRoutes from './routes/crud.js';
import metricsRoutes from './routes/metrics.js';
import importRoutes from './routes/imports.js';
import retroRoutes from './routes/retro.js';
import ticketRoutes from './routes/tickets.js';
import statusMapRoutes from './routes/statusMap.js';
import todoRoutes from './routes/todos.js';
import reportRoutes from './routes/report.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // los CSV de worklog importados llegan ya parseados como JSON y pueden ser grandes
  bodyLimit: 25 * 1024 * 1024,
});

await app.register(cors, { origin: true });

// Un DELETE suele venir sin cuerpo. Si el cliente manda igualmente el
// content-type de JSON, el parser por defecto revienta con "Body cannot be
// empty"; aquí un cuerpo vacío se trata simplemente como sin cuerpo.
app.addContentTypeParser<string>(
  'application/json',
  { parseAs: 'string' },
  (_req, body, done) => {
    if (body === '' || body == null) return done(null, undefined);
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      (err as any).statusCode = 400;
      done(err as Error, undefined);
    }
  }
);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'Invalid data', issues: err.issues });
  }
  const pgErr = err as any;
  if (pgErr.code === '23505') {
    return reply.code(409).send({ error: 'A record with that identifier already exists' });
  }
  if (pgErr.code === '23503') {
    return reply.code(409).send({ error: 'Missing or in-use reference (foreign key)' });
  }
  app.log.error(err);
  // `err` llega tipado como unknown, así que se lee por la vista `any` de arriba.
  return reply.code(pgErr.statusCode ?? 500).send({ error: pgErr.message ?? 'Internal error' });
});

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(crudRoutes);
await app.register(metricsRoutes);
await app.register(importRoutes);
await app.register(retroRoutes);
await app.register(ticketRoutes);
await app.register(statusMapRoutes);
await app.register(todoRoutes);
await app.register(reportRoutes);

await waitForDb();
await migrate();
app.log.info('Migrations applied');

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
