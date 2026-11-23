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

/**
 * Build a configured Fastify instance without starting it.
 * Exported separately from main() so Jest + Supertest can drive the app in-process
 * without binding a port (js/TestingScripts/).
 *
 * @returns {import('fastify').FastifyInstance}
 */
async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // TODO: static hosting for UI_Elements/ (vanilla HTML/CSS/JS frontend).
  // await app.register(require('@fastify/static'), {
  //   root: path.join(__dirname, '..', 'UI_Elements'),
  //   prefix: '/',
  // });

  // TODO: connection pool + queue once js/config/ modules exist, then RBAC hooks
  // and route plugins from js/api/. Registered in dependency order:
  //   1. db pool    2. redis/queue    3. auth hooks    4. routes

  app.get('/healthz', async () => ({
    status: 'ok',
    // Placeholder payload — no match/round state is defined yet.
    stub: true,
  }));

  return app;
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
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err, 'failed to start server');
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

module.exports = { buildApp, main };
