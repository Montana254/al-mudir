'use strict';
/**
 * AL-MUDIR AUTONOMOUS GROWTH AGENT
 * ═══════════════════════════════════════════════════════════
 * Integrates with existing infrastructure:
 *  - Treasury Engine (TRC-20 Master Wallet)
 *  - CoinGecko market data (real API)
 *  - Growth Engine (content + SEO + lead agents)
 *  - Telegram notifications
 *
 * Runs autonomously on schedule via GitHub Actions
 * or Vercel Cron. No human input required.
 * ═══════════════════════════════════════════════════════════
 */

const { RevenueEngine } = require('../lib/treasury-pro');
const { runAllAgents, formatAgentReport, sendTelegram } = require('../api/_lib/growth-engine');

const TREASURY = RevenueEngine.MASTER_TREASURY;
const AGENT_VERSION = '1.0.0';
const SITE_URL = process.env.SITE_URL || 'https://al-mudir.org';

// ── Market Trend Scanner ──────────────────────────────
// Uses CoinGecko (real, free API) instead of fictional endpoints
async function scanGlobalTrends() {
  const results = { crypto: [], topMovers: [], timestamp: new Date().toISOString() };

  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h';
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error('CoinGecko API returned ' + resp.status);
    const coins = await resp.json();

    results.crypto = coins.map(c => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      change24h: c.price_change_percentage_24h,
      rank: c.market_cap_rank
    }));

    // High-turnover movers (volume > $1M and significant price movement)
    results.topMovers = results.crypto
      .filter(c => c.volume24h > 1000000 && Math.abs(c.change24h || 0) > 3)
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 10);

  } catch (err) {
    results.error = err.message;
  }

  return results;
}

// ── Forex Rate Monitor ────────────────────────────────
async function scanForexRates() {
  const results = { rates: {}, timestamp: new Date().toISOString() };

  try {
    const resp = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) throw new Error('Forex API returned ' + resp.status);
    const data = await resp.json();
    const watchPairs = ['EUR', 'GBP', 'JPY', 'AED', 'CHF', 'AUD', 'CAD', 'SGD', 'HKD', 'ZAR', 'KES'];
    for (const pair of watchPairs) {
      if (data.rates[pair]) {
        results.rates['USD/' + pair] = +(1 / data.rates[pair]).toFixed(6);
      }
    }
  } catch (err) {
    results.error = err.message;
  }

  return results;
}

// ── System Health Check ───────────────────────────────
async function checkSystemHealth() {
  const checks = {
    site: { url: SITE_URL, status: 'unknown' },
    api: { url: SITE_URL + '/api/wallet', status: 'unknown' },
    timestamp: new Date().toISOString()
  };

  // Check site
  try {
    const r = await fetch(SITE_URL, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    checks.site.status = r.ok ? 'operational' : 'degraded';
    checks.site.statusCode = r.status;
  } catch (err) {
    checks.site.status = 'down';
    checks.site.error = err.message;
  }

  // Check API (gateway_status is public)
  try {
    const r = await fetch(SITE_URL + '/api/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gateway_status' }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await r.json();
    checks.api.status = data.ok ? 'operational' : 'degraded';
    checks.api.gateways = data.gateways ? Object.keys(data.gateways).length : 0;
  } catch (err) {
    checks.api.status = 'down';
    checks.api.error = err.message;
  }

  return checks;
}

// ── Revenue Summary (via system report) ───────────────
async function getRevenueSummary() {
  const summary = {
    treasury: TREASURY,
    network: 'TRON (TRC-20)',
    asset: 'USDT',
    systemFeeRate: (RevenueEngine.SYSTEM_PERFORMANCE_FEE * 100) + '%',
    botActivationPrice: '$' + RevenueEngine.BOT_ACTIVATION_USDT,
    timestamp: new Date().toISOString()
  };

  return summary;
}

// ── Format Autonomous Report ──────────────────────────
function formatAutonomousReport(trends, forex, health, revenue, agentReport) {
  const movers = (trends.topMovers || []).slice(0, 5);
  const moversText = movers.length > 0
    ? movers.map(m => `  ${m.symbol}: $${m.price?.toLocaleString() || '?'} (${m.change24h > 0 ? '+' : ''}${m.change24h?.toFixed(1)}%) Vol: $${(m.volume24h / 1e6).toFixed(1)}M`).join('\n')
    : '  No significant movers detected';

  const forexText = Object.entries(forex.rates || {}).slice(0, 6)
    .map(([pair, rate]) => `  ${pair}: ${rate}`)
    .join('\n') || '  Rates unavailable';

  const siteStatus = health.site?.status === 'operational' ? '🟢' : '🔴';
  const apiStatus = health.api?.status === 'operational' ? '🟢' : '🔴';

  return `<b>🤖 AL-MUDIR AUTONOMOUS AGENT v${AGENT_VERSION}</b>
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>
⏱ ${new Date().toISOString()}

<b>📈 MARKET TRENDS (24h)</b>
${moversText}

<b>💱 FOREX RATES (USD)</b>
${forexText}

<b>🔧 SYSTEM HEALTH</b>
${siteStatus} Site: ${health.site?.status || 'unknown'}
${apiStatus} API: ${health.api?.status || 'unknown'} (${health.api?.gateways || 0} gateways)

<b>💰 TREASURY</b>
  Wallet: <code>${revenue.treasury}</code>
  Network: ${revenue.network}
  Fee Rate: ${revenue.systemFeeRate}
  Bot Price: ${revenue.botActivationPrice}

<b>🚀 GROWTH AGENTS</b>
  ${agentReport?.allOperational ? '✅ ALL 5 AGENTS OPERATIONAL' : '⚠️ CHECK REQUIRED'}
  Execution: ${agentReport?.executionMs || 0}ms

<i>Autonomous cycle complete. Next run in 15 minutes.</i>`;
}

// ── Main Execution ────────────────────────────────────
async function main() {
  console.log('[growth-agent] Starting autonomous cycle...');
  const start = Date.now();

  try {
    // Run all operations in parallel for maximum speed
    const [trends, forex, health, revenue, agentReport] = await Promise.all([
      scanGlobalTrends(),
      scanForexRates(),
      checkSystemHealth(),
      getRevenueSummary(),
      runAllAgents()
    ]);

    const elapsed = Date.now() - start;
    console.log(`[growth-agent] Data collection complete in ${elapsed}ms`);

    // Format and send report via Telegram
    const report = formatAutonomousReport(trends, forex, health, revenue, agentReport);
    const telegramResult = await sendTelegram(report);

    // Also send the growth engine's detailed daily report
    const detailedReport = formatAgentReport(agentReport);
    await sendTelegram(detailedReport);

    console.log(`[growth-agent] Reports sent. Telegram: ${telegramResult?.ok ? 'OK' : 'FAILED'}`);
    console.log(`[growth-agent] Cycle complete in ${Date.now() - start}ms`);

    return {
      ok: true,
      executionMs: Date.now() - start,
      trends: trends.topMovers?.length || 0,
      health: health.site?.status,
      agentsOperational: agentReport?.allOperational
    };

  } catch (err) {
    console.error('[growth-agent] FATAL:', err.message);

    // Try to notify via Telegram even on failure
    try {
      await sendTelegram(`🔴 <b>AL-MUDIR Agent ERROR</b>\n\n${err.message}\n\n<i>${new Date().toISOString()}</i>`);
    } catch { /* silent */ }

    return { ok: false, error: err.message };
  }
}

// Run if called directly (GitHub Actions or CLI)
if (require.main === module) {
  main().then(result => {
    console.log('[growth-agent] Result:', JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }).catch(err => {
    console.error('[growth-agent] Uncaught:', err);
    process.exit(1);
  });
}

module.exports = { main, scanGlobalTrends, scanForexRates, checkSystemHealth };
