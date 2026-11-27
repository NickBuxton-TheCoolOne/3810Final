'use strict';
const { sql } = require('../config/db');
const { readToken } = require('./authTokens');

function fail(reply, statusCode, error, message) {
  return reply.code(statusCode).send({ statusCode, error, message });
}

// Step 1: who is calling? Sets request.auth = { kind, role, ... } or sends 401.
async function authenticate(request, reply) {
  const header = request.headers.authorization || '';
  const claims = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null;
  if (!claims) return fail(reply, 401, 'Unauthorized', 'Missing, invalid or expired token.');

  if (claims.kind === 'staff') {
    // Re-check the account on every request so a disabled host is locked out at once (AC-21).
    const pool = await request.server.db.getPool();
    const { recordset } = await pool.request()
      .input('staffAccountId', sql.UniqueIdentifier, claims.staffAccountId)
      .query('SELECT role, isActive FROM staffAccount WHERE staffAccountId = @staffAccountId');
    const row = recordset[0];
    if (!row || !row.isActive) return fail(reply, 401, 'Unauthorized', 'Missing, invalid or expired token.');
    request.auth = { ...claims, role: row.role };
  } else {
    request.auth = { ...claims, role: 'player' };
  }
}

// Step 2: is this role allowed here? Sends 403 if not.
function requireRole(...roles) {
  return async function checkRole(request, reply) {
    if (!roles.includes(request.auth.role)) {
      return fail(reply, 403, 'Forbidden', 'Your role may not perform this action.');
    }
  };
}

// Player tokens only work on their own match. Any other match looks like it doesn't exist (AC-16).
async function requirePlayerInMatch(request, reply) {
  if (request.auth.role === 'player' && request.auth.matchId !== request.params.matchId) {
    return fail(reply, 404, 'Not Found', 'Match not found.');
  }
}

module.exports = { authenticate, requireRole, requirePlayerInMatch };