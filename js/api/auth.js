// js/api/auth.js — POST /api/auth/login (openapi.yaml: LoginRequest -> LoginResponse).
'use strict';
const { verifyPassword, createToken } = require('./authTokens');

const loginBody = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 50 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
};

module.exports = async function authRoutes(app) {
  app.post('/api/auth/login', { schema: { body: loginBody } }, async (request, reply) => {
    const { username, password } = request.body;
    const pool = await app.db.getPool();
    const { recordset } = await pool.request()
      .input('username', app.db.sql.NVarChar(50), username)
      .query(`SELECT staffAccountId, username, passwordHash, role, isActive
              FROM staffAccount WHERE username = @username`);
    const staff = recordset[0];

    // Unknown user, wrong password and disabled account all get the same 401 (AC-17).
    const ok = staff && staff.isActive && await verifyPassword(password, staff.passwordHash);
    if (!ok) {
      return reply.code(401).send({
        statusCode: 401, error: 'Unauthorized', message: 'Invalid username or password.',
      });
    }

    return {
      token: createToken({ kind: 'staff', staffAccountId: staff.staffAccountId }),
      staff: {
        staffId: staff.staffAccountId,
        username: staff.username,
        role: staff.role,
        isActive: staff.isActive,
      },
    };
  });
};
