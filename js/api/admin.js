// js/api/admin.js — Admin-only account routes (openapi.yaml: createHost).
//
//   POST /api/admin/hosts   Admin: create a Host account (AC-21). The body has no role
//                           field, so this can never create an Admin (AC-17).
//   POST /api/admin/hosts/{hostId}/disable
//                           Admin: disable a Host (AC-21). Login and the token check in
//                           authHooks already refuse inactive accounts, so this flag is
//                           all it takes. Admins can't be disabled here (404).
'use strict';
const { authenticate, requireRole } = require('./authHooks');
const { hashPassword } = require('./authTokens');

const duplicateKeyErrors = new Set([2601, 2627]);

const createHostBody = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 50 },
    password: { type: 'string', minLength: 8, maxLength: 200 },
  },
};

const hostIdParams = {
  type: 'object',
  required: ['hostId'],
  properties: { hostId: { type: 'string', format: 'uuid' } },
};

module.exports = async function adminRoutes(app) {
  const { sql } = app.db;

  app.post('/api/admin/hosts', {
    schema: { body: createHostBody },
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const { username, password } = request.body;
    const passwordHash = await hashPassword(password);
    const pool = await app.db.getPool();

    let row;
    try {
      // The unique constraint on username decides who wins if two admins race.
      const { recordset } = await pool.request()
        .input('username', sql.NVarChar(50), username)
        .input('passwordHash', sql.NVarChar(255), passwordHash)
        .query(`INSERT INTO staffAccount (username, passwordHash, role, isActive)
                OUTPUT inserted.staffAccountId, inserted.username, inserted.role, inserted.isActive
                VALUES (@username, @passwordHash, 'host', 1)`);
      row = recordset[0];
    } catch (err) {
      if (duplicateKeyErrors.has(err.number)) {
        return reply.code(409).send({
          statusCode: 409, error: 'Conflict', message: 'That username is already taken.', code: 'USERNAME_TAKEN',
        });
      }
      throw err;
    }

    return reply.code(201).send({
      staffId: row.staffAccountId,
      username: row.username,
      role: row.role,
      isActive: row.isActive,
    });
  });

  app.post('/api/admin/hosts/:hostId/disable', {
    schema: { params: hostIdParams },
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const pool = await app.db.getPool();
    // Matching on role keeps Admin accounts out of reach; re-disabling a Host just
    // returns it again, so the call is idempotent.
    const { recordset } = await pool.request()
      .input('hostId', sql.UniqueIdentifier, request.params.hostId)
      .query(`UPDATE staffAccount SET isActive = 0
              OUTPUT inserted.staffAccountId, inserted.username, inserted.role, inserted.isActive
              WHERE staffAccountId = @hostId AND role = 'host'`);
    const row = recordset[0];
    if (!row) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Host not found.' });
    }

    return reply.send({
      staffId: row.staffAccountId,
      username: row.username,
      role: row.role,
      isActive: row.isActive,
    });
  });
};
