'use strict';

function parseAdminEmails() {
  const raw = String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map(function(email) { return String(email || '').trim().toLowerCase(); })
    .filter(Boolean);
}

function isAdminEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  const admins = parseAdminEmails();
  if (admins.length === 0) return false;
  return admins.includes(target);
}

function attachAdminFlag(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  return {
    ...profile,
    isAdmin: isAdminEmail(profile.email)
  };
}

module.exports = {
  parseAdminEmails,
  isAdminEmail,
  attachAdminFlag
};