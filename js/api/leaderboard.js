// js/api/leaderboard.js
'use strict';

module.exports = async function leaderboardRoutes(app) {
  app.get('/api/leaderboard', async (request, reply) => {
    const pool = await app.db.getPool();
    const result = await pool.request()
      .input('limit', app.db.sql.Int, 10)
      .query('SELECT TOP (@limit) nickname, score FROM leaderboardEntry ORDER BY score DESC');
    return result.recordset;   // Fastify sends this as JSON
  });
};