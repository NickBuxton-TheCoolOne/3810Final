'use strict';
// Route tests for js/api/admin.js. No live SQL Server or Redis: the db and queue
// modules are mocked, and each test scripts what the fake SQL returns.

process.env.SESSION_SECRET = 'test-secret';

jest.mock('../config/db', () => ({
  sql: { UniqueIdentifier: 'uid', NVarChar: jest.fn(() => 'nvarchar'), Int: 'int' },
  getPool: jest.fn(),
  closePool: jest.fn().mockResolvedValue(),
}));
jest.mock('../config/queue', () => ({
  getRoundResolutionQueue: jest.fn(),
  closeQueue: jest.fn().mockResolvedValue(),
}));

const db = require('../config/db');
const { createToken, verifyPassword } = require('../api/authTokens');
const { buildApp } = require('../server');

const hostId = '11111111-1111-4111-8111-111111111111';
const adminId = '33333333-3333-4333-8333-333333333333';
const newHostId = '55555555-5555-4555-8555-555555555555';

const roles = { [hostId]: 'host', [adminId]: 'admin' };

// Fake SQL: the staff lookup is answered from `roles`; every other query takes the
// next scripted result (an object, or an Error to throw).
global.fakeSql = {
  results: [],
  queries: [],
  makeRequest() {
    const inputs = {};
    const req = {
      input: jest.fn((name, type, value) => { inputs[name] = value; return req; }),
      query: jest.fn(async (text) => {
        if (text.includes('FROM staffAccount')) {
          const role = roles[inputs.staffAccountId];
          return { recordset: role ? [{ role, isActive: true }] : [] };
        }
        global.fakeSql.queries.push({ text, inputs });
        const next = global.fakeSql.results.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
    };
    return req;
  },
};

const staffToken = (id) => `Bearer ${createToken({ kind: 'staff', staffAccountId: id })}`;
const playerToken = () => `Bearer ${createToken({ kind: 'player', playerId: 'p1', matchId: 'm1' })}`;

let app;

beforeAll(async () => {
  db.getPool.mockResolvedValue({ request: () => global.fakeSql.makeRequest() });
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  global.fakeSql.results = [];
  global.fakeSql.queries = [];
});

describe('POST /api/admin/hosts', () => {
  const create = (auth, payload) => app.inject({
    method: 'POST', url: '/api/admin/hosts', headers: auth ? { authorization: auth } : {}, payload,
  });
  const valid = { username: 'newhost', password: 'longenough' };

  test('401 without a token', async () => {
    const res = await create(null, valid);
    expect(res.statusCode).toBe(401);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('403 for a host', async () => {
    const res = await create(staffToken(hostId), valid);
    expect(res.statusCode).toBe(403);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('403 for a player', async () => {
    const res = await create(playerToken(), valid);
    expect(res.statusCode).toBe(403);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test.each([
    ['a role field', { ...valid, role: 'admin' }],
    ['a short username', { ...valid, username: 'ab' }],
    ['a long username', { ...valid, username: 'a'.repeat(51) }],
    ['a short password', { ...valid, password: 'short' }],
    ['a missing password', { username: 'newhost' }],
  ])('400 for %s', async (_, payload) => {
    const res = await create(staffToken(adminId), payload);
    expect(res.statusCode).toBe(400);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('201 creates a host with a hashed password', async () => {
    global.fakeSql.results.push({
      recordset: [{ staffAccountId: newHostId, username: 'newhost', role: 'host', isActive: true }],
    });
    const res = await create(staffToken(adminId), valid);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ staffId: newHostId, username: 'newhost', role: 'host', isActive: true });

    const [insert] = global.fakeSql.queries;
    expect(insert.text).toMatch(/INSERT INTO staffAccount/);
    expect(insert.text).toMatch(/'host'/);
    expect(insert.inputs.username).toBe('newhost');
    expect(insert.inputs.passwordHash).not.toBe('longenough');
    await expect(verifyPassword('longenough', insert.inputs.passwordHash)).resolves.toBe(true);
  });

  test('409 USERNAME_TAKEN on a duplicate username', async () => {
    global.fakeSql.results.push(Object.assign(new Error('duplicate key'), { number: 2627 }));
    const res = await create(staffToken(adminId), valid);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('USERNAME_TAKEN');
  });

  test('500 on any other database error', async () => {
    global.fakeSql.results.push(new Error('connection lost'));
    const res = await create(staffToken(adminId), valid);
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /api/admin/hosts/{hostId}/disable', () => {
  const disable = (auth, id = hostId) => app.inject({
    method: 'POST', url: `/api/admin/hosts/${id}/disable`, headers: auth ? { authorization: auth } : {},
  });
  const disabledRow = { staffAccountId: hostId, username: 'somehost', role: 'host', isActive: false };

  test('401 without a token', async () => {
    const res = await disable(null);
    expect(res.statusCode).toBe(401);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('403 for a host', async () => {
    const res = await disable(staffToken(hostId));
    expect(res.statusCode).toBe(403);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('403 for a player', async () => {
    const res = await disable(playerToken());
    expect(res.statusCode).toBe(403);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('400 for a hostId that is not a uuid', async () => {
    const res = await disable(staffToken(adminId), 'not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('200 disables the host and returns it', async () => {
    global.fakeSql.results.push({ recordset: [disabledRow] });
    const res = await disable(staffToken(adminId));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ staffId: hostId, username: 'somehost', role: 'host', isActive: false });

    const [update] = global.fakeSql.queries;
    expect(update.text).toMatch(/SET isActive = 0/);
    expect(update.text).toMatch(/role = 'host'/);
    expect(update.inputs.hostId).toBe(hostId);
  });

  test('200 again for an already-disabled host (idempotent)', async () => {
    global.fakeSql.results.push({ recordset: [disabledRow] }, { recordset: [disabledRow] });
    const first = await disable(staffToken(adminId));
    const second = await disable(staffToken(adminId));
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().isActive).toBe(false);
  });

  test('404 for an unknown id or an admin account', async () => {
    global.fakeSql.results.push({ recordset: [] });
    const res = await disable(staffToken(adminId), adminId);
    expect(res.statusCode).toBe(404);
  });
});
