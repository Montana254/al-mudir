'use strict';
const { generateUserId } = require('./auth-utils');

async function assignUniqueUserId(redis, email) {
  for (let i = 0; i < 6; i++) {
    const candidate = generateUserId();
    const existing = await redis('GET', 'userid:' + candidate);
    if (!existing || existing === email) {
      await redis('SET', 'userid:' + candidate, email);
      return candidate;
    }
  }
  throw new Error('user_id_generation_failed');
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return value;
  return value.slice(0, 2) + '***' + value.slice(at);
}

function maskPhone(phone) {
  const value = String(phone || '').trim();
  if (value.length < 5) return value;
  return value.slice(0, 3) + '***' + value.slice(-2);
}

function getOtpDeliveryPreview(user) {
  const method = user && user.verificationMethod === 'phone' && user.phone ? 'phone' : 'email';
  const target = method === 'phone' ? maskPhone(user.phone) : maskEmail(user.email);
  return { method, target };
}

async function ensureUserRecord(redis, user) {
  let changed = false;
  const email = String(user && user.email || '').toLowerCase();

  if (!user.userId) {
    user.userId = await assignUniqueUserId(redis, email);
    changed = true;
  } else {
    const mappedEmail = await redis('GET', 'userid:' + user.userId);
    if (!mappedEmail) {
      await redis('SET', 'userid:' + user.userId, email);
    }
  }

  if (!user.otpChannel || !['email', 'phone'].includes(user.otpChannel)) {
    user.otpChannel = 'email';
    changed = true;
  }
  if (!user.verificationMethod || !['email', 'phone'].includes(user.verificationMethod)) {
    user.verificationMethod = 'email';
    changed = true;
  }

  if (changed) {
    user.updatedAt = new Date().toISOString();
  }

  return { user, changed };
}

function toSafeProfile(user) {
  const { passwordHash: _h, passwordSalt: _s, ...safeProfile } = user;
  return safeProfile;
}

function profileStorageKey(email) {
  return 'user_profile:' + String(email || '').toLowerCase();
}

async function saveUserProfileSnapshot(redis, user) {
  if (!user || !user.email) return;
  const snapshot = {
    ...toSafeProfile(user),
    profileSavedAt: new Date().toISOString()
  };
  await redis('SET', profileStorageKey(user.email), JSON.stringify(snapshot));
}

module.exports = {
  assignUniqueUserId,
  ensureUserRecord,
  getOtpDeliveryPreview,
  toSafeProfile,
  profileStorageKey,
  saveUserProfileSnapshot
};