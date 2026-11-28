// js/api/admin.js — Admin-only account routes (openapi.yaml: createHost).
//
//   POST /api/admin/hosts   Admin: create a Host account (AC-21). The body has no role
//                           field, so this can never create an Admin (AC-17).
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
};
