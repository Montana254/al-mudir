'use strict';

const { redis } = require('./redis');

const REMINDER_INTERVAL_MS = 3 * 60 * 1000;
const GLOBAL_SWEEP_INTERVAL_MS = 3 * 60 * 1000;
const GLOBAL_SWEEP_KEY = 'system:last_kyc_reminder_sweep_at';

async function sendTelegramMessage(token, chat, text) {
  if (!token || !chat || !text) return;
  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: text.substring(0, 4000), disable_notification: false })
  });
}

function hasCompleteKycSubmission(user, docs) {
  if (!user || user.kycState !== 'pending' || !user.kycData) return false;

  const data = user.kycData;
  const address = data.address || {};
  const idType = String(data.idType || '').toLowerCase();
  const requiresBack = idType === 'national_id' || idType === 'drivers_license' || idType === 'residence_permit';

  if (!data.fullName || !data.dob || !data.nationality || !data.submittedAt) return false;
  if (!address.street || !address.city || !address.country) return false;
  if (!data.idDocNumber || !data.idDocFrontName || !data.residenceDocName) return false;
  if (requiresBack && !data.idDocBackName) return false;
  if (!docs || !docs.idDocFront || !docs.residenceDoc) return false;
  if (requiresBack && !docs.idDocBack) return false;

  return true;
}

async function sendPendingKycReminders(options) {
  const opts = options || {};
  const force = !!opts.force;
  const nowTs = Date.now();
  const nowIso = new Date(nowTs).toISOString();

  const lastSweepRaw = await redis('GET', GLOBAL_SWEEP_KEY);
  const lastSweepAt = Number(lastSweepRaw || 0);
  if (!force && lastSweepAt && (nowTs - lastSweepAt) < GLOBAL_SWEEP_INTERVAL_MS) {
    return { sent: 0, emails: [], skipped: true, reason: 'throttled' };
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const userDataRaw = await redis('GET', 'system:registered_users');
  const userData = (userDataRaw && typeof userDataRaw === 'object') ? userDataRaw : { count: 0, users: [] };

  const remindedUsers = [];
  const registeredUsers = userData.users || [];
  for (const entry of registeredUsers) {
    const email = String(entry && entry.email || '').toLowerCase();
    if (!email) continue;

    const userRaw = await redis('GET', 'user:' + email);
    if (!userRaw) continue;

    const user = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;
    const docsRaw = await redis('GET', 'kyc_docs:' + email);
    const docs = docsRaw ? (typeof docsRaw === 'string' ? JSON.parse(docsRaw) : docsRaw) : null;
    if (!hasCompleteKycSubmission(user, docs)) continue;

    const reminderKey = 'kyc_reminder:' + email;
    const lastReminderRaw = await redis('GET', reminderKey);
    const lastReminderAt = Number(lastReminderRaw || 0);
    if (!force && lastReminderAt && (nowTs - lastReminderAt) < REMINDER_INTERVAL_MS) continue;

    remindedUsers.push({
      email: email,
      name: user.name || entry.name || 'Client',
      submittedAt: user.kycData && user.kycData.submittedAt ? user.kycData.submittedAt : 'unknown'
    });
    await redis('SET', reminderKey, String(nowTs));
    await redis('EXPIRE', reminderKey, 7 * 24 * 60 * 60);
  }

  if (remindedUsers.length > 0 && token && chat) {
    const kycMsg = [
      '⏳ KYC REMINDER',
      '================',
      'Pending verification request(s) requiring admin review:',
      '',
      remindedUsers.map(function(reminder) {
        return '• ' + reminder.email + ' — ' + reminder.name + ' — submitted ' + reminder.submittedAt;
      }).join('\n'),
      '',
      'Reminder cadence target: every 3 minutes while traffic is active.',
      'Time: ' + nowIso
    ].join('\n');
    await sendTelegramMessage(token, chat, kycMsg);
  }

  await redis('SET', GLOBAL_SWEEP_KEY, String(nowTs));
  await redis('EXPIRE', GLOBAL_SWEEP_KEY, 7 * 24 * 60 * 60);

  return {
    sent: remindedUsers.length,
    emails: remindedUsers.map(function(reminder) { return reminder.email; }),
    skipped: false
  };
}

module.exports = {
  REMINDER_INTERVAL_MS,
  hasCompleteKycSubmission,
  sendPendingKycReminders,
  sendTelegramMessage
};