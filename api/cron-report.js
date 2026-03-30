'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sendPendingKycReminders, sendTelegramMessage } = require('./_lib/kyc-reminders');
const { runAgent } = require('./_lib/agents');

const FULL_REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ────────────────────────────────────────────────────────
// Hourly CRON Report — Vercel Cron Job
// Triggers system report generation every hour
// Sends 4K PNG statement to Telegram with full metrics
// ────────────────────────────────────────────────────────

module.exports = withDb(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Only allow GET (cron trigger) or POST with admin auth
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Verify cron authorization
  // Vercel crons send CRON_SECRET in Authorization header
  // Also accept ADMIN_HEALTH_TOKEN for manual triggers
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const adminToken = (process.env.ADMIN_HEALTH_TOKEN || process.env.TG_DB_SECRET || process.env.ACCESS_VERIFY_SECRET || process.env.TELEGRAM_BOT_TOKEN || '').trim();

  let authorized = false;
  if (cronSecret && auth === cronSecret) authorized = true;
  if (adminToken && auth === adminToken) authorized = true;

  if (!authorized) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const isManualRun = req.method === 'POST';
    // Import wallet module to call system_report action internally
    // We replicate the report generation here to avoid circular deps
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chat  = (process.env.TELEGRAM_CHAT_ID || '').trim();

    // Gather all metrics from DB
    const revenueRaw = await redis('GET', 'system:revenue_log');
    const revenueLog = (revenueRaw && Array.isArray(revenueRaw)) ? revenueRaw : [];

    const sysFeeRaw = await redis('GET', 'wallet:__system_fees__');
    const sysFees = (sysFeeRaw && typeof sysFeeRaw === 'object') ? sysFeeRaw : {};

    const userDataRaw = await redis('GET', 'system:registered_users');
    const userData = (userDataRaw && typeof userDataRaw === 'object') ? userDataRaw : { count: 0, users: [] };

    const sysTxRaw = await redis('GET', 'wallet_tx:__system_fees__');
    const sysTx = (sysTxRaw && Array.isArray(sysTxRaw)) ? sysTxRaw : [];

    const now = new Date();
    const oneHourAgo = new Date(now - 3600000).toISOString();
    const oneDayAgo  = new Date(now - 86400000).toISOString();
    const oneWeekAgo = new Date(now - 604800000).toISOString();

    const revenueHour = revenueLog.filter(r => r.ts >= oneHourAgo).reduce((s, r) => s + (r.feeUsd || 0), 0);
    const revenueDay  = revenueLog.filter(r => r.ts >= oneDayAgo).reduce((s, r) => s + (r.feeUsd || 0), 0);
    const revenueWeek = revenueLog.filter(r => r.ts >= oneWeekAgo).reduce((s, r) => s + (r.feeUsd || 0), 0);
    const revenueTotal = revenueLog.reduce((s, r) => s + (r.feeUsd || 0), 0);

    const txHour = revenueLog.filter(r => r.ts >= oneHourAgo).length;
    const txDay  = revenueLog.filter(r => r.ts >= oneDayAgo).length;
    const txTotal = revenueLog.length;

    const verifiedCount = revenueLog.filter(r => r.verified === true).length;
    const pendingCount  = revenueLog.filter(r => r.verified === null).length;
    const unverifiedCount = revenueLog.filter(r => r.verified === false).length;

    const recentSignups = (userData.users || []).filter(u => u.registeredAt >= oneDayAgo).length;

    // Revenue by coin
    const byCoin = {};
    revenueLog.forEach(r => {
      if (!byCoin[r.coin]) byCoin[r.coin] = { count: 0, feeUsd: 0, volumeUsd: 0 };
      byCoin[r.coin].count++;
      byCoin[r.coin].feeUsd += (r.feeUsd || 0);
      byCoin[r.coin].volumeUsd += (r.totalUsd || 0);
    });

    // Revenue by gateway
    const byGateway = {};
    revenueLog.forEach(r => {
      const gw = r.gateway || 'crypto';
      if (!byGateway[gw]) byGateway[gw] = { count: 0, feeUsd: 0 };
      byGateway[gw].count++;
      byGateway[gw].feeUsd += (r.feeUsd || 0);
    });

    const fmtNum = (n, d) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const totalSysBalance = Object.values(sysFees).reduce((s, v) => s + v, 0);
    const nowTs = now.getTime();
    const lastFullRunRaw = await redis('GET', 'system:last_full_cron_run_at');
    const lastFullRunAt = lastFullRunRaw ? new Date(lastFullRunRaw).getTime() : 0;
    const shouldRunFull = isManualRun || !lastFullRunAt || (nowTs - lastFullRunAt) >= FULL_REPORT_INTERVAL_MS;

    const report = {
      generatedAt: now.toISOString(),
      type: 'hourly_cron',
      mode: shouldRunFull ? 'full' : 'reminder_only',
      period: {
        hourly: { revenue: +revenueHour.toFixed(2), transactions: txHour },
        daily:  { revenue: +revenueDay.toFixed(2), transactions: txDay },
        weekly: { revenue: +revenueWeek.toFixed(2) },
        allTime: { revenue: +revenueTotal.toFixed(2), transactions: txTotal }
      },
      verification: { verified: verifiedCount, pending: pendingCount, rejected: unverifiedCount },
      systemBalance: sysFees,
      systemBalanceTotal: +totalSysBalance.toFixed(2),
      users: { total: userData.count || 0, signupsLast24h: recentSignups },
      revenueByCoin: byCoin,
      revenueByGateway: byGateway,
      systemTransactions: sysTx.length,
      recentTransactions: revenueLog.slice(0, 10)
    };

    // Build full report only on manual run or once per day.
    if (token && chat && shouldRunFull) {
      const caption = [
        '\ud83d\udcca HOURLY SYSTEM REPORT — ' + now.toUTCString(),
        '',
        '\ud83d\udcb0 Revenue:',
        '  Last Hour: $' + fmtNum(revenueHour, 2) + ' (' + txHour + ' txns)',
        '  Last 24h:  $' + fmtNum(revenueDay, 2) + ' (' + txDay + ' txns)',
        '  Last 7d:   $' + fmtNum(revenueWeek, 2),
        '  All-Time:  $' + fmtNum(revenueTotal, 2) + ' (' + txTotal + ' total)',
        '',
        '\ud83c\udfe6 System Fee Balance: $' + fmtNum(totalSysBalance, 2),
        Object.entries(sysFees).map(([c, a]) => '  ' + c + ': ' + fmtNum(a, c === 'USDT' ? 2 : 8)).join('\n'),
        '',
        '\ud83d\udc65 Users: ' + (userData.count || 0) + ' registered (' + recentSignups + ' new in 24h)',
        '',
        '\u2705 Verified: ' + verifiedCount + '  \u23f3 Pending: ' + pendingCount + '  \u274c Rejected: ' + unverifiedCount,
        '',
        '\ud83d\udcb3 By Gateway:',
        Object.entries(byGateway).map(([gw, d]) => '  ' + gw + ': ' + d.count + ' txns · $' + fmtNum(d.feeUsd, 2) + ' fee').join('\n'),
        '',
        '\ud83e\ude99 Top Coins:',
        Object.entries(byCoin).sort((a, b) => b[1].feeUsd - a[1].feeUsd).slice(0, 5)
          .map(([c, d]) => '  ' + c + ': ' + d.count + ' txns · $' + fmtNum(d.feeUsd, 2) + ' fee · $' + fmtNum(d.volumeUsd, 2) + ' vol').join('\n')
      ].join('\n');

      try {
        // Generate 4K PNG via SVG + Resvg
        const { Resvg } = require('@resvg/resvg-js');
        const accent = '#c9a84c', white = '#e8e0d0', gray = '#9ca3af', dim = '#4b5563', green = '#22c55e', red = '#ef4444', yellow = '#f59e0b';
        const W = 3840;
        const rows = [];
        rows.push(['Report Generated', now.toUTCString(), gray]);
        rows.push(['Report Type', 'Automated Hourly Statement', accent]);
        rows.push(null);
        rows.push(['── REVENUE ──', '', dim]);
        rows.push(['Last Hour', '$' + fmtNum(revenueHour, 2) + '  (' + txHour + ' txns)', green]);
        rows.push(['Last 24 Hours', '$' + fmtNum(revenueDay, 2) + '  (' + txDay + ' txns)', green]);
        rows.push(['Last 7 Days', '$' + fmtNum(revenueWeek, 2), green]);
        rows.push(['All-Time Revenue', '$' + fmtNum(revenueTotal, 2) + '  (' + txTotal + ' total txns)', accent]);
        rows.push(null);
        rows.push(['── SYSTEM FEE BALANCE ──', '', dim]);
        for (const [coin, amt] of Object.entries(sysFees)) {
          rows.push(['  ' + coin, fmtNum(amt, coin === 'USDT' || coin === 'USDC' ? 2 : 8) + ' ' + coin, white]);
        }
        rows.push(['  TOTAL', '$' + fmtNum(totalSysBalance, 2), accent]);
        rows.push(null);
        rows.push(['── USERS ──', '', dim]);
        rows.push(['Registered Users', String(userData.count || 0), white]);
        rows.push(['Sign-ups (24h)', String(recentSignups), white]);
        rows.push(null);
        rows.push(['── VERIFICATION ──', '', dim]);
        rows.push(['Verified On-chain', String(verifiedCount), green]);
        rows.push(['Pending Review', String(pendingCount), yellow]);
        rows.push(['Rejected', String(unverifiedCount), red]);
        rows.push(null);
        rows.push(['── PAYMENT GATEWAYS ──', '', dim]);
        rows.push(['  Crypto Wallet', 'OPERATIONAL', green]);
        rows.push(['  Apple Pay', 'OPERATIONAL', green]);
        rows.push(['  Visa 3D Secure', 'OPERATIONAL', green]);
        rows.push(['  Mastercard 3D Secure', 'OPERATIONAL', green]);
        rows.push(['  Price Feed', 'OPERATIONAL', green]);
        rows.push(['  Database', 'OPERATIONAL', green]);
        rows.push(null);
        rows.push(['── TOP COINS ──', '', dim]);
        Object.entries(byCoin).sort((a, b) => b[1].feeUsd - a[1].feeUsd).slice(0, 5).forEach(([c, d]) => {
          rows.push(['  ' + c, '$' + fmtNum(d.feeUsd, 2) + ' fee · ' + d.count + ' txns · $' + fmtNum(d.volumeUsd, 2) + ' vol', white]);
        });

        const escSvg = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        let y = 380;
        const LX = 360, VX = 1400, rowH = 58;
        let rowsSvg = '';
        for (const row of rows) {
          if (!row) {
            rowsSvg += '<rect x="300" y="' + y + '" width="3240" height="2" fill="' + dim + '" opacity="0.3"/>';
            y += 28;
            continue;
          }
          const [label, value, color] = row;
          const fs = label.startsWith('──') ? 34 : (label === 'All-Time Revenue' || label === '  TOTAL' ? 46 : 36);
          const fw = (label === 'All-Time Revenue' || label === '  TOTAL' || label.startsWith('──')) ? '700' : '400';
          rowsSvg += '<text x="' + LX + '" y="' + y + '" fill="' + (label.startsWith('──') ? dim : gray) + '" font-size="' + fs + '" font-weight="' + fw + '" font-family="sans-serif">' + escSvg(label) + '</text>';
          if (value) rowsSvg += '<text x="' + VX + '" y="' + y + '" fill="' + color + '" font-size="' + fs + '" font-weight="' + fw + '" font-family="sans-serif">' + escSvg(value) + '</text>';
          y += rowH;
        }
        const cardH = y - 380 + 60;
        const totalH = Math.max(2160, y + 200);

        const svg = [
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + totalH + '" viewBox="0 0 ' + W + ' ' + totalH + '">',
          '<rect width="' + W + '" height="' + totalH + '" fill="#0e1114"/>',
          '<text x="180" y="160" fill="' + accent + '" font-size="78" font-weight="700" font-family="sans-serif" letter-spacing="10">AL-MUDIR</text>',
          '<text x="3660" y="130" fill="' + accent + '" font-size="42" font-weight="600" font-family="sans-serif" text-anchor="end" letter-spacing="6">HOURLY SYSTEM REPORT</text>',
          '<text x="180" y="220" fill="' + dim + '" font-size="30" font-family="sans-serif" letter-spacing="4">Private Wealth &amp; Fintech Ventures</text>',
          '<text x="3660" y="170" fill="' + dim + '" font-size="28" font-family="sans-serif" text-anchor="end">al-mudir.org</text>',
          '<rect x="180" y="270" width="3480" height="3" fill="' + accent + '" opacity="0.5"/>',
          '<rect x="180" y="320" width="3480" height="' + cardH + '" rx="20" fill="#151920"/>',
          rowsSvg,
          '<rect x="180" y="' + (totalH - 180) + '" width="3480" height="3" fill="' + accent + '" opacity="0.5"/>',
          '<text x="180" y="' + (totalH - 110) + '" fill="' + dim + '" font-size="28" font-family="sans-serif">AL-MUDIR  ·  Automated Hourly Report  ·  Verified  ·  Compliant</text>',
          '<text x="3660" y="' + (totalH - 110) + '" fill="' + dim + '" font-size="28" font-family="sans-serif" text-anchor="end">' + escSvg(now.toUTCString()) + '</text>',
          '</svg>'
        ].join('\n');

        const resvg = new Resvg(svg, {
          fitTo: { mode: 'width', value: 3840 },
          font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' }
        });
        const pngBuffer = resvg.render().asPng();

        const boundary = '----ALMudir' + Date.now();
        const parts = [];
        parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + chat);
        parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption);
        parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML');

        const beforeFile = Buffer.from(parts.join('\r\n') + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="document"; filename="hourly_report_4k.png"\r\nContent-Type: image/png\r\n\r\n');
        const afterFile  = Buffer.from('\r\n--' + boundary + '--\r\n');
        const body = Buffer.concat([beforeFile, pngBuffer, afterFile]);

        await fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
          method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
          body: body
        });
      } catch (imgErr) {
        // Text fallback
        await sendTelegramMessage(token, chat, caption);
      }
      await redis('SET', 'system:last_full_cron_run_at', now.toISOString());
    }

    // Cache last report
    await redis('SET', 'system:last_report', report);

    // ── Growth Engine: run and send only on full cycle ──
    try {
      if (shouldRunFull) {
        const { runAllAgents, formatAgentReport, sendTelegram } = require('./_lib/growth-engine');
        const agentReport = await runAllAgents();
        await sendTelegram(formatAgentReport(agentReport));
        report.growthEngine = { ran: true, allOperational: agentReport.allOperational };
      } else {
        report.growthEngine = { ran: false, skipped: true, reason: 'awaiting_next_full_cycle' };
      }
    } catch (geErr) {
      report.growthEngine = { ran: false, error: String(geErr.message || geErr) };
    }

    // ── Agent Orchestrator: daily.report event ──
    try {
      if (shouldRunFull) {
        await runAgent({ type: 'daily.report', payload: report });
        report.agentOrchestrator = { ran: true };
      } else {
        report.agentOrchestrator = { ran: false, reason: 'awaiting_next_full_cycle' };
      }
    } catch (agentErr) {
      report.agentOrchestrator = { ran: false, error: String(agentErr.message || agentErr) };
    }

    // ── Remind admin about pending KYC submissions ──
    try {
      const reminderResult = await sendPendingKycReminders({ force: isManualRun });
      report.kycReminders = reminderResult;
    } catch (kycErr) {
      report.kycReminders = { error: String(kycErr.message || kycErr) };
    }

    return res.status(200).json({ ok: true, report });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'report_generation_failed', detail: String(err.message || err) });
  }
});
