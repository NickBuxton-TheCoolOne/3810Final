'use strict';
// Route tests for js/api/matches.js. No live SQL Server or Redis: the db and queue
// modules are mocked, and each test scripts what the fake SQL returns.

process.env.SESSION_SECRET = 'test-secret';

jest.mock('../config/db', () => {
  class Transaction {
    constructor() {
      Transaction.instances.push(this);
      this.begin = jest.fn().mockResolvedValue();
      this.commit = jest.fn().mockResolvedValue();
      this.rollback = jest.fn().mockResolvedValue();
      this.request = jest.fn(() => global.fakeSql.makeRequest());
    }
  }
  Transaction.instances = [];
  return {
    sql: {
      UniqueIdentifier: 'uid', NVarChar: jest.fn(() => 'nvarchar'), Int: 'int', DateTime2: 'dt2', Transaction,
    },
    getPool: jest.fn(),
    closePool: jest.fn().mockResolvedValue(),
  };
});
jest.mock('../config/queue', () => ({
  getRoundResolutionQueue: jest.fn(),
  enqueueRoundResolution: jest.fn().mockResolvedValue(),
  closeQueue: jest.fn().mockResolvedValue(),
}));

const db = require('../config/db');
const queue = require('../config/queue');
const { createToken, readToken } = require('../api/authTokens');
const { buildApp } = require('../server');

const hostId = '11111111-1111-4111-8111-111111111111';
const otherHostId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';

const roles = { [hostId]: 'host', [otherHostId]: 'host', [adminId]: 'admin' };

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
const playerToken = () => `Bearer ${createToken({ kind: 'player', playerId: 'p1', matchId })}`;

function matchRow(overrides = {}) {
  return {
    matchId,
    joinCode: 'ABC234',
    status: 'lobby',
    hostId,
    durationSeconds: 180,
    startingCoins: 25,
    roundCoinIncome: 5,
    maxPlayers: 8,
    playerCount: 3,
    createdAt: new Date('2026-11-27T10:00:00Z'),
    startedAt: null,
    endsAt: null,
    ...overrides,
  };
}

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
  db.sql.Transaction.instances.length = 0;
  queue.enqueueRoundResolution.mockClear();
});

describe('POST /api/matches', () => {
  const create = (auth, payload) => app.inject({
    method: 'POST', url: '/api/matches', headers: auth ? { authorization: auth } : {}, payload,
  });

  test('401 without a token', async () => {
    const res = await create(null, {});
    expect(res.statusCode).toBe(401);
  });

  test('403 for a player token', async () => {
    const res = await create(playerToken(), {});
    expect(res.statusCode).toBe(403);
  });

  test('201 with defaults for a host', async () => {
    global.fakeSql.results.push({ recordset: [matchRow()] });
    const res = await create(staffToken(hostId), {});
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('lobby');
    expect(body.settings).toEqual({
      durationSeconds: 180, roundDurationMs: 7000, totalRounds: 26,
      startingCoins: 25, roundCoinIncome: 5, maxPlayers: 8,
    });
    const { inputs } = global.fakeSql.queries[0];
    expect(inputs.hostId).toBe(hostId);
    expect(inputs.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(inputs.durationSeconds).toBe(180);
  });

  test('passes custom settings through', async () => {
    global.fakeSql.results.push({ recordset: [matchRow({ durationSeconds: 60, maxPlayers: 4 })] });
    const res = await create(staffToken(adminId), { durationSeconds: 60, maxPlayers: 4 });
    expect(res.statusCode).toBe(201);
    expect(global.fakeSql.queries[0].inputs).toMatchObject({ durationSeconds: 60, maxPlayers: 4, startingCoins: 25 });
  });

  test('400 for an unknown field', async () => {
    const res = await create(staffToken(hostId), { bogus: 1 });
    expect(res.statusCode).toBe(400);
  });

  test('400 for out-of-range maxPlayers', async () => {
    const res = await create(staffToken(hostId), { maxPlayers: 9 });
    expect(res.statusCode).toBe(400);
  });

  test('retries when the join code collides', async () => {
    const dup = Object.assign(new Error('duplicate key'), { number: 2627 });
    global.fakeSql.results.push(dup, { recordset: [matchRow()] });
    const res = await create(staffToken(hostId), {});
    expect(res.statusCode).toBe(201);
    expect(global.fakeSql.queries).toHaveLength(2);
  });
});

describe('POST /api/matches/join', () => {
  const join = (payload) => app.inject({ method: 'POST', url: '/api/matches/join', payload });
  const playerId = '55555555-5555-4555-8555-555555555555';

  test('400 when nickname is missing', async () => {
    const res = await join({ joinCode: 'ABC234' });
    expect(res.statusCode).toBe(400);
  });

  test('400 for an unknown field', async () => {
    const res = await join({ joinCode: 'ABC234', nickname: 'Bob', bogus: 1 });
    expect(res.statusCode).toBe(400);
  });

  test('400 for a whitespace-only nickname', async () => {
    const res = await join({ joinCode: 'ABC234', nickname: '   ' });
    expect(res.statusCode).toBe(400);
    expect(global.fakeSql.queries).toHaveLength(0);
  });

  test('404 JOIN_CODE_NOT_FOUND for an unknown code', async () => {
    global.fakeSql.results.push({ recordset: [] });
    const res = await join({ joinCode: 'ZZZZZZ', nickname: 'Bob' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('JOIN_CODE_NOT_FOUND');
    expect(db.sql.Transaction.instances[0].rollback).toHaveBeenCalled();
  });

  test('409 MATCH_NOT_IN_LOBBY once the match is running', async () => {
    global.fakeSql.results.push({ recordset: [matchRow({ status: 'running' })] });
    const res = await join({ joinCode: 'ABC234', nickname: 'Bob' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('MATCH_NOT_IN_LOBBY');
  });

  test('409 MATCH_FULL when playerCount reaches maxPlayers', async () => {
    global.fakeSql.results.push({ recordset: [matchRow({ playerCount: 8 })] });
    const res = await join({ joinCode: 'ABC234', nickname: 'Bob' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('MATCH_FULL');
  });

  test('409 NICKNAME_TAKEN when the nickname is already in the match', async () => {
    global.fakeSql.results.push({ recordset: [matchRow()] }, { recordset: [{ taken: 1 }] });
    const res = await join({ joinCode: 'ABC234', nickname: 'bob' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NICKNAME_TAKEN');
    expect(db.sql.Transaction.instances[0].commit).not.toHaveBeenCalled();
  });

  test('409 NICKNAME_TAKEN when a concurrent join wins the unique constraint', async () => {
    const dup = Object.assign(new Error('duplicate key'), { number: 2627 });
    global.fakeSql.results.push({ recordset: [matchRow()] }, { recordset: [] }, dup);
    const res = await join({ joinCode: 'ABC234', nickname: 'Bob' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NICKNAME_TAKEN');
    expect(db.sql.Transaction.instances[0].rollback).toHaveBeenCalled();
  });

  test('201 joins and returns a match-scoped player token', async () => {
    global.fakeSql.results.push(
      { recordset: [matchRow()] },
      { recordset: [] },
      { recordset: [{ matchPlayerId: playerId, nickname: 'Bob' }] },
    );
    const res = await join({ joinCode: 'abc234', nickname: '  Bob ' });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body).toMatchObject({ matchId, playerId, nickname: 'Bob' });
    expect(readToken(body.token)).toMatchObject({ kind: 'player', playerId, matchId });

    expect(global.fakeSql.queries[0].inputs.joinCode).toBe('ABC234');
    expect(global.fakeSql.queries[2].text).toMatch(/INSERT INTO matchPlayer/);
    expect(global.fakeSql.queries[2].text).toMatch(/playerCount = playerCount \+ 1/);
    expect(global.fakeSql.queries[2].inputs).toMatchObject({ nickname: 'Bob', coins: 25 });
    expect(db.sql.Transaction.instances[0].commit).toHaveBeenCalled();
  });
});

describe('POST /api/matches/:matchId/start', () => {
  const start = (auth, id = matchId) => app.inject({
    method: 'POST', url: `/api/matches/${id}/start`, headers: auth ? { authorization: auth } : {},
  });

  test('400 for a non-uuid id', async () => {
    const res = await start(staffToken(hostId), 'not-a-uuid');
    expect(res.statusCode).toBe(400);
  });

  test('404 when the match does not exist', async () => {
    global.fakeSql.results.push({ recordset: [] });
    const res = await start(staffToken(hostId));
    expect(res.statusCode).toBe(404);
    expect(db.sql.Transaction.instances[0].rollback).toHaveBeenCalled();
  });

  test('403 for a host who does not own the match', async () => {
    global.fakeSql.results.push({ recordset: [matchRow()] });
    const res = await start(staffToken(otherHostId));
    expect(res.statusCode).toBe(403);
  });

  test('409 MATCH_NOT_IN_LOBBY when already running', async () => {
    global.fakeSql.results.push({ recordset: [matchRow({ status: 'running' })] });
    const res = await start(staffToken(hostId));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('MATCH_NOT_IN_LOBBY');
  });

  test('409 NOT_ENOUGH_PLAYERS with one player', async () => {
    global.fakeSql.results.push({ recordset: [matchRow({ playerCount: 1 })] });
    const res = await start(staffToken(hostId));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NOT_ENOUGH_PLAYERS');
  });

  test('200 starts the match and schedules round 1', async () => {
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + 180000);
    global.fakeSql.results.push(
      { recordset: [matchRow()] },
      { recordset: [matchRow({ status: 'running', startedAt, endsAt })] },
    );
    const res = await start(staffToken(hostId));
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('running');

    const tx = db.sql.Transaction.instances[0];
    expect(tx.commit).toHaveBeenCalled();
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(global.fakeSql.queries[1].text).toMatch(/INSERT INTO matchRound/);
    expect(global.fakeSql.queries[1].text).toMatch(/INSERT INTO item/);

    expect(queue.enqueueRoundResolution).toHaveBeenCalledTimes(1);
    const job = queue.enqueueRoundResolution.mock.calls[0][0];
    expect(job.matchId).toBe(matchId);
    expect(job.roundNumber).toBe(1);
    expect(job.delayMs).toBeGreaterThan(0);
    expect(job.delayMs).toBeLessThanOrEqual(7000);
  });

  test('admin may start a match they do not own', async () => {
    global.fakeSql.results.push(
      { recordset: [matchRow()] },
      { recordset: [matchRow({ status: 'running' })] },
    );
    const res = await start(staffToken(adminId));
    expect(res.statusCode).toBe(200);
  });
});
