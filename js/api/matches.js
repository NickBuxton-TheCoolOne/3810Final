// js/api/matches.js — match lifecycle routes (openapi.yaml: createMatch, startMatch).
//
//   POST /api/matches                   Host/Admin: open a lobby with a fresh join code.
//   POST /api/matches/{matchId}/start   owning Host or Admin: lobby -> running, open
//                                       round 1, spawn its item, schedule its resolution.
'use strict';
const crypto = require('node:crypto');
const { authenticate, requireRole } = require('./authHooks');
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
};

module.exports.generateJoinCode = generateJoinCode;
module.exports.toMatch = toMatch;
