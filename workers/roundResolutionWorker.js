'use strict';

// Standalone BullMQ worker for the roundResolution queue (SPEC §1.1, §7).
// One job per (matchId, roundNumber). Each job, in a single SQL transaction:
//   1. claims the round (sets matchRound.resolvedAt) — a retried job that finds the
//      round already claimed does nothing, so nothing is scored or spawned twice;
//   2. resolves every open item (leader = highest cumulative total, ties go to
//      whoever reached that total first), counts roundsLeft down and closes items
//      that hit 0, adding pointValue to the winner's score;
//   3. pays every player the match's roundCoinIncome;
//   4. either finishes the match (closes all open items, writes leaderboardEntry
//      rows) or opens the next round and spawns its item.
// After the commit it enqueues the next round's job, delayed until that round ends.
//
// Run with: npm run worker

const { Worker } = require('bullmq');
const db = require('../js/config/db');
const queue = require('../js/config/queue');

const ROUND_MS = 7000;

function randomInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

// pointValue: average of three uniform integers in 10–100, rounded (weighted to the middle).
function generatePointValue(rng = Math.random) {
  const sum = randomInt(10, 100, rng) + randomInt(10, 100, rng) + randomInt(10, 100, rng);
  return Math.round(sum / 3);
}

// lifetimeRounds: uniform integer in 1–5.
function generateLifetimeRounds(rng = Math.random) {
  return randomInt(1, 5, rng);
}

// bids: one item's bids, ordered by receivedAt then bidId.
// Returns { holderId, amount } for the highest cumulative total, or null if no bids.
// Bids are positive, so a player's total is reached at their latest bid; on a tie
// the player whose latest bid came first wins.
function pickLeader(bids) {
  const totals = new Map();
  for (const bid of bids) {
    const at = new Date(bid.receivedAt).getTime();
    const entry = totals.get(bid.matchPlayerId) || { total: 0, reachedAt: at };
    entry.total += bid.amount;
    if (at > entry.reachedAt) entry.reachedAt = at;
    totals.set(bid.matchPlayerId, entry);
  }
  let leader = null;
  for (const [holderId, { total, reachedAt }] of totals) {
    if (!leader || total > leader.amount || (total === leader.amount && reachedAt < leader.reachedAt)) {
      leader = { holderId, amount: total, reachedAt };
    }
  }
  return leader && { holderId: leader.holderId, amount: leader.amount };
}

function request(tx, sql, params) {
  const req = tx.request();
  for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
  return req;
}

// Bids up to and including roundNumber count. When isFinal, every open item closes
// as if its countdown ran out. Returns the items that closed.
async function settleOpenItems(tx, sql, { matchId, roundNumber, isFinal }) {
  const ids = { matchId: [sql.UniqueIdentifier, matchId], roundNumber: [sql.Int, roundNumber] };
  const itemRows = await request(tx, sql, ids).query(`
    SELECT itemId, pointValue, roundsLeft, currentBid, currentBidHolderId
    FROM item WITH (UPDLOCK)
    WHERE matchId = @matchId AND status = 'open'`);
  const bidRows = await request(tx, sql, ids).query(`
    SELECT b.itemId, b.matchPlayerId, b.amount, b.receivedAt
    FROM bid b JOIN item i ON i.itemId = b.itemId
    WHERE i.matchId = @matchId AND i.status = 'open' AND b.roundNumber <= @roundNumber
    ORDER BY b.receivedAt, b.bidId`);

  const bidsByItem = new Map();
  for (const bid of bidRows.recordset) {
    if (!bidsByItem.has(bid.itemId)) bidsByItem.set(bid.itemId, []);
    bidsByItem.get(bid.itemId).push(bid);
  }

  const closed = [];
  for (const item of itemRows.recordset) {
    const leader = pickLeader(bidsByItem.get(item.itemId) || []);
    const currentBid = leader ? leader.amount : item.currentBid;
    const holderId = leader ? leader.holderId : item.currentBidHolderId;
    const roundsLeft = isFinal ? 0 : Math.max(0, item.roundsLeft - 1);
    const closes = roundsLeft === 0;
    const winnerId = closes && currentBid > 0 ? holderId : null;

    await request(tx, sql, {
      itemId: [sql.UniqueIdentifier, item.itemId],
      currentBid: [sql.Int, currentBid],
      holderId: [sql.UniqueIdentifier, holderId],
      roundsLeft: [sql.Int, roundsLeft],
      status: [sql.NVarChar(10), closes ? 'closed' : 'open'],
      winnerId: [sql.UniqueIdentifier, winnerId],
      closedRound: [sql.Int, closes ? roundNumber : null],
    }).query(`
      UPDATE item SET currentBid = @currentBid, currentBidHolderId = @holderId,
        roundsLeft = @roundsLeft, status = @status,
        winnerPlayerId = @winnerId, closedRound = @closedRound
      WHERE itemId = @itemId`);

    if (winnerId) {
      await request(tx, sql, {
        matchPlayerId: [sql.UniqueIdentifier, winnerId],
        points: [sql.Int, item.pointValue],
      }).query('UPDATE matchPlayer SET score = score + @points WHERE matchPlayerId = @matchPlayerId');
    }
    if (closes) closed.push({ itemId: item.itemId, winnerPlayerId: winnerId });
  }
  return closed;
}

// Marks the match finished and saves every player's final score to the leaderboard.
async function finishMatch(tx, sql, matchId) {
  await request(tx, sql, { matchId: [sql.UniqueIdentifier, matchId] }).query(`
    UPDATE [match] SET status = 'finished', finishedAt = SYSUTCDATETIME()
    WHERE matchId = @matchId;
    INSERT INTO leaderboardEntry (matchId, matchPlayerId, nickname, score, finishedAt)
    SELECT p.matchId, p.matchPlayerId, p.nickname, p.score, m.finishedAt
    FROM matchPlayer p JOIN [match] m ON m.matchId = p.matchId
    WHERE p.matchId = @matchId
      AND NOT EXISTS (SELECT 1 FROM leaderboardEntry e WHERE e.matchPlayerId = p.matchPlayerId)`);
}

async function resolveRound({ matchId, roundNumber }, deps = {}) {
  const {
    sql = db.sql,
    getPool = db.getPool,
    enqueue = queue.enqueueRoundResolution,
    now = () => new Date(),
    rng = Math.random,
  } = deps;

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  const ids = { matchId: [sql.UniqueIdentifier, matchId], roundNumber: [sql.Int, roundNumber] };
  let next = null;
  let result;

  try {
    const claim = await request(tx, sql, ids).query(`
      UPDATE matchRound SET resolvedAt = SYSUTCDATETIME()
      OUTPUT inserted.endsAt
      WHERE matchId = @matchId AND roundNumber = @roundNumber AND resolvedAt IS NULL`);

    if (claim.rowsAffected[0] === 0) {
      // Already resolved (retry) or the round doesn't exist. If an earlier attempt
      // committed but failed to enqueue the next round, enqueue it now — the jobId
      // makes this a no-op when the job already exists.
      const pending = await request(tx, sql, ids).query(`
        SELECT endsAt FROM matchRound
        WHERE matchId = @matchId AND roundNumber = @roundNumber + 1 AND resolvedAt IS NULL`);
      await tx.commit();
      if (pending.recordset.length) {
        next = { roundNumber: roundNumber + 1, endsAt: pending.recordset[0].endsAt };
        await enqueueNext(enqueue, matchId, next, now);
      }
      return { status: 'skipped', nextRound: next && next.roundNumber };
    }

    const roundEndsAt = new Date(claim.recordset[0].endsAt);

    const matchRows = await request(tx, sql, ids).query(`
      SELECT status, endsAt, roundCoinIncome FROM [match] WITH (UPDLOCK)
      WHERE matchId = @matchId`);
    const match = matchRows.recordset[0];
    if (!match || match.status !== 'running') {
      await tx.commit();
      return { status: 'skipped' };
    }
    const matchEndsAt = new Date(match.endsAt);
    const isFinal = roundEndsAt.getTime() >= matchEndsAt.getTime();

    const closed = await settleOpenItems(tx, sql, { matchId, roundNumber, isFinal });

    await request(tx, sql, { ...ids, income: [sql.Int, match.roundCoinIncome] }).query(
      'UPDATE matchPlayer SET coins = coins + @income WHERE matchId = @matchId');

    if (isFinal) {
      await finishMatch(tx, sql, matchId);
    } else {
      // The last round is cut short so it ends exactly when the match does.
      const nextEndsAt = new Date(Math.min(roundEndsAt.getTime() + ROUND_MS, matchEndsAt.getTime()));
      next = { roundNumber: roundNumber + 1, endsAt: nextEndsAt };
      const lifetimeRounds = generateLifetimeRounds(rng);
      await request(tx, sql, {
        matchId: [sql.UniqueIdentifier, matchId],
        nextRound: [sql.Int, next.roundNumber],
        startedAt: [sql.DateTime2, roundEndsAt],
        endsAt: [sql.DateTime2, nextEndsAt],
        pointValue: [sql.Int, generatePointValue(rng)],
        lifetimeRounds: [sql.Int, lifetimeRounds],
      }).query(`
        INSERT INTO matchRound (matchId, roundNumber, startedAt, endsAt)
        VALUES (@matchId, @nextRound, @startedAt, @endsAt);
        INSERT INTO item (matchId, pointValue, spawnRound, lifetimeRounds, roundsLeft)
        VALUES (@matchId, @pointValue, @nextRound, @lifetimeRounds, @lifetimeRounds)`);
    }

    await tx.commit();
    result = { status: isFinal ? 'finished' : 'resolved', closed, nextRound: next && next.roundNumber };
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw err;
  }

  if (next) await enqueueNext(enqueue, matchId, next, now);
  return result;
}

function enqueueNext(enqueue, matchId, next, now) {
  const delayMs = new Date(next.endsAt).getTime() - now().getTime();
  return enqueue({ matchId, roundNumber: next.roundNumber, delayMs });
}

function startWorker() {
  const worker = new Worker(
    queue.ROUND_RESOLUTION_QUEUE,
    (job) => resolveRound(job.data),
    { connection: queue.createRedisConnection(), prefix: queue.queuePrefix() },
  );
  worker.on('failed', (job, err) => {
    console.error(`roundResolution ${job && job.id} failed (attempt ${job && job.attemptsMade}):`, err.message);
  });
  worker.on('error', (err) => console.error('roundResolution worker error:', err.message));
  return worker;
}

function main() {
  const worker = startWorker();
  console.log(`roundResolution worker listening on queue "${queue.ROUND_RESOLUTION_QUEUE}"`);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await worker.close();
      await Promise.allSettled([db.closePool(), queue.closeQueue()]);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = {
  ROUND_MS,
  generatePointValue,
  generateLifetimeRounds,
  pickLeader,
  settleOpenItems,
  finishMatch,
  resolveRound,
  startWorker,
};
