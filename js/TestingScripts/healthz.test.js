'use strict';

// The real config modules are mocked so this test needs no SQL Server or Redis.
jest.mock('../config/db', () => ({
  sql: {},
  getPool: jest.fn(),
  closePool: jest.fn().mockResolvedValue(),
}));
jest.mock('../config/queue', () => ({
  getRoundResolutionQueue: jest.fn(),
  enqueueRoundResolution: jest.fn(),
  closeQueue: jest.fn().mockResolvedValue(),
}));

const db = require('../config/db');
const queue = require('../config/queue');
const { buildApp } = require('../server');

describe('GET /healthz', () => {
  let app;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  test('does not touch the database or Redis', async () => {
    await app.inject({ method: 'GET', url: '/healthz' });
    expect(db.getPool).not.toHaveBeenCalled();
    expect(queue.getRoundResolutionQueue).not.toHaveBeenCalled();
  });

  test('exposes db and queue on the app', () => {
    expect(app.db).toBe(db);
    expect(app.queue).toBe(queue);
  });
});

describe('app shutdown', () => {
  test('closes the queue and the pool', async () => {
    const app = await buildApp();
    await app.ready();
    queue.closeQueue.mockClear();
    db.closePool.mockClear();

    await app.close();

    expect(queue.closeQueue).toHaveBeenCalledTimes(1);
    expect(db.closePool).toHaveBeenCalledTimes(1);
  });
});
