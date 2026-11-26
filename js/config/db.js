'use strict';

// Shared mssql connection pool (AGENTS.md §2: mssql, parameterized queries, no ORM).
// Every module gets the same pool through getPool(); never create a second one.

const sql = require('mssql');

function toBool(value) {
  return String(value).toLowerCase() === 'true';
}

function buildConfig() {
  return {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: toBool(process.env.DB_ENCRYPT),
      trustServerCertificate: toBool(process.env.DB_TRUST_SERVER_CERTIFICATE),
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

let poolPromise = null;

// Connects on first call; later calls reuse the same promise.
// If the connect fails, the next call tries again.
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(buildConfig())
      .connect()
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

async function closePool() {
  if (!poolPromise) return;
  const pending = poolPromise;
  poolPromise = null;
  try {
    const pool = await pending;
    await pool.close();
  } catch {
    // The connect already failed; nothing to close.
  }
}

module.exports = { sql, getPool, closePool };
