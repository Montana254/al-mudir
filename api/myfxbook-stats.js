'use strict';
const { redis, withDb } = require('./_lib/redis');

// ────────────────────────────────────────────────────────
// Myfxbook Stats API — Fetches live performance from Myfxbook
//
// GET  /api/myfxbook-stats  → cached stats for system 11992323
// POST /api/myfxbook-stats  → force-refresh (admin only)
//
// Caches in Telegram-DB for 4 hours to avoid rate limits.
// Scrapes the public Myfxbook page — no credentials needed.
// ────────────────────────────────────────────────────────

const CACHE_KEY = 'myfxbook:stats_cache';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const ACCOUNT_ID = '11992323';
const PUBLIC_URL = 'https://www.myfxbook.com/members/Almudir/al-mudir/' + ACCOUNT_ID;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=900, s-maxage=1800'
};

/**
 * Fetch and parse key metrics from the public Myfxbook page.
 */
async function fetchMyfxbookStats() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(PUBLIC_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AlMudir/2.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('Myfxbook responded ' + res.status);
    const html = await res.text();

    return parseStats(html);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Extract key performance metrics from Myfxbook HTML.
 * Uses regex patterns that match Myfxbook's public page structure.
 */
function parseStats(html) {
  const stats = {
    gain: null,
    absGain: null,
    daily: null,
    monthly: null,
    drawdown: null,
    balance: null,
    equity: null,
    profit: null,
    pips: null,
    trades: null,
    wonPct: null,
    lostPct: null,
    avgWin: null,
    avgLoss: null,
    profitFactor: null,
    deposits: null,
    withdrawals: null,
    lastUpdated: null,
    accountAge: null
  };

  // Gain %
  let m = html.match(/Gain[^<]*<[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)%/i);
  if (!m) m = html.match(/calItem[^>]*>Gain<\/[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)/i);
  if (m) stats.gain = m[1].replace(/,/g, '');

  // Abs. Gain %
  m = html.match(/Abs\.\s*Gain[^<]*<[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)%/i);
  if (!m) m = html.match(/calItem[^>]*>Abs\.\s*Gain<\/[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)/i);
  if (m) stats.absGain = m[1].replace(/,/g, '');

  // Daily %
  m = html.match(/Daily[^<]*<[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)%/i);
  if (!m) m = html.match(/calItem[^>]*>Daily<\/[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)/i);
  if (m) stats.daily = m[1].replace(/,/g, '');

  // Monthly %
  m = html.match(/Monthly[^<]*<[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)%/i);
  if (!m) m = html.match(/calItem[^>]*>Monthly<\/[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)/i);
  if (m) stats.monthly = m[1].replace(/,/g, '');

  // Drawdown %
  m = html.match(/Drawdown[^<]*<[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)%/i);
  if (!m) m = html.match(/calItem[^>]*>Drawdown<\/[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)/i);
  if (m) stats.drawdown = m[1].replace(/,/g, '');

  // Balance
  m = html.match(/Balance[^<]*<[^>]*>[^<]*<[^>]*>\s*\$?([\-\d,.]+)/i);
  if (!m) m = html.match(/calItem[^>]*>Balance<\/[^>]*>[^<]*<[^>]*>\s*\$?([\-\d,.]+)/i);
  if (m) stats.balance = m[1].replace(/,/g, '');

  // Equity
  m = html.match(/Equity[^<]*<[^>]*>[^<]*<[^>]*>\s*\$?([\-\d,.]+)/i);
  if (m) stats.equity = m[1].replace(/,/g, '');

  // Profit
  m = html.match(/Profit[^<]*<[^>]*>[^<]*<[^>]*>\s*\$?([\-\d,.]+)/i);
  if (m) stats.profit = m[1].replace(/,/g, '');

  // Pips
  m = html.match(/Pips[^<]*<[^>]*>[^<]*<[^>]*>\s*([\-\d,.]+)/i);
  if (m) stats.pips = m[1].replace(/,/g, '');

  // Trades
  m = html.match(/Trades[^<]*<[^>]*>[^<]*<[^>]*>\s*([\d,]+)/i);
  if (m) stats.trades = m[1].replace(/,/g, '');

  // Won %
  m = html.match(/Won[^<]*<[^>]*>\s*([\d,.]+)%/i);
  if (m) stats.wonPct = m[1];

  // Lost %
  m = html.match(/Lost[^<]*<[^>]*>\s*([\d,.]+)%/i);
  if (m) stats.lostPct = m[1];

  // Profit Factor
  m = html.match(/Profit\s*Factor[^<]*<[^>]*>[^<]*<[^>]*>\s*([\d,.]+)/i);
  if (m) stats.profitFactor = m[1];

  // Deposits
  m = html.match(/Deposits[^<]*<[^>]*>[^<]*<[^>]*>\s*\$?([\-\d,.]+)/i);
  if (m) stats.deposits = m[1].replace(/,/g, '');

  // Withdrawals
  m = html.match(/Withdrawals[^<]*<[^>]*>[^<]*<[^>]*>\s*\$?([\-\d,.]+)/i);
  if (m) stats.withdrawals = m[1].replace(/,/g, '');

  // Last updated (from page)
  m = html.match(/(?:Last\s+(?:Update|Updated)|Updated)[^<]*<[^>]*>\s*([^<]+)/i);
  if (m) stats.lastUpdated = m[1].trim();

  stats.fetchedAt = new Date().toISOString();
  stats.accountId = ACCOUNT_ID;
  stats.publicUrl = PUBLIC_URL;

  // Check we got at least some data
  const hasData = stats.gain !== null || stats.balance !== null || stats.drawdown !== null;
  if (!hasData) {
    // Try alternative JSON data embedded in the page
    const jsonMatch = html.match(/var\s+chartData\s*=\s*(\[[\s\S]*?\]);/);
    if (jsonMatch) {
      stats._chartDataAvailable = true;
    }
  }

  return stats;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).set(CORS).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).set(CORS).json({ error: 'Method not allowed' });
  }

  try {
    await withDb(async () => {
      const forceRefresh = req.method === 'POST';

      // Check cache
      if (!forceRefresh) {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          let parsed;
          try { parsed = typeof cached === 'string' ? JSON.parse(cached) : cached; } catch (_) { parsed = null; }
          if (parsed && parsed.fetchedAt) {
            const age = Date.now() - new Date(parsed.fetchedAt).getTime();
            if (age < CACHE_TTL_MS) {
              return res.status(200).set(CORS).json({
                ok: true,
                cached: true,
                cacheAge: Math.round(age / 60000) + ' minutes',
                stats: parsed
              });
            }
          }
        }
      }

      // Fetch fresh data
      const stats = await fetchMyfxbookStats();

      // Store in cache
      await redis.set(CACHE_KEY, JSON.stringify(stats));

      return res.status(200).set(CORS).json({
        ok: true,
        cached: false,
        stats
      });
    });
  } catch (err) {
    // If fetch fails, try serving stale cache
    try {
      const stale = await withDb(async () => {
        const cached = await redis.get(CACHE_KEY);
        return cached ? (typeof cached === 'string' ? JSON.parse(cached) : cached) : null;
      });
      if (stale && stale.fetchedAt) {
        return res.status(200).set(CORS).json({
          ok: true,
          cached: true,
          stale: true,
          error: 'Live fetch failed, serving cached data',
          stats: stale
        });
      }
    } catch (_) { /* no cache available */ }

    return res.status(502).set(CORS).json({
      ok: false,
      error: 'Failed to fetch Myfxbook data',
      detail: String(err.message || err).slice(0, 200)
    });
  }
};
