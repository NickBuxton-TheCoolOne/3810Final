'use strict';

// The real config modules are mocked; resolveRound gets a fake sql/pool through deps,
// so this test needs no SQL Server or Redis.
jest.mock('../config/db', () => ({ sql: {}, getPool: jest.fn(), closePool: jest.fn() }));
jest.mock('../config/queue', () => ({
  ROUND_RESOLUTION_QUEUE: 'roundResolution',
  enqueueRoundResolution: jest.fn(),
  closeQueue: jest.fn(),
}));

const {
  ROUND_MS,
  generatePointValue,
  generateLifetimeRounds,
  pickLeader,
  resolveRound,
} = require('../../workers/roundResolutionWorker');

const MATCH = 'match-1';
const P1 = 'player-1';
const P2 = 'player-2';

// Fake mssql: every query is logged as { text, params } and answered by `respond`,
// which picks a canned result from the SQL text.
function fakeSql(respond) {
  const log = { queries: [], committed: false, rolledBack: false };
  class Transaction {
    async begin() {}
    async commit() { log.committed = true; }
    async rollback() { log.rolledBack = true; }
    request() {
      const params = {};
      const req = {
        input(name, _type, value) { params[name] = value; return req; },
        async query(text) {
          log.queries.push({ text, params });
          return respond(text, params) || { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    }
  }
  const sql = {
    Transaction,
    UniqueIdentifier: 'uid',
    Int: 'int',
    DateTime2: 'dt2',
    NVarChar: () => 'nvarchar',
  };
  return { sql, log };
}

// Scenario builder: round ends at roundEndsAt; match ends at matchEndsAt.
function scenario({ claimed = true, roundEndsAt, matchEndsAt, items = [], bids = [], status = 'running' }) {
  return fakeSql((text) => {
    if (text.includes('UPDATE matchRound SET resolvedAt')) {
      return claimed
        ? { recordset: [{ endsAt: roundEndsAt }], rowsAffected: [1] }
        : { recordset: [], rowsAffected: [0] };
    }
    if (text.includes('SELECT endsAt FROM matchRound')) return { recordset: [], rowsAffected: [0] };
    if (text.includes('FROM [match] WITH (UPDLOCK)')) {
      return { recordset: [{ status, endsAt: matchEndsAt, roundCoinIncome: 5 }], rowsAffected: [1] };
    }
    if (text.includes('FROM item WITH (UPDLOCK)')) return { recordset: items, rowsAffected: [items.length] };
    if (text.includes('FROM bid b')) return { recordset: bids, rowsAffected: [bids.length] };
    return null;
  });
}

function run(sim, roundNumber, extra = {}) {
  const enqueue = jest.fn().mockResolvedValue();
  const promise = resolveRound({ matchId: MATCH, roundNumber }, {
    sql: sim.sql,
    getPool: async () => ({}),
    enqueue,
    rng: () => 0,
    ...extra,
  });
  return { promise, enqueue };
}

const find = (log, fragment) => log.queries.filter((q) => q.text.includes(fragment));

describe('generators', () => {
  test('pointValue stays within 10–100', () => {
    expect(generatePointValue(() => 0)).toBe(10);
    expect(generatePointValue(() => 0.999)).toBe(100);
  });

  test('lifetimeRounds stays within 1–5', () => {
    expect(generateLifetimeRounds(() => 0)).toBe(1);
    expect(generateLifetimeRounds(() => 0.999)).toBe(5);
  });
});

describe('pickLeader', () => {
  const t = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));

  test('returns null with no bids', () => {
    expect(pickLeader([])).toBeNull();
  });

  test('highest cumulative total wins', () => {
    const bids = [
      { matchPlayerId: P1, amount: 10, receivedAt: t(1) },
      { matchPlayerId: P2, amount: 15, receivedAt: t(2) },
      { matchPlayerId: P1, amount: 10, receivedAt: t(3) },
    ];
    expect(pickLeader(bids)).toEqual({ holderId: P1, amount: 20 });
  });

  test('a tie goes to whoever reached the total first', () => {
    const bids = [
      { matchPlayerId: P1, amount: 5, receivedAt: t(1) },
      { matchPlayerId: P2, amount: 10, receivedAt: t(2) },
      { matchPlayerId: P1, amount: 5, receivedAt: t(3) },
    ];
    expect(pickLeader(bids)).toEqual({ holderId: P2, amount: 10 });
  });
});

describe('resolveRound', () => {
  const matchEndsAt = new Date('2026-01-01T00:01:00Z');

  test('does nothing when the round is already claimed', async () => {
    const sim = scenario({ claimed: false });
    const { promise, enqueue } = run(sim, 3);

    await expect(promise).resolves.toEqual({ status: 'skipped', nextRound: null });
    expect(find(sim.log, 'UPDATE item')).toHaveLength(0);
    expect(find(sim.log, 'coins = coins')).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(sim.log.committed).toBe(true);
  });

  test('skips a match that is not running', async () => {
    const sim = scenario({ roundEndsAt: new Date('2026-01-01T00:00:07Z'), matchEndsAt, status: 'finished' });
    const { promise, enqueue } = run(sim, 1);

    await expect(promise).resolves.toEqual({ status: 'skipped' });
    expect(find(sim.log, 'UPDATE item')).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('a normal round scores closing items, pays income, and opens the next round', async () => {
    const roundEndsAt = new Date('2026-01-01T00:00:14Z');
    const sim = scenario({
      roundEndsAt,
      matchEndsAt,
      items: [
        { itemId: 'closing', pointValue: 40, roundsLeft: 1, currentBid: 0, currentBidHolderId: null },
        { itemId: 'staying', pointValue: 70, roundsLeft: 3, currentBid: 0, currentBidHolderId: null },
      ],
      bids: [
        { itemId: 'closing', matchPlayerId: P1, amount: 12, receivedAt: new Date('2026-01-01T00:00:09Z') },
        { itemId: 'staying', matchPlayerId: P2, amount: 8, receivedAt: new Date('2026-01-01T00:00:10Z') },
      ],
    });
    const now = () => new Date('2026-01-01T00:00:14.500Z');
    const { promise, enqueue } = run(sim, 2, { now });

    await expect(promise).resolves.toEqual({
      status: 'resolved',
      closed: [{ itemId: 'closing', winnerPlayerId: P1 }],
      nextRound: 3,
    });

    const [closing, staying] = find(sim.log, 'UPDATE item SET').map((q) => q.params);
    expect(closing).toMatchObject({ currentBid: 12, holderId: P1, roundsLeft: 0, status: 'closed', winnerId: P1, closedRound: 2 });
    expect(staying).toMatchObject({ currentBid: 8, holderId: P2, roundsLeft: 2, status: 'open', winnerId: null, closedRound: null });

    const score = find(sim.log, 'score = score');
    expect(score).toHaveLength(1);
    expect(score[0].params).toEqual({ matchPlayerId: P1, points: 40 });

    expect(find(sim.log, 'coins = coins')[0].params).toMatchObject({ matchId: MATCH, income: 5 });

    const insert = find(sim.log, 'INSERT INTO matchRound')[0].params;
    expect(insert).toMatchObject({ nextRound: 3, startedAt: roundEndsAt, pointValue: 10, lifetimeRounds: 1 });
    expect(insert.endsAt.getTime()).toBe(roundEndsAt.getTime() + ROUND_MS);

    expect(find(sim.log, "status = 'finished'")).toHaveLength(0);
    expect(sim.log.committed).toBe(true);
    expect(enqueue).toHaveBeenCalledWith({ matchId: MATCH, roundNumber: 3, delayMs: ROUND_MS - 500 });
  });

  test('an item closing with no bids has no winner', async () => {
    const sim = scenario({
      roundEndsAt: new Date('2026-01-01T00:00:07Z'),
      matchEndsAt,
      items: [{ itemId: 'lonely', pointValue: 50, roundsLeft: 1, currentBid: 0, currentBidHolderId: null }],
    });
    const { promise } = run(sim, 1);

    await expect(promise).resolves.toMatchObject({ closed: [{ itemId: 'lonely', winnerPlayerId: null }] });
    expect(find(sim.log, 'score = score')).toHaveLength(0);
  });

  test('the next round is cut short to end with the match', async () => {
    const roundEndsAt = new Date('2026-01-01T00:00:56Z');
    const sim = scenario({ roundEndsAt, matchEndsAt });
    const { promise } = run(sim, 8);

    await promise;
    expect(find(sim.log, 'INSERT INTO matchRound')[0].params.endsAt).toEqual(matchEndsAt);
  });

  test('the final round closes every item, finishes the match, and writes the leaderboard', async () => {
    const sim = scenario({
      roundEndsAt: matchEndsAt,
      matchEndsAt,
      items: [{ itemId: 'long', pointValue: 60, roundsLeft: 4, currentBid: 0, currentBidHolderId: null }],
      bids: [{ itemId: 'long', matchPlayerId: P2, amount: 30, receivedAt: new Date('2026-01-01T00:00:58Z') }],
    });
    const { promise, enqueue } = run(sim, 9);

    await expect(promise).resolves.toEqual({
      status: 'finished',
      closed: [{ itemId: 'long', winnerPlayerId: P2 }],
      nextRound: null,
    });
    expect(find(sim.log, 'UPDATE item SET')[0].params).toMatchObject({ roundsLeft: 0, status: 'closed' });
    expect(find(sim.log, 'score = score')[0].params).toEqual({ matchPlayerId: P2, points: 60 });
    expect(find(sim.log, 'coins = coins')).toHaveLength(1);
    expect(find(sim.log, "status = 'finished'")).toHaveLength(1);
    expect(find(sim.log, 'INSERT INTO leaderboardEntry')).toHaveLength(1);
    expect(find(sim.log, 'INSERT INTO matchRound')).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('rolls back and rethrows when a query fails', async () => {
    const sim = fakeSql((text) => {
      if (text.includes('UPDATE matchRound')) {
        return { recordset: [{ endsAt: new Date('2026-01-01T00:00:07Z') }], rowsAffected: [1] };
      }
      if (text.includes('FROM [match]')) throw new Error('deadlock');
      return null;
    });
    const { promise, enqueue } = run(sim, 1);

    await expect(promise).rejects.toThrow('deadlock');
    expect(sim.log.rolledBack).toBe(true);
    expect(sim.log.committed).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
