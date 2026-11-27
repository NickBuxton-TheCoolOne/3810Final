// db/seeds/seedAdmin.js — developer-run seed for admin accounts.
//
// SPEC.md: "Rows with role = admin are inserted only by developer-run seed
// scripts." There is no API or UI path to create an admin; this is it.
//
// Usage (from the repo root):
//   npm run seed:admin -- <username>
// The password comes from ADMIN_PASSWORD if set, otherwise a hidden prompt.
// It is hashed with the same scrypt format login verifies (js/api/authTokens.js)
// and is never printed or logged.
'use strict';

const readline = require('node:readline');
const { sql, getPool, closePool } = require('../../js/config/db');
const { hashPassword } = require('../../js/api/authTokens');

const minPasswordLength = 12;

// Read a line from the terminal without echoing it.
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = (s) => { if (!rl.stdoutMuted) rl.output.write(s); };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

async function main() {
  const username = (process.argv[2] || process.env.ADMIN_USERNAME || '').trim();
  if (!username || username.length > 50) {
    throw new Error('Give a username of 1-50 characters: npm run seed:admin -- <username>');
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden(`Password for admin "${username}": `);
    const again = await promptHidden('Repeat password: ');
    if (password !== again) throw new Error('Passwords do not match.');
  }
  if (password.length < minPasswordLength || password.length > 200) {
    throw new Error(`Password must be ${minPasswordLength}-200 characters.`);
  }

  const passwordHash = await hashPassword(password);
  const pool = await getPool();

  // Never overwrite an existing account: refuse instead, so a typo can't
  // silently reset someone's password or promote a host to admin.
  const { recordset } = await pool.request()
    .input('username', sql.NVarChar(50), username)
    .input('passwordHash', sql.NVarChar(255), passwordHash)
    .query(`IF EXISTS (SELECT 1 FROM staffAccount WHERE username = @username)
              SELECT CAST(NULL AS UNIQUEIDENTIFIER) AS staffAccountId;
            ELSE
              INSERT INTO staffAccount (username, passwordHash, role, isActive)
              OUTPUT inserted.staffAccountId
              VALUES (@username, @passwordHash, 'admin', 1);`);

  const id = recordset[0] && recordset[0].staffAccountId;
  if (!id) throw new Error(`A staff account named "${username}" already exists; nothing changed.`);
  console.log(`Created admin "${username}" (staffAccountId ${id}).`);
}

main()
  .catch((err) => {
    console.error(`seedAdmin failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
