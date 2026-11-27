'use strict';

/**
 * js/server.js — Fastify application bootstrap & plugin registration.
 *
 * STATUS: STUB. Wires up the pieces AGENTS.md §2 locks, but registers no routes:
 * SPEC.md and openapi.yaml define none yet, and §1 forbids inventing features.
 * Add route plugins under js/api/ and require them in buildApp() below.
 */

const path = require('path');
const Fastify = require('fastify');
const db = require('./config/db');
const queue = require('./config/queue');

/**
 * Build a configured Fastify instance without starting it.
 * Exported separately from main() so Jest + Supertest can drive the app in-process
 * without binding a port (js/TestingScripts/).
 *
 * Neither the SQL pool nor Redis is opened here: getPool() and
 * getRoundResolutionQueue() connect on first use, so building the app (and the
 * /healthz test) needs no live services. main() checks both before listening.
 *
 * @param {object} [deps] Overrides for tests; defaults to the real config modules.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildApp({ dbModule = db, queueModule = queue } = {}) {
  const app = Fastify({
    logger: true,
    // Reject unknown body fields with 400 instead of silently stripping them,
    // so `additionalProperties: false` in openapi.yaml means what it says.
    ajv: { customOptions: { removeAdditional: false } },
  });

  // 1. db pool, 2. redis/queue. Route handlers reach them as this.db / this.queue
  // (or request.server.db) and must use parameterized queries only (AGENTS.md §2).
  app.decorate('db', dbModule);
  app.decorate('queue', queueModule);

  // Close the queue before the pool so no job is added against a closed pool.
  app.addHook('onClose', async () => {
    await queueModule.closeQueue();
    await dbModule.closePool();
  });

  //static hosting for UI_Elements/ (vanilla HTML/CSS/JS frontend).
    await app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'UI_Elements'),
    prefix: '/',
  });

  // 3. Auth: per-route preHandlers live in js/api/authHooks.js (authenticate,
  //    requireRole, requirePlayerInMatch). 4. Route plugins from js/api/.
  await app.register(require('./api/auth'));
  await app.register(require('./api/leaderboard'));
  await app.register(require('./api/matches'));

  app.get('/healthz', async () => ({
    status: 'ok',
    // Placeholder payload — no match/round state is defined yet.
    stub: true,
  }));

  return app;
}

// ioredis retries forever (maxRetriesPerRequest: null), so a down Redis would
// make waitUntilReady() hang; cap each startup check instead.
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} not reachable within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    // Fail fast: refuse to serve if SQL Server or Redis is unreachable.
    await withTimeout(app.db.getPool(), 15000, 'SQL Server');
    await withTimeout(app.queue.getRoundResolutionQueue().waitUntilReady(), 15000, 'Redis');
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err, 'failed to start server');
    // Closing a Redis client that never connected can also hang; don't wait on it.
    await withTimeout(app.close(), 5000, 'shutdown').catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

module.exports = { buildApp, main };
