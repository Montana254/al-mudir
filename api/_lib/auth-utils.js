'use strict';
const crypto = require('crypto');

function sanitize(value, max) {
  return String(value || '').replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max);
}

function generateOtp() {
  // 6-digit numeric OTP
  const n = crypto.randomInt ? crypto.randomInt(900000) : Math.floor(Math.random() * 900000);
  return String(100000 + n);
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(32).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), s, 100000, 32, 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve({ hash: key.toString('hex'), salt: s });
    });
  });
}

async function verifyPassword(password, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  const { hash } = await hashPassword(password, storedSalt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { sanitize, generateOtp, generateSessionToken, hashPassword, verifyPassword };
