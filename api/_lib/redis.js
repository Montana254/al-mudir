'use strict';

// ──────────────────────────────────────────────────────────
// Telegram-backed key-value store.
// Stores the entire DB as a pinned JSON document in a
// Telegram chat — zero external dependencies beyond the bot.
// Drop-in replacement for the previous Upstash Redis client.
// ──────────────────────────────────────────────────────────

let _cache = null;
let _cacheTime = 0;
let _dirty = false;
let _pinnedMsgId = null;

const STALE_MS = 4000; // re-download if cache is older than 4 s

function botToken() { return (process.env.TELEGRAM_BOT_TOKEN || '').trim(); }
function dbChatId() { return (process.env.TELEGRAM_DB_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim(); }

async function tg(method, payload) {
  const tk = botToken();
  if (!tk) throw new Error('redis_not_configured');
  const r = await fetch('https://api.telegram.org/bot' + tk + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return r.json();
}

async function tgUpload(method, form) {
  const tk = botToken();
  if (!tk) throw new Error('redis_not_configured');
  const r = await fetch('https://api.telegram.org/bot' + tk + '/' + method, {
    method: 'POST',
    body: form
  });
  return r.json();
}

// ── Load ────────────────────────────────────────────────
async function loadDb() {
  if (_cache !== null && (Date.now() - _cacheTime) < STALE_MS) return _cache;

  const tk = botToken();
  const chat = dbChatId();
  if (!tk || !chat) throw new Error('redis_not_configured');

  const chatRes = await tg('getChat', { chat_id: chat });
  if (!chatRes.ok) throw new Error('redis_not_configured');

  const pinned = chatRes.result && chatRes.result.pinned_message;
  if (pinned && pinned.document) {
    _pinnedMsgId = pinned.message_id;
    const fileRes = await tg('getFile', { file_id: pinned.document.file_id });
    if (fileRes.ok && fileRes.result && fileRes.result.file_path) {
      const url = 'https://api.telegram.org/file/bot' + tk + '/' + fileRes.result.file_path;
      const body = await (await fetch(url)).text();
      try { _cache = JSON.parse(body); } catch { _cache = {}; }
    } else { _cache = {}; }
  } else {
    _pinnedMsgId = null;
    _cache = {};
  }

  _cacheTime = Date.now();
  _dirty = false;
  return _cache;
}

// ── Flush ───────────────────────────────────────────────
async function flushDb() {
  if (!_dirty || _cache === null) return;

  // Garbage-collect expired entries
  const now = Date.now();
  const keys = Object.keys(_cache);
  for (let i = 0; i < keys.length; i++) {
    const e = _cache[keys[i]];
    if (e && e._exp && now > e._exp) delete _cache[keys[i]];
  }

  const json = JSON.stringify(_cache);
  const blob = new Blob([json], { type: 'application/json' });
  const chat = dbChatId();

  if (_pinnedMsgId) {
    const form = new FormData();
    form.append('chat_id', String(chat));
    form.append('message_id', String(_pinnedMsgId));
    form.append('media', JSON.stringify({ type: 'document', media: 'attach://file' }));
    form.append('file', blob, 'almudir_db.json');
    const r = await tgUpload('editMessageMedia', form);
    if (!r.ok) {
      // Pinned msg may have been deleted — create fresh
      _pinnedMsgId = null;
      return flushDb();
    }
  } else {
    const form = new FormData();
    form.append('chat_id', String(chat));
    form.append('document', blob, 'almudir_db.json');
    form.append('caption', '\uD83D\uDD10 AL-MUDIR Database');
    form.append('disable_notification', 'true');
    const r = await tgUpload('sendDocument', form);
    if (!r.ok) throw new Error('db_save_failed: ' + (r.description || 'unknown'));
    _pinnedMsgId = r.result.message_id;
    await tg('pinChatMessage', {
      chat_id: chat,
      message_id: _pinnedMsgId,
      disable_notification: true
    });
  }

  _dirty = false;
  _cacheTime = Date.now();
}

// ── Redis-compatible interface ──────────────────────────
async function redis(...args) {
  const cmd = String(args[0] || '').toUpperCase();
  const key = String(args[1] || '');

  switch (cmd) {
    case 'GET': {
      const db = await loadDb();
      const entry = db[key];
      if (!entry || entry._val === undefined) return null;
      if (entry._exp && Date.now() > entry._exp) {
        delete db[key];
        _dirty = true;
        return null;
      }
      return entry._val;
    }
    case 'SET': {
      const db = await loadDb();
      db[key] = { _val: args[2], _ts: Date.now() };
      _dirty = true;
      await flushDb();
      return 'OK';
    }
    case 'DEL': {
      const db = await loadDb();
      if (db[key]) { delete db[key]; _dirty = true; await flushDb(); }
      return 1;
    }
    case 'EXPIRE': {
      const db = await loadDb();
      if (db[key]) {
        db[key]._exp = Date.now() + Number(args[2]) * 1000;
        _dirty = true;
      }
      return 1;
    }
    default:
      throw new Error('unsupported_redis_cmd: ' + cmd);
  }
}

// ── Wrapper: auto-flush after handler completes ─────────
function withDb(handler) {
  return async function wrappedHandler(req, res) {
    // Reset cache at request boundary for correctness
    _cache = null;
    _cacheTime = 0;
    _dirty = false;
    _pinnedMsgId = null;
    try {
      return await handler(req, res);
    } finally {
      try { await flushDb(); } catch { /* best-effort flush */ }
    }
  };
}

module.exports = { redis, withDb };
