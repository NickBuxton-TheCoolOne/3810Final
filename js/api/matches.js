// js/api/matches.js — match lifecycle routes (openapi.yaml: createMatch, joinMatch, startMatch).
//
//   POST /api/matches                   Host/Admin: open a lobby with a fresh join code.
//   POST /api/matches/join              anyone: join a lobby by code + nickname, get a
//                                       match-scoped player token (AC-11).
//   POST /api/matches/{matchId}/start   owning Host or Admin: lobby -> running, open
//                                       round 1, spawn its item, schedule its resolution.
//   GET  /api/matches/{matchId}/state   players of the match, owning Host, Admin: the
//                                       polled snapshot. Bids stay sealed (AC-4).
'use strict';
const crypto = require('node:crypto');
const { authenticate, requireRole, requirePlayerInMatch } = require('./authHooks');
const { createToken } = require('./authTokens');
const {
  ROUND_MS, generatePointValue, generateLifetimeRounds,
} = require('../../workers/roundResolutionWorker');

// No 0/O or 1/I so codes are easy to read aloud.
const joinCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCodeLength = 6;
const maxJoinCodeAttempts = 5;
const duplicateKeyErrors = new Set([2601, 2627]);

const createMatchBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    durationSeconds: { type: 'integer', minimum: 7, maximum: 1800, default: 180 },
    startingCoins: { type: 'integer', minimum: 0, default: 25 },
    roundCoinIncome: { type: 'integer', minimum: 0, default: 5 },
    maxPlayers: { type: 'integer', minimum: 2, maximum: 8, default: 8 },
  },
};

const joinMatchBody = {
  type: 'object',
  additionalProperties: false,
  required: ['joinCode', 'nickname'],
  properties: {
    joinCode: { type: 'string', minLength: 1, maxLength: 12 },
    nickname: { type: 'string', minLength: 1, maxLength: 20 },
  },
};

const matchIdParams = {
  type: 'object',
  required: ['matchId'],
  properties: { matchId: { type: 'string', format: 'uuid' } },
};

function generateJoinCode() {
  let code = '';
  for (let i = 0; i < joinCodeLength; i += 1) {
    code += joinCodeAlphabet[crypto.randomInt(joinCodeAlphabet.length)];
  }
  return code;
}

// DB row -> openapi Match.
function toMatch(row) {
  return {
    matchId: row.matchId,
    joinCode: row.joinCode,
    status: row.status,
    hostId: row.hostId,
    settings: {
      durationSeconds: row.durationSeconds,
      roundDurationMs: ROUND_MS,
      totalRounds: Math.ceil((row.durationSeconds * 1000) / ROUND_MS),
      startingCoins: row.startingCoins,
      roundCoinIncome: row.roundCoinIncome,
      maxPlayers: row.maxPlayers,
    },
    playerCount: row.playerCount,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endsAt: row.endsAt,
  };
}

function sendError(reply, statusCode, error, message, code) {
  const body = { statusCode, error, message };
  if (code) body.code = code;
  return reply.code(statusCode).send(body);
}

const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

module.exports = async function matchRoutes(app) {
  const staffOnly = [authenticate, requireRole('host', 'admin')];

  app.post('/api/matches', {
    schema: { body: createMatchBody },
    preHandler: staffOnly,
  }, async (request, reply) => {
    // The body is optional; Ajv fills defaults only when one is sent, so apply them here too.
    const body = request.body || {};
    const settings = {};
    for (const [key, prop] of Object.entries(createMatchBody.properties)) {
      settings[key] = body[key] !== undefined ? body[key] : prop.default;
    }

    const { sql } = app.db;
    const pool = await app.db.getPool();
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { recordset } = await pool.request()
          .input('hostId', sql.UniqueIdentifier, request.auth.staffAccountId)
          .input('joinCode', sql.NVarChar(12), generateJoinCode())
          .input('durationSeconds', sql.Int, settings.durationSeconds)
          .input('startingCoins', sql.Int, settings.startingCoins)
          .input('roundCoinIncome', sql.Int, settings.roundCoinIncome)
          .input('maxPlayers', sql.Int, settings.maxPlayers)
          .query(`INSERT INTO [match]
                    (hostId, joinCode, durationSeconds, startingCoins, roundCoinIncome, maxPlayers)
                  OUTPUT inserted.*
                  VALUES (@hostId, @joinCode, @durationSeconds, @startingCoins, @roundCoinIncome, @maxPlayers)`);
        return reply.code(201).send(toMatch(recordset[0]));
      } catch (err) {
        // uxMatchOpenJoinCode: the code is already used by an open match. Try another.
        if (!duplicateKeyErrors.has(err.number) || attempt >= maxJoinCodeAttempts) throw err;
      }
    }
  });

  // No auth (openapi security: []): this is how a player gets their token.
  app.post('/api/matches/join', {
    schema: { body: joinMatchBody },
  }, async (request, reply) => {
    const nickname = request.body.nickname.trim();
    if (!nickname) {
      return sendError(reply, 400, 'Bad Request', 'Nickname must not be blank.');
    }
    // Codes are generated upper-case; accept them typed in lower case too.
    const joinCode = request.body.joinCode.trim().toUpperCase();

    const { sql } = app.db;
    const pool = await app.db.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let player;
    let row;
    try {
      // UPDLOCK: concurrent joins (and a racing start) serialize on the match row,
      // so the playerCount / maxPlayers check below can't be overrun.
      ({ recordset: [row] } = await tx.request()
        .input('joinCode', sql.NVarChar(12), joinCode)
        .query(`SELECT * FROM [match] WITH (UPDLOCK, ROWLOCK)
                WHERE joinCode = @joinCode AND status <> 'finished'`));

      let refusal = null;
      if (!row) {
        refusal = [404, 'Not Found', 'No open match has this join code.', 'JOIN_CODE_NOT_FOUND'];
      } else if (row.status !== 'lobby') {
        refusal = [409, 'Conflict', 'Match is not in the lobby.', 'MATCH_NOT_IN_LOBBY'];
      } else if (row.playerCount >= row.maxPlayers) {
        refusal = [409, 'Conflict', 'Match is full.', 'MATCH_FULL'];
      } else {
        // nickname column is case-insensitive (CI collation), so 'Bob' matches 'bob'.
        const taken = await tx.request()
          .input('matchId', sql.UniqueIdentifier, row.matchId)
          .input('nickname', sql.NVarChar(20), nickname)
          .query('SELECT 1 AS taken FROM matchPlayer WHERE matchId = @matchId AND nickname = @nickname');
        if (taken.recordset.length) {
          refusal = [409, 'Conflict', 'Nickname is already taken in this match.', 'NICKNAME_TAKEN'];
        }
      }
      if (refusal) {
        await tx.rollback();
        return sendError(reply, ...refusal);
      }

      const inserted = await tx.request()
        .input('matchId', sql.UniqueIdentifier, row.matchId)
        .input('nickname', sql.NVarChar(20), nickname)
        .input('coins', sql.Int, row.startingCoins)
        .query(`INSERT INTO matchPlayer (matchId, nickname, coins)
                OUTPUT inserted.matchPlayerId, inserted.nickname
                VALUES (@matchId, @nickname, @coins);
                UPDATE [match] SET playerCount = playerCount + 1 WHERE matchId = @matchId;`);
      player = inserted.recordset[0];
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      // uqMatchPlayerNickname: lost a race with another join using the same nickname.
      if (duplicateKeyErrors.has(err.number)) {
        return sendError(reply, 409, 'Conflict', 'Nickname is already taken in this match.', 'NICKNAME_TAKEN');
      }
      throw err;
    }

    return reply.code(201).send({
      token: createToken({ kind: 'player', playerId: player.matchPlayerId, matchId: row.matchId }),
      matchId: row.matchId,
      playerId: player.matchPlayerId,
      nickname: player.nickname,
    });
  });

  app.post('/api/matches/:matchId/start', {
    schema: { params: matchIdParams },
    preHandler: staffOnly,
  }, async (request, reply) => {
    const { matchId } = request.params;
    const { sql } = app.db;
    const pool = await app.db.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let match;
    let round;
    try {
      // UPDLOCK: two start clicks (or a start racing a join) serialize here.
      const { recordset } = await tx.request()
        .input('matchId', sql.UniqueIdentifier, matchId)
        .query('SELECT * FROM [match] WITH (UPDLOCK, ROWLOCK) WHERE matchId = @matchId');
      const row = recordset[0];

      let refusal = null;
      if (!row) {
        refusal = [404, 'Not Found', 'Match not found.'];
      } else if (request.auth.role === 'host' && !sameId(row.hostId, request.auth.staffAccountId)) {
        refusal = [403, 'Forbidden', 'Only the match owner or an admin may start this match.'];
      } else if (row.status !== 'lobby') {
        refusal = [409, 'Conflict', 'Match is not in the lobby.', 'MATCH_NOT_IN_LOBBY'];
      } else if (row.playerCount < 2) {
        refusal = [409, 'Conflict', 'At least 2 players are needed to start.', 'NOT_ENOUGH_PLAYERS'];
      }
      if (refusal) {
        await tx.rollback();
        return sendError(reply, ...refusal);
      }

      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + row.durationSeconds * 1000);
      round = {
        roundNumber: 1,
        startedAt,
        endsAt: new Date(Math.min(startedAt.getTime() + ROUND_MS, endsAt.getTime())),
      };
      const lifetimeRounds = generateLifetimeRounds();

      const updated = await tx.request()
        .input('matchId', sql.UniqueIdentifier, matchId)
        .input('startedAt', sql.DateTime2, startedAt)
        .input('endsAt', sql.DateTime2, endsAt)
        .input('roundEndsAt', sql.DateTime2, round.endsAt)
        .input('pointValue', sql.Int, generatePointValue())
        .input('lifetimeRounds', sql.Int, lifetimeRounds)
        .query(`UPDATE [match] SET status = 'running', startedAt = @startedAt, endsAt = @endsAt
                OUTPUT inserted.*
                WHERE matchId = @matchId;
                INSERT INTO matchRound (matchId, roundNumber, startedAt, endsAt)
                VALUES (@matchId, 1, @startedAt, @roundEndsAt);
                INSERT INTO item (matchId, pointValue, spawnRound, lifetimeRounds, roundsLeft)
                VALUES (@matchId, @pointValue, 1, @lifetimeRounds, @lifetimeRounds);`);
      match = updated.recordset[0];
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }

    // After the commit, so the worker never sees a job for a round that isn't saved.
    // If Redis is down here the match is running with no scheduled round; the error
    // surfaces as a 500 and the host can see it.
    await app.queue.enqueueRoundResolution({
      matchId: match.matchId,
      roundNumber: round.roundNumber,
      delayMs: round.endsAt.getTime() - Date.now(),
    });
    return toMatch(match);
  });

  app.get('/api/matches/:matchId/state', {
    schema: { params: matchIdParams },
    preHandler: [authenticate, requirePlayerInMatch],
  }, async (request, reply) => {
    const { matchId } = request.params;
    const { auth } = request;
    const isPlayer = auth.role === 'player';
    const { sql } = app.db;
    const pool = await app.db.getPool();
    const query = (text, inputs = {}) => {
      const req = pool.request().input('matchId', sql.UniqueIdentifier, matchId);
      for (const [name, [type, value]] of Object.entries(inputs)) req.input(name, type, value);
      return req.query(text).then((r) => r.recordset);
    };

    const [row] = await query('SELECT * FROM [match] WHERE matchId = @matchId');
    if (!row) return sendError(reply, 404, 'Not Found', 'Match not found.');
    if (auth.role === 'host' && !sameId(row.hostId, auth.staffAccountId)) {
      return sendError(reply, 403, 'Forbidden', 'Only the match owner or an admin may view this match.');
    }

    const [round] = await query(`SELECT TOP 1 roundNumber, endsAt FROM matchRound
                                 WHERE matchId = @matchId ORDER BY roundNumber DESC`);
    const currentRound = row.status === 'lobby' || !round ? 0 : round.roundNumber;
    const running = row.status === 'running';

    const playerRows = await query(`SELECT matchPlayerId, nickname, coins, score FROM matchPlayer
                                    WHERE matchId = @matchId ORDER BY joinedAt, matchPlayerId`);
    const itemRows = await query(`SELECT i.itemId, i.pointValue, i.spawnRound, i.lifetimeRounds, i.roundsLeft,
                                         i.status, i.currentBid, i.closedRound,
                                         i.currentBidHolderId, h.nickname AS currentBidHolderNickname,
                                         i.winnerPlayerId, w.nickname AS winnerNickname
                                  FROM item i
                                  LEFT JOIN matchPlayer h ON h.matchPlayerId = i.currentBidHolderId
                                  LEFT JOIN matchPlayer w ON w.matchPlayerId = i.winnerPlayerId
                                  WHERE i.matchId = @matchId
                                  ORDER BY i.spawnRound, i.itemId`);

    // The caller's own sealed bids: running total per item and whether they bid this round.
    const myBids = new Map();
    let me = null;
    if (isPlayer) {
      const mine = playerRows.find((p) => sameId(p.matchPlayerId, auth.playerId));
      if (mine) {
        me = { playerId: mine.matchPlayerId, nickname: mine.nickname, coins: mine.coins, score: mine.score };
      }
      const bidRows = await query(`SELECT b.itemId, SUM(b.amount) AS myTotal,
                                          MAX(CASE WHEN b.roundNumber = @currentRound THEN 1 ELSE 0 END) AS bidThisRound
                                   FROM bid b JOIN item i ON i.itemId = b.itemId
                                   WHERE i.matchId = @matchId AND b.matchPlayerId = @playerId
                                   GROUP BY b.itemId`, {
        playerId: [sql.UniqueIdentifier, auth.playerId],
        currentRound: [sql.Int, currentRound],
      });
      for (const b of bidRows) myBids.set(String(b.itemId).toLowerCase(), b);
    }
    const myBidFor = (itemId) => myBids.get(String(itemId).toLowerCase());
    const ref = (playerId, nickname) => (playerId ? { playerId, nickname } : null);

    const openItems = [];
    const closedItems = [];
    for (const it of itemRows) {
      const base = {
        itemId: it.itemId,
        pointValue: it.pointValue,
        spawnRound: it.spawnRound,
        lifetimeRounds: it.lifetimeRounds,
      };
      const bid = myBidFor(it.itemId);
      if (it.status === 'open') {
        const item = {
          ...base,
          roundsLeft: it.roundsLeft,
          currentBid: it.currentBid,
          currentBidHolder: ref(it.currentBidHolderId, it.currentBidHolderNickname),
        };
        if (isPlayer) {
          item.myTotal = bid ? bid.myTotal : 0;
          item.myBidThisRound = Boolean(bid && bid.bidThisRound);
        }
        openItems.push(item);
      } else {
        const item = {
          ...base,
          closedRound: it.closedRound,
          winningBid: it.currentBid,
          winner: ref(it.winnerPlayerId, it.winnerNickname),
        };
        if (isPlayer) item.myTotal = bid ? bid.myTotal : 0;
        closedItems.push(item);
      }
    }

    const state = {
      matchId: row.matchId,
      status: row.status,
      serverTime: new Date().toISOString(),
      currentRound,
      roundEndsAt: running && round ? round.endsAt : null,
      matchEndsAt: running ? row.endsAt : null,
      settings: toMatch(row).settings,
      me,
      // PublicPlayer only: no coins for anyone (AC-4).
      players: playerRows.map((p) => ({ playerId: p.matchPlayerId, nickname: p.nickname, score: p.score })),
      openItems,
      closedItems,
    };
    if (!isPlayer) state.joinCode = row.joinCode;
    return state;
  });
};

module.exports.generateJoinCode = generateJoinCode;
module.exports.toMatch = toMatch;
