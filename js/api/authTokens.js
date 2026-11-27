'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const tokenTtlSeconds = 12 * 60 * 60;

// Stored as "scrypt$<salt>$<hash>". Your admin seed script must use this too.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Read the secret on use, not at require time, so tests that never touch tokens
// can build the app without a .env file.
function sign(body) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function createToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + tokenTtlSeconds }))
    .toString('base64url');
  return `${body}.${sign(body)}`;
}

// Returns the claims, or null if the token is forged, malformed or expired.
function readToken(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(body));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, createToken, readToken };