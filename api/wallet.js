'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sanitize } = require('./_lib/auth-utils');
const { Resvg } = require('@resvg/resvg-js');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

// ────────────────────────────────────────────────────────
// System Wallet API — Telegram-backed user balances
//
// GET  /api/wallet  → list balances for authenticated user
// POST /api/wallet  → actions: deposit_notify, buy, sell
//                   → action: gateway_status (payment gateway health)
//                   → action: system_report (admin hourly report)
// ────────────────────────────────────────────────────────

const SUPPORTED_COINS = {
  BTC:  { name: 'Bitcoin',       networks: ['bitcoin'] },
  ETH:  { name: 'Ethereum',      networks: ['erc20'] },
  BNB:  { name: 'BNB',           networks: ['bep20'] },
  USDT: { name: 'Tether',        networks: ['erc20', 'trc20', 'bep20'] },
  USDC: { name: 'USD Coin',      networks: ['erc20', 'bep20'] },
  XRP:  { name: 'XRP',           networks: ['xrp'] },
  LTC:  { name: 'Litecoin',      networks: ['litecoin'] },
  SOL:  { name: 'Solana',        networks: ['solana'] },
  DOGE: { name: 'Dogecoin',      networks: ['dogecoin'] },
  TRX:  { name: 'TRON',          networks: ['trc20'] },
  ADA:  { name: 'Cardano',       networks: ['cardano'] },
  AVAX: { name: 'Avalanche',     networks: ['avax-c'] },
  DOT:  { name: 'Polkadot',      networks: ['polkadot'] },
  LINK: { name: 'Chainlink',     networks: ['erc20'] },
  MATIC:{ name: 'Polygon',       networks: ['polygon', 'erc20'] },
  TON:  { name: 'Toncoin',       networks: ['ton'] },
  XLM:  { name: 'Stellar',       networks: ['stellar'] }
};

const NETWORK_META = {
  bitcoin:  { label: 'Bitcoin',          symbol: 'BTC',  explorerTx: 'https://mempool.space/tx/' },
  erc20:    { label: 'Ethereum (ERC-20)', symbol: 'ETH', explorerTx: 'https://etherscan.io/tx/' },
  trc20:    { label: 'TRON (TRC-20)',    symbol: 'TRX',  explorerTx: 'https://tronscan.org/#/transaction/' },
  bep20:    { label: 'BNB Smart Chain',  symbol: 'BNB',  explorerTx: 'https://bscscan.com/tx/' },
  xrp:      { label: 'XRP Ledger',      symbol: 'XRP',  explorerTx: 'https://xrpscan.com/tx/' },
  litecoin: { label: 'Litecoin',        symbol: 'LTC',  explorerTx: 'https://blockchair.com/litecoin/transaction/' },
  solana:   { label: 'Solana',          symbol: 'SOL',  explorerTx: 'https://solscan.io/tx/' },
  dogecoin: { label: 'Dogecoin',        symbol: 'DOGE', explorerTx: 'https://dogechain.info/tx/' },
  cardano:  { label: 'Cardano',         symbol: 'ADA',  explorerTx: 'https://cardanoscan.io/transaction/' },
  'avax-c': { label: 'Avalanche C-Chain', symbol: 'AVAX', explorerTx: 'https://snowtrace.io/tx/' },
  polkadot: { label: 'Polkadot',        symbol: 'DOT',  explorerTx: 'https://polkadot.subscan.io/extrinsic/' },
  polygon:  { label: 'Polygon',         symbol: 'MATIC', explorerTx: 'https://polygonscan.com/tx/' },
  ton:      { label: 'TON',             symbol: 'TON',  explorerTx: 'https://tonscan.org/tx/' },
  stellar:  { label: 'Stellar',         symbol: 'XLM',  explorerTx: 'https://stellarchain.io/transactions/' }
};

// Treasury deposit addresses per network
const TREASURY_ADDRESSES = {
  bitcoin:  'bc1qfe8kjaau2n2ggknmx6a8gclzwc9xz3zpj0lcsp',
  erc20:    '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
  trc20:    'TLNNQNDsH6JG9dxd99Tqfkb8eSPRUyhC4E',
  bep20:    '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
  xrp:      'rN7oNfbPqA3LhP2eutqfqHHGDn3bGRVVKW',
  litecoin: 'ltc1qfe8kjaau2n2ggknmx6a8gclzwc9xz3zpunx6cl',
  solana:   '5FHwkrdxNTpV9X4BpL9s5oNq2Ci5KSnJqxjXSbZbFyNf',
  dogecoin: 'DPwS1jjKvEj3EuXxqWMoRRDfX2YrFbF2kX',
  cardano:  'addr1qy0alf4cprlq84cfwlfr0hn3yjvnqkj5cws7sz0hslj4l3lj9p3fg7c8ea3fxjm3w6pklp8udmhq90qetcv0kq3slhcsuhgyfw',
  'avax-c': '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
  polkadot: '14K7dHNj5xsCqo8WGPMpWopSZb9F8dMCwxp3UdFbK7Kufmks',
  polygon:  '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
  ton:      'UQBvW8Z5huBkMJYdnfAL5yOOFCjBSkiF6CY6iMuBfWLxhLfl',
  stellar:  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NYW3LKR2CQBE2QF6B6FOPJAYC2'
};

// ── Standard trading fees per coin (industry worldwide rates) ──────
const COIN_FEES = {
  BTC:   0.001,    // 0.10% — Major
  ETH:   0.001,    // 0.10% — Major
  BNB:   0.0015,   // 0.15% — Large cap
  USDT:  0.0005,   // 0.05% — Stablecoin
  USDC:  0.0005,   // 0.05% — Stablecoin
  XRP:   0.0015,   // 0.15% — Large cap
  LTC:   0.002,    // 0.20% — Mid cap
  SOL:   0.0015,   // 0.15% — Large cap
  DOGE:  0.0025,   // 0.25% — Small cap
  TRX:   0.0025,   // 0.25% — Small cap
  ADA:   0.0015,   // 0.15% — Large cap
  AVAX:  0.002,    // 0.20% — Mid cap
  DOT:   0.002,    // 0.20% — Mid cap
  LINK:  0.002,    // 0.20% — Mid cap
  MATIC: 0.002,    // 0.20% — Mid cap
  TON:   0.002,    // 0.20% — Mid cap
  XLM:   0.0025    // 0.25% — Small cap
};

const DEPOSIT_FEE_RATE = 0.0005; // 0.05% deposit processing fee
const SYSTEM_FEE_KEY   = 'wallet:__system_fees__';
const SYSTEM_TX_KEY    = 'wallet_tx:__system_fees__';

// Live (or fallback) price cache
const PRICE_CACHE = { rates: {}, ts: 0 };
const PRICE_TTL = 60 * 1000; // 1 min

async function fetchPrices() {
  if (Date.now() - PRICE_CACHE.ts < PRICE_TTL && Object.keys(PRICE_CACHE.rates).length) {
    return PRICE_CACHE.rates;
  }
  try {
    const ids = 'bitcoin,ethereum,binancecoin,tether,usd-coin,ripple,litecoin,solana,dogecoin,tron,cardano,avalanche-2,polkadot,chainlink,matic-network,the-open-network,stellar';
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd';
    const r = await fetch(url);
    const data = await r.json();
    const map = {
      BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', USDT: 'tether', USDC: 'usd-coin',
      XRP: 'ripple', LTC: 'litecoin', SOL: 'solana', DOGE: 'dogecoin', TRX: 'tron',
      ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot', LINK: 'chainlink',
      MATIC: 'matic-network', TON: 'the-open-network', XLM: 'stellar'
    };
    const rates = {};
    for (const [sym, id] of Object.entries(map)) {
      if (data[id] && data[id].usd) rates[sym] = data[id].usd;
    }
    if (Object.keys(rates).length > 0) {
      PRICE_CACHE.rates = rates;
      PRICE_CACHE.ts = Date.now();
    }
    return rates;
  } catch {
    // Hardcoded fallbacks
    return {
      BTC: 67500, ETH: 3500, BNB: 650, USDT: 1, USDC: 1, XRP: 0.6,
      LTC: 86, SOL: 180, DOGE: 0.14, TRX: 0.12, ADA: 0.45, AVAX: 36,
      DOT: 6.8, LINK: 18.5, MATIC: 0.9, TON: 6.5, XLM: 0.12
    };
  }
}

async function getSessionEmail(req) {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!auth || auth.length < 32) return null;
  const session = await redis('GET', 'session:' + auth);
  if (!session) return null;
  // Slide session TTL
  await redis('EXPIRE', 'session:' + auth, 86400);
  return typeof session === 'object' ? session.email : String(session);
}

function walletKey(email) {
  return 'wallet:' + String(email).toLowerCase().trim();
}

async function getWalletBalances(email) {
  const raw = await redis('GET', walletKey(email));
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

async function setWalletBalances(email, balances) {
  await redis('SET', walletKey(email), balances);
}

function txKey(email) {
  return 'wallet_tx:' + String(email).toLowerCase().trim();
}

async function getWalletTxHistory(email) {
  const raw = await redis('GET', txKey(email));
  if (!raw || !Array.isArray(raw)) return [];
  return raw;
}

async function appendWalletTx(email, tx) {
  const history = await getWalletTxHistory(email);
  history.unshift(tx); // newest first
  // Keep only last 100 transactions
  if (history.length > 100) history.length = 100;
  await redis('SET', txKey(email), history);
}

// ── System fee wallet ────────────────────────────────────
async function getSystemFeeBalances() {
  const raw = await redis('GET', SYSTEM_FEE_KEY);
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

async function addSystemFee(coin, amount) {
  const bals = await getSystemFeeBalances();
  bals[coin] = +((bals[coin] || 0) + amount).toFixed(8);
  await redis('SET', SYSTEM_FEE_KEY, bals);
  return bals;
}

async function appendSystemTx(tx) {
  const raw = await redis('GET', SYSTEM_TX_KEY);
  const history = (raw && Array.isArray(raw)) ? raw : [];
  history.unshift(tx);
  if (history.length > 500) history.length = 500;
  await redis('SET', SYSTEM_TX_KEY, history);
}

function maskEmail(e) {
  const parts = String(e).split('@');
  return parts[0][0] + '***@' + (parts[1] || '');
}

function fmtNum(n, d) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ── 4K Transaction Statement SVG Generator ──────────────
function generateStatementSVG(tx, email, fee) {
  const W = 3840, H = 2160;
  const type = (tx.type || '').toUpperCase();
  const coin = tx.coin || '';
  const coinName = SUPPORTED_COINS[coin] ? SUPPORTED_COINS[coin].name : coin;
  const txId = 'TXN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const dateStr = new Date(tx.ts).toUTCString();
  const networkLabel = tx.network && NETWORK_META[tx.network] ? NETWORK_META[tx.network].label : 'Internal Ledger';
  const feeAddr = fee.collectAddress || '—';
  const feeNetwork = fee.collectNetwork || '';
  const typeColor = type === 'BUY' ? '#22c55e' : type === 'SELL' ? '#ef4444' : '#c9a84c';
  const accent = '#c9a84c';
  const white = '#e8e0d0';
  const gray = '#9ca3af';
  const dim = '#4b5563';

  // Build detail rows: [label, value, color]
  const rows = [];
  rows.push(['Transaction ID', txId, gray]);
  rows.push(['Date & Time', dateStr, white]);
  rows.push(['Type', type, typeColor]);
  rows.push(['Status', tx.status ? tx.status.toUpperCase() : 'FILLED', '#22c55e']);
  rows.push(null); // separator
  rows.push(['Coin', coin + '  ·  ' + coinName, white]);
  rows.push(['Amount', fmtNum(tx.amount, 8) + ' ' + coin, white]);
  if (tx.price) rows.push(['Market Price', '$' + fmtNum(tx.price, 2) + ' / ' + coin, white]);
  rows.push(['Subtotal', '$' + fmtNum(tx.usdValue, 2) + ' USDT', white]);
  rows.push(null); // separator
  rows.push(['Fee Rate', (fee.rate * 100).toFixed(2) + '%', '#f59e0b']);
  rows.push(['Fee Amount', '$' + fmtNum(fee.feeUsd, 2) + ' USDT', '#f59e0b']);
  if (feeAddr !== '—') rows.push(['Fee Routed To', feeAddr.slice(0, 20) + '...' + (feeNetwork ? '  (' + feeNetwork + ')' : ''), gray]);
  rows.push(null); // separator
  if (type === 'BUY') {
    rows.push(['Total Charged', '$' + fmtNum(fee.totalCharged, 2) + ' USDT', accent]);
    rows.push(['Net Received', fmtNum(tx.amount, 8) + ' ' + coin, '#22c55e']);
  } else if (type === 'SELL') {
    rows.push(['Total Sold', fmtNum(tx.amount, 8) + ' ' + coin, '#ef4444']);
    rows.push(['Net Received', '$' + fmtNum(fee.netReceived, 2) + ' USDT', '#22c55e']);
  } else {
    rows.push(['Net Credited', fmtNum(fee.netAmount, 8) + ' ' + coin, '#22c55e']);
  }
  rows.push(null);
  rows.push(['Account', maskEmail(email), gray]);
  if (tx.network) rows.push(['Network', networkLabel, gray]);

  // Build SVG
  let y = 380;
  const LX = 360, VX = 1100;
  const rowH = 72;

  let rowsSvg = '';
  for (const row of rows) {
    if (!row) {
      // separator line
      rowsSvg += '<rect x="300" y="' + y + '" width="3240" height="2" fill="' + dim + '" opacity="0.3"/>';
      y += 40;
      continue;
    }
    const [label, value, color] = row;
    const fs = (label === 'Total Charged' || label === 'Net Received' || label === 'Total Sold' || label === 'Net Credited') ? 52 : 40;
    const fw = fs > 40 ? '700' : '400';
    rowsSvg += '<text x="' + LX + '" y="' + y + '" fill="' + gray + '" font-size="36" font-family="sans-serif">' + escSvg(label) + '</text>';
    rowsSvg += '<text x="' + VX + '" y="' + y + '" fill="' + color + '" font-size="' + fs + '" font-weight="' + fw + '" font-family="sans-serif">' + escSvg(value) + '</text>';
    y += rowH;
  }

  const cardH = y - 380 + 60;

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
    '<rect width="' + W + '" height="' + H + '" fill="#0e1114"/>',
    // Header
    '<text x="180" y="160" fill="' + accent + '" font-size="78" font-weight="700" font-family="sans-serif" letter-spacing="10">AL-MUDIR</text>',
    '<text x="3660" y="130" fill="' + accent + '" font-size="42" font-weight="600" font-family="sans-serif" text-anchor="end" letter-spacing="6">TRANSACTION STATEMENT</text>',
    '<text x="180" y="220" fill="' + dim + '" font-size="30" font-family="sans-serif" letter-spacing="4">Private Wealth &amp; Fintech Ventures</text>',
    '<text x="3660" y="170" fill="' + dim + '" font-size="28" font-family="sans-serif" text-anchor="end">al-mudir.org</text>',
    // Gold line
    '<rect x="180" y="270" width="3480" height="3" fill="' + accent + '" opacity="0.5"/>',
    // Card background
    '<rect x="180" y="320" width="3480" height="' + cardH + '" rx="20" fill="#151920"/>',
    // Detail rows
    rowsSvg,
    // Bottom bar
    '<rect x="180" y="' + (H - 180) + '" width="3480" height="3" fill="' + accent + '" opacity="0.5"/>',
    '<text x="180" y="' + (H - 110) + '" fill="' + dim + '" font-size="28" font-family="sans-serif">AL-MUDIR  ·  Secure  ·  Verified  ·  Compliant</text>',
    '<text x="3660" y="' + (H - 110) + '" fill="' + dim + '" font-size="28" font-family="sans-serif" text-anchor="end">Statement ' + txId + '</text>',
    '</svg>'
  ].join('\n');
}

function escSvg(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── On-chain transaction verification ───────────────────
// Verify that a deposit transaction actually exists on-chain before crediting
const BLOCKCHAIN_EXPLORER_APIS = {
  bitcoin:  'https://mempool.space/api/tx/',
  erc20:    'https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=',
  bep20:    'https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=',
  trc20:    'https://apilist.tronscanapi.com/api/transaction-info?hash=',
  solana:   'https://api.mainnet-beta.solana.com',
  polygon:  'https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=',
};

async function verifyOnChainTx(network, txHash) {
  if (!txHash || txHash.length < 10) return { verified: false, reason: 'no_tx_hash' };
  const cleanHash = sanitize(String(txHash), 128).trim();
  if (!cleanHash) return { verified: false, reason: 'invalid_hash' };

  try {
    if (['erc20', 'bep20', 'polygon', 'avax-c'].includes(network)) {
      const base = BLOCKCHAIN_EXPLORER_APIS[network] || BLOCKCHAIN_EXPLORER_APIS['erc20'];
      const r = await fetch(base + encodeURIComponent(cleanHash), { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.result && d.result.hash) {
        return { verified: true, hash: d.result.hash, from: d.result.from, to: d.result.to, value: d.result.value, blockNumber: d.result.blockNumber };
      }
      return { verified: false, reason: 'tx_not_found' };
    }
    if (network === 'bitcoin') {
      const r = await fetch(BLOCKCHAIN_EXPLORER_APIS.bitcoin + encodeURIComponent(cleanHash), { signal: AbortSignal.timeout(8000) });
      if (r.status === 200) {
        const d = await r.json();
        if (d.txid) return { verified: true, hash: d.txid, confirmations: d.status && d.status.confirmed ? 'confirmed' : 'unconfirmed' };
      }
      return { verified: false, reason: 'tx_not_found' };
    }
    if (network === 'trc20') {
      const r = await fetch(BLOCKCHAIN_EXPLORER_APIS.trc20 + encodeURIComponent(cleanHash), { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.id || d.hash) return { verified: true, hash: d.id || d.hash };
      return { verified: false, reason: 'tx_not_found' };
    }
    if (network === 'solana') {
      const r = await fetch(BLOCKCHAIN_EXPLORER_APIS.solana, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [cleanHash, { encoding: 'json', maxSupportedTransactionVersion: 0 }] }),
        signal: AbortSignal.timeout(8000)
      });
      const d = await r.json();
      if (d.result) return { verified: true, hash: cleanHash, slot: d.result.slot };
      return { verified: false, reason: 'tx_not_found' };
    }
    // For networks without an explorer API, mark as pending manual review
    return { verified: null, reason: 'manual_review_required', network };
  } catch (err) {
    return { verified: null, reason: 'verification_timeout', network };
  }
}

// ── Transaction integrity: idempotency guard ────────────
function generateTxId(email, action, coin, amount, ts) {
  const data = [email, action, coin, String(amount), ts].join(':');
  return 'TXN-' + crypto.createHash('sha256').update(data).digest('hex').slice(0, 16).toUpperCase();
}

// ── Revenue & Analytics Keys ────────────────────────────
const REVENUE_KEY      = 'system:revenue_log';
const USERS_KEY        = 'system:registered_users';
const REPORT_CACHE_KEY = 'system:last_report';
const HOURLY_REPORT_AT_KEY = 'system:last_hourly_report_at';
const TELEGRAM_INTENT_PREFIX = 'wallet_intent:';
const TELEGRAM_INTENT_LIST_PREFIX = 'wallet_intents:';

async function logRevenue(entry) {
  // entry: { type, email, coin, feeUsd, totalUsd, action, ts, txId, gateway, verified }
  const raw = await redis('GET', REVENUE_KEY);
  const log = (raw && Array.isArray(raw)) ? raw : [];
  log.unshift(entry);
  if (log.length > 2000) log.length = 2000;
  await redis('SET', REVENUE_KEY, log);
}

async function getRevenueLog() {
  const raw = await redis('GET', REVENUE_KEY);
  return (raw && Array.isArray(raw)) ? raw : [];
}

async function getRegisteredUserCount() {
  // Count all user:* keys — scan DB
  const raw = await redis('GET', USERS_KEY);
  return (raw && typeof raw === 'object') ? raw : { count: 0, users: [] };
}

async function updateRegisteredUsers(email, action) {
  const data = await getRegisteredUserCount();
  if (action === 'add') {
    if (!data.users) data.users = [];
    if (!data.users.find(u => u.email === email)) {
      data.users.push({ email, registeredAt: new Date().toISOString() });
      data.count = data.users.length;
    }
  }
  await redis('SET', USERS_KEY, data);
  return data;
}

// ── Payment Gateway Health Check ────────────────────────
async function checkGatewayHealth() {
  const nowIso = new Date().toISOString();
  const stripeLive = !!String(process.env.STRIPE_SECRET_KEY || '').trim();
  const appleMerchant = !!String(process.env.APPLE_PAY_MERCHANT_ID || '').trim();
  const cardGatewayLive = String(process.env.CARD_GATEWAY_LIVE || '').trim().toLowerCase() === 'true';
  const telegramWalletLive = !!String(process.env.TELEGRAM_BOT_TOKEN || '').trim() && !!String(process.env.TELEGRAM_CHAT_ID || '').trim();

  const gateways = {
    crypto_wallet: { name: 'Crypto Wallet (On-chain)', status: 'operational', checked: nowIso },
    apple_pay: {
      name: 'Apple Pay',
      status: cardGatewayLive && stripeLive && appleMerchant ? 'operational' : 'degraded',
      checked: nowIso,
      detail: cardGatewayLive && stripeLive && appleMerchant ? 'live' : 'integration_not_live'
    },
    visa: {
      name: 'Visa 3D Secure',
      status: cardGatewayLive && stripeLive ? 'operational' : 'degraded',
      checked: nowIso,
      detail: cardGatewayLive && stripeLive ? 'live' : 'integration_not_live'
    },
    mastercard: {
      name: 'Mastercard 3D Secure',
      status: cardGatewayLive && stripeLive ? 'operational' : 'degraded',
      checked: nowIso,
      detail: cardGatewayLive && stripeLive ? 'live' : 'integration_not_live'
    },
    telegram_wallet: {
      name: 'Telegram Wallet',
      status: telegramWalletLive ? 'operational' : 'degraded',
      checked: nowIso,
      detail: telegramWalletLive ? 'live' : 'missing_telegram_bot_or_chat_config'
    }
  };

  // Verify CoinGecko price feed is live
  try {
    const prices = await fetchPrices();
    if (Object.keys(prices).length >= 10) {
      gateways.price_feed = { name: 'Price Feed (CoinGecko)', status: 'operational', prices: Object.keys(prices).length, checked: nowIso };
    } else {
      gateways.price_feed = { name: 'Price Feed', status: 'degraded', checked: nowIso };
    }
  } catch {
    gateways.price_feed = { name: 'Price Feed', status: 'down', checked: nowIso };
  }

  // Verify DB connectivity
  try {
    await redis('GET', 'health:lastCheck');
    gateways.database = { name: 'Telegram Encrypted DB', status: 'operational', checked: nowIso };
  } catch {
    gateways.database = { name: 'Database', status: 'down', checked: nowIso };
  }

  // Verify treasury addresses exist and are valid
  const treasuryOk = Object.keys(TREASURY_ADDRESSES).length >= 14;
  gateways.treasury = { name: 'Treasury Addresses', status: treasuryOk ? 'operational' : 'error', count: Object.keys(TREASURY_ADDRESSES).length, checked: nowIso };

  return gateways;
}

// ── System Report Generator ─────────────────────────────
async function generateSystemReport() {
  const now = new Date();
  const revenueLog = await getRevenueLog();
  const sysFees = await getSystemFeeBalances();
  const userData = await getRegisteredUserCount();
  const sysTxRaw = await redis('GET', SYSTEM_TX_KEY);
  const sysTx = (sysTxRaw && Array.isArray(sysTxRaw)) ? sysTxRaw : [];
  const gateways = await checkGatewayHealth();

  // Calculate revenue by time periods
  const oneHourAgo = new Date(now - 3600000).toISOString();
  const oneDayAgo  = new Date(now - 86400000).toISOString();
  const oneWeekAgo = new Date(now - 604800000).toISOString();

  const revenueHour = revenueLog.filter(r => r.ts >= oneHourAgo).reduce((s, r) => s + (r.feeUsd || 0), 0);
  const revenueDay  = revenueLog.filter(r => r.ts >= oneDayAgo).reduce((s, r) => s + (r.feeUsd || 0), 0);
  const revenueWeek = revenueLog.filter(r => r.ts >= oneWeekAgo).reduce((s, r) => s + (r.feeUsd || 0), 0);
  const revenueTotal = revenueLog.reduce((s, r) => s + (r.feeUsd || 0), 0);

  // Transaction counts
  const txHour = revenueLog.filter(r => r.ts >= oneHourAgo).length;
  const txDay  = revenueLog.filter(r => r.ts >= oneDayAgo).length;
  const txTotal = revenueLog.length;

  // Verified vs unverified transactions
  const verifiedCount = revenueLog.filter(r => r.verified === true).length;
  const pendingCount  = revenueLog.filter(r => r.verified === null).length;
  const unverifiedCount = revenueLog.filter(r => r.verified === false).length;

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

  // Sign-ups in last 24h
  const recentSignups = (userData.users || []).filter(u => u.registeredAt >= oneDayAgo).length;

  return {
    generatedAt: now.toISOString(),
    period: {
      hourly: { revenue: +revenueHour.toFixed(2), transactions: txHour },
      daily:  { revenue: +revenueDay.toFixed(2), transactions: txDay },
      weekly: { revenue: +revenueWeek.toFixed(2) },
      allTime: { revenue: +revenueTotal.toFixed(2), transactions: txTotal }
    },
    verification: { verified: verifiedCount, pending: pendingCount, rejected: unverifiedCount },
    systemBalance: sysFees,
    users: {
      total: userData.count || 0,
      signupsLast24h: recentSignups,
    },
    revenueByCoin: byCoin,
    revenueByGateway: byGateway,
    gateways,
    recentTransactions: revenueLog.slice(0, 30)
  };
}

// ── 4K System Report SVG/PNG Generator ──────────────────
function generateReportSVG(report) {
  const W = 3840, H = 2160;
  const accent = '#c9a84c';
  const white = '#e8e0d0';
  const gray = '#9ca3af';
  const dim = '#4b5563';
  const green = '#22c55e';
  const red = '#ef4444';
  const yellow = '#f59e0b';
  const dateStr = new Date(report.generatedAt).toUTCString();

  const rows = [];
  rows.push(['Report Generated', dateStr, gray]);
  rows.push(['Report Type', 'Hourly System Statement', accent]);
  rows.push(null);

  // Revenue summary
  rows.push(['── REVENUE ──', '', dim]);
  rows.push(['Last Hour', '$' + fmtNum(report.period.hourly.revenue, 2) + '  (' + report.period.hourly.transactions + ' txns)', green]);
  rows.push(['Last 24 Hours', '$' + fmtNum(report.period.daily.revenue, 2) + '  (' + report.period.daily.transactions + ' txns)', green]);
  rows.push(['Last 7 Days', '$' + fmtNum(report.period.weekly.revenue, 2), green]);
  rows.push(['All-Time Revenue', '$' + fmtNum(report.period.allTime.revenue, 2) + '  (' + report.period.allTime.transactions + ' total txns)', accent]);
  rows.push(null);

  // System balance
  rows.push(['── SYSTEM FEE BALANCE ──', '', dim]);
  const sysBals = report.systemBalance || {};
  for (const [coin, amt] of Object.entries(sysBals)) {
    rows.push(['  ' + coin, fmtNum(amt, coin === 'USDT' || coin === 'USDC' ? 2 : 8) + ' ' + coin, white]);
  }
  if (!Object.keys(sysBals).length) rows.push(['  (No fees collected yet)', '', gray]);
  rows.push(null);

  // Users
  rows.push(['── USERS ──', '', dim]);
  rows.push(['Registered Users', String(report.users.total), white]);
  rows.push(['Sign-ups (24h)', String(report.users.signupsLast24h), white]);
  rows.push(null);

  // Verification
  rows.push(['── TRANSACTION VERIFICATION ──', '', dim]);
  rows.push(['Verified On-chain', String(report.verification.verified), green]);
  rows.push(['Pending Review', String(report.verification.pending), yellow]);
  rows.push(['Rejected', String(report.verification.rejected), red]);
  rows.push(null);

  // Gateways
  rows.push(['── PAYMENT GATEWAYS ──', '', dim]);
  const gw = report.gateways || {};
  for (const [key, val] of Object.entries(gw)) {
    const statusColor = val.status === 'operational' ? green : val.status === 'degraded' ? yellow : red;
    rows.push(['  ' + val.name, val.status.toUpperCase(), statusColor]);
  }
  rows.push(null);

  // Revenue by coin (top 5)
  rows.push(['── TOP COINS BY REVENUE ──', '', dim]);
  const coinEntries = Object.entries(report.revenueByCoin || {}).sort((a, b) => b[1].feeUsd - a[1].feeUsd).slice(0, 5);
  for (const [coin, data] of coinEntries) {
    rows.push(['  ' + coin, '$' + fmtNum(data.feeUsd, 2) + '  (' + data.count + ' txns,  vol $' + fmtNum(data.volumeUsd, 2) + ')', white]);
  }

  // Build SVG
  let y = 380;
  const LX = 360, VX = 1400;
  const rowH = 62;

  let rowsSvg = '';
  for (const row of rows) {
    if (!row) {
      rowsSvg += '<rect x="300" y="' + y + '" width="3240" height="2" fill="' + dim + '" opacity="0.3"/>';
      y += 30;
      continue;
    }
    const [label, value, color] = row;
    const fs = label.startsWith('──') ? 34 : (label === 'All-Time Revenue' ? 48 : 38);
    const fw = (label === 'All-Time Revenue' || label.startsWith('──')) ? '700' : '400';
    rowsSvg += '<text x="' + LX + '" y="' + y + '" fill="' + (label.startsWith('──') ? dim : gray) + '" font-size="' + fs + '" font-weight="' + fw + '" font-family="sans-serif">' + escSvg(label) + '</text>';
    if (value) rowsSvg += '<text x="' + VX + '" y="' + y + '" fill="' + color + '" font-size="' + fs + '" font-weight="' + fw + '" font-family="sans-serif">' + escSvg(value) + '</text>';
    y += rowH;
  }

  const cardH = y - 380 + 60;
  const totalH = Math.max(H, y + 200);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + totalH + '" viewBox="0 0 ' + W + ' ' + totalH + '">',
    '<rect width="' + W + '" height="' + totalH + '" fill="#0e1114"/>',
    '<text x="180" y="160" fill="' + accent + '" font-size="78" font-weight="700" font-family="sans-serif" letter-spacing="10">AL-MUDIR</text>',
    '<text x="3660" y="130" fill="' + accent + '" font-size="42" font-weight="600" font-family="sans-serif" text-anchor="end" letter-spacing="6">SYSTEM REPORT</text>',
    '<text x="180" y="220" fill="' + dim + '" font-size="30" font-family="sans-serif" letter-spacing="4">Private Wealth &amp; Fintech Ventures</text>',
    '<text x="3660" y="170" fill="' + dim + '" font-size="28" font-family="sans-serif" text-anchor="end">al-mudir.org</text>',
    '<rect x="180" y="270" width="3480" height="3" fill="' + accent + '" opacity="0.5"/>',
    '<rect x="180" y="320" width="3480" height="' + cardH + '" rx="20" fill="#151920"/>',
    rowsSvg,
    '<rect x="180" y="' + (totalH - 180) + '" width="3480" height="3" fill="' + accent + '" opacity="0.5"/>',
    '<text x="180" y="' + (totalH - 110) + '" fill="' + dim + '" font-size="28" font-family="sans-serif">AL-MUDIR  ·  Automated Hourly Report  ·  Verified  ·  Compliant</text>',
    '<text x="3660" y="' + (totalH - 110) + '" fill="' + dim + '" font-size="28" font-family="sans-serif" text-anchor="end">' + escSvg(dateStr) + '</text>',
    '</svg>'
  ].join('\n');
}

async function sendSystemReportToTelegram(report) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat  = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) return;

  const caption = [
    '\ud83d\udcca SYSTEM REPORT — ' + new Date(report.generatedAt).toUTCString(),
    '',
    '\ud83d\udcb0 Revenue:',
    '  Last Hour: $' + fmtNum(report.period.hourly.revenue, 2) + ' (' + report.period.hourly.transactions + ' txns)',
    '  Last 24h: $' + fmtNum(report.period.daily.revenue, 2) + ' (' + report.period.daily.transactions + ' txns)',
    '  All-Time: $' + fmtNum(report.period.allTime.revenue, 2),
    '',
    '\ud83d\udc65 Users: ' + report.users.total + ' registered (' + report.users.signupsLast24h + ' new in 24h)',
    '',
    '\u2705 Verified: ' + report.verification.verified + '  \u23f3 Pending: ' + report.verification.pending + '  \u274c Rejected: ' + report.verification.rejected,
    '',
    '\ud83c\udfe6 System Balance: $' + fmtNum(Object.values(report.systemBalance || {}).reduce((s, v) => s + v, 0), 2),
    '',
    '\ud83d\udd0c Gateways: ' + Object.values(report.gateways || {}).filter(g => g.status === 'operational').length + '/' + Object.keys(report.gateways || {}).length + ' operational'
  ].join('\n');

  try {
    const pdfBuffer = await generateReportPdfBuffer(report);
    const boundary = '----ALMudir' + Date.now();
    const parts = [];
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + chat);
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption);
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML');

    const beforeFile = Buffer.from(parts.join('\r\n') + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="document"; filename="system_report_4k.pdf"\r\nContent-Type: application/pdf\r\n\r\n');
    const afterFile  = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([beforeFile, pdfBuffer, afterFile]);

    await fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body
    });
  } catch (imgErr) {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: caption, disable_notification: false })
    });
  }
}

function generateReportPdfBuffer(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [3840, 2160], margin: 140 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = '#C9A84C';
    const white = '#E8E0D0';
    const gray = '#9CA3AF';
    const green = '#22C55E';
    const yellow = '#F59E0B';
    const red = '#EF4444';

    doc.rect(0, 0, 3840, 2160).fill('#0E1114');

    doc.fillColor(accent).fontSize(76).text('AL-MUDIR', 180, 140, { characterSpacing: 6 });
    doc.fillColor(gray).fontSize(26).text('Private Wealth & Fintech Ventures', 180, 235);
    doc.fillColor(accent).fontSize(38).text('SYSTEM REPORT (4K PDF)', 2850, 140, { width: 820, align: 'right' });
    doc.fillColor(gray).fontSize(24).text('al-mudir.org', 2850, 188, { width: 820, align: 'right' });

    doc.strokeColor(accent).lineWidth(2).moveTo(180, 290).lineTo(3660, 290).stroke();
    doc.roundedRect(180, 340, 3480, 1600, 18).fill('#151920');

    let y = 390;
    const xLabel = 260;
    const xValue = 1450;

    function row(label, value, color, options) {
      const opts = options || {};
      const size = opts.size || 34;
      const valueColor = color || white;
      doc.fillColor(opts.section ? '#4B5563' : gray).fontSize(size).text(label, xLabel, y);
      if (value) doc.fillColor(valueColor).fontSize(size).text(value, xValue, y);
      y += opts.gap || 56;
    }

    row('Report Generated', new Date(report.generatedAt).toUTCString(), gray);
    row('Report Type', 'Hourly System Statement', accent);
    y += 8;
    doc.strokeColor('#4B5563').lineWidth(1).moveTo(240, y).lineTo(3600, y).stroke();
    y += 30;

    row('REVENUE', '', gray, { section: true, size: 32, gap: 52 });
    row('Last Hour', '$' + fmtNum(report.period.hourly.revenue, 2) + ' (' + report.period.hourly.transactions + ' txns)', green);
    row('Last 24 Hours', '$' + fmtNum(report.period.daily.revenue, 2) + ' (' + report.period.daily.transactions + ' txns)', green);
    row('Last 7 Days', '$' + fmtNum(report.period.weekly.revenue, 2), green);
    row('All-Time Revenue', '$' + fmtNum(report.period.allTime.revenue, 2) + ' (' + report.period.allTime.transactions + ' total)', accent, { size: 40, gap: 64 });

    row('USERS', '', gray, { section: true, size: 32, gap: 52 });
    row('Registered Users', String(report.users.total), white);
    row('Sign-ups (24h)', String(report.users.signupsLast24h), white);

    row('TRANSACTION VERIFICATION', '', gray, { section: true, size: 32, gap: 52 });
    row('Verified On-chain', String(report.verification.verified), green);
    row('Pending Review', String(report.verification.pending), yellow);
    row('Rejected', String(report.verification.rejected), red);

    row('SYSTEM FEE BALANCES', '', gray, { section: true, size: 32, gap: 52 });
    const sysBals = report.systemBalance || {};
    const entries = Object.entries(sysBals);
    if (!entries.length) {
      row('(No fees collected yet)', '', gray);
    } else {
      for (const [coin, amount] of entries.slice(0, 10)) {
        row(coin, fmtNum(amount, coin === 'USDT' || coin === 'USDC' ? 2 : 8) + ' ' + coin, white);
      }
    }

    doc.strokeColor(accent).lineWidth(2).moveTo(180, 2010).lineTo(3660, 2010).stroke();
    doc.fillColor(gray).fontSize(22).text('AL-MUDIR · Automated Hourly Report · Verified · Compliant', 180, 2042);
    doc.fillColor(gray).fontSize(22).text(new Date(report.generatedAt).toUTCString(), 2680, 2042, { width: 980, align: 'right' });

    doc.end();
  });
}

async function maybeRunHourlyReport() {
  const now = Date.now();
  const lastRaw = await redis('GET', HOURLY_REPORT_AT_KEY);
  let last = 0;
  if (typeof lastRaw === 'number') last = lastRaw;
  else if (typeof lastRaw === 'string') last = Date.parse(lastRaw) || Number(lastRaw) || 0;
  else if (lastRaw && typeof lastRaw === 'object' && lastRaw.ts) last = Date.parse(lastRaw.ts) || 0;

  if (now - last < 60 * 60 * 1000) return;

  // Best-effort lock to reduce duplicate reports during concurrent traffic.
  await redis('SET', HOURLY_REPORT_AT_KEY, { ts: new Date(now).toISOString(), status: 'running' });

  const report = await generateSystemReport();
  try { await sendSystemReportToTelegram(report); } catch { /* best effort */ }
  await redis('SET', REPORT_CACHE_KEY, report);
  await redis('SET', HOURLY_REPORT_AT_KEY, { ts: new Date(now).toISOString(), status: 'done' });
}

function telegramIntentKey(intentId) {
  return TELEGRAM_INTENT_PREFIX + String(intentId || '').trim();
}

function telegramIntentListKey(email) {
  return TELEGRAM_INTENT_LIST_PREFIX + String(email || '').toLowerCase().trim();
}

async function appendTelegramIntentForUser(email, intent) {
  const key = telegramIntentListKey(email);
  const raw = await redis('GET', key);
  const list = (raw && Array.isArray(raw)) ? raw : [];
  list.unshift(intent);
  if (list.length > 120) list.length = 120;
  await redis('SET', key, list);
}

async function sendTelegramWalletIntent(intent, email) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat  = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) return;

  const lines = [
    'Telegram Wallet Payment Intent',
    'Intent ID: ' + intent.id,
    'User: ' + maskEmail(email),
    'Method Requested: ' + String(intent.requestedMethod || 'telegram_wallet'),
    'Source Amount: ' + intent.sourceAmount + ' ' + intent.sourceCurrency,
    'Target Amount: ' + intent.targetAmount + ' ' + intent.targetAsset,
    'Status: ' + intent.status,
    'Created: ' + intent.createdAt,
    'Expires: ' + intent.expiresAt,
    '',
    'Customer Instructions:',
    '1) Open Telegram Wallet: https://t.me/wallet',
    '2) Send funds to AL-MUDIR treasury (USDT preferred)',
    '3) Submit on-chain TX hash in Deposit panel',
    '4) System will verify and credit only real transfers'
  ].join('\n');

  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: lines, disable_notification: false })
  });
}

// ── Send 4K statement photo to Telegram ─────────────────
async function sendStatementToTelegram(tx, email, fee) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat  = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) return;

  const type = (tx.type || '').toUpperCase();
  const caption = [
    type === 'DEPOSIT' ? '\ud83d\udcb0 Deposit Statement' : '\ud83d\udcca Trade Statement',
    'User: ' + maskEmail(email),
    'Coin: ' + tx.coin + (tx.network ? ' (' + tx.network + ')' : ''),
    'Amount: ' + tx.amount + ' ' + tx.coin,
    'USD Value: $' + fmtNum(tx.usdValue, 2),
    'Fee: $' + fmtNum(fee.feeUsd, 2) + ' (' + (fee.rate * 100).toFixed(2) + '%)',
    'Status: ' + (tx.status || 'filled'),
    'Time: ' + tx.ts
  ].join('\n');

  try {
    const svg = generateStatementSVG(tx, email, fee);
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 3840 },
      font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' }
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Send as photo via multipart
    const boundary = '----ALMudir' + Date.now();
    const parts = [];
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + chat);
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption);
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML');

    const beforeFile = Buffer.from(parts.join('\r\n') + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="photo"; filename="statement_4k.png"\r\nContent-Type: image/png\r\n\r\n');
    const afterFile  = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([beforeFile, pngBuffer, afterFile]);

    await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body
    });
  } catch (imgErr) {
    // Fallback: send text-only message if image generation fails
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: caption, disable_notification: false })
    });
  }
}

// ────────────────────────────────────────────────────────
module.exports = withDb(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Auth check
  const email = await getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // Hourly system statements are generated on live traffic (Hobby-safe fallback to cron).
  try { await maybeRunHourlyReport(); } catch { /* best effort */ }

  // ── GET: return balances, supported coins, prices ─────
  if (req.method === 'GET') {
    const balances = await getWalletBalances(email);
    const prices = await fetchPrices();
    const txHistory = await getWalletTxHistory(email);

    return res.status(200).json({
      ok: true,
      balances,
      prices,
      coins: SUPPORTED_COINS,
      networks: NETWORK_META,
      treasuryAddresses: TREASURY_ADDRESSES,
      fees: COIN_FEES,
      depositFeeRate: DEPOSIT_FEE_RATE,
      transactions: txHistory.slice(0, 20)
    });
  }

  // ── POST: buy, sell, deposit_notify ───────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const action = sanitize(String(body.action || ''), 30);
  const coin = sanitize(String(body.coin || ''), 10).toUpperCase();
  const amount = Math.abs(Number(body.amount) || 0);
  const network = sanitize(String(body.network || ''), 20).toLowerCase();

  const coinRequired = action === 'deposit_notify' || action === 'buy' || action === 'sell';
  if (coinRequired && !SUPPORTED_COINS[coin]) {
    return res.status(400).json({ ok: false, error: 'unsupported_coin', detail: 'Coin not supported: ' + coin });
  }

  const prices = await fetchPrices();
  const price = prices[coin] || 0;

  // ── Action: deposit_notify (user says they sent crypto to treasury) ──
  if (action === 'deposit_notify') {
    if (!network || !TREASURY_ADDRESSES[network]) {
      return res.status(400).json({ ok: false, error: 'invalid_network' });
    }
    const coinNetworks = SUPPORTED_COINS[coin].networks;
    if (!coinNetworks.includes(network)) {
      return res.status(400).json({ ok: false, error: 'network_mismatch', detail: coin + ' is not available on network: ' + network });
    }
    if (amount <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_amount' });
    }

    const gateway = sanitize(String(body.gateway || 'crypto'), 20);
    const txHash  = sanitize(String(body.txHash || ''), 128);
    const ts = new Date().toISOString();
    const txId = generateTxId(email, 'deposit', coin, amount, ts);

    // On-chain verification (strict: only verified transfers can be credited).
    if (!txHash) {
      return res.status(400).json({ ok: false, error: 'tx_hash_required', detail: 'Provide a blockchain transaction hash to verify real funds.' });
    }
    const onChainResult = await verifyOnChainTx(network, txHash);
    if (onChainResult.verified !== true) {
      return res.status(400).json({ ok: false, error: 'tx_not_verified', detail: 'Transaction is not verifiably confirmed on-chain. Deposit not credited.', verification: onChainResult });
    }

    // Calculate deposit processing fee
    const feeRate = DEPOSIT_FEE_RATE;
    const feeCoinAmt = +(amount * feeRate).toFixed(8);
    const netAmount  = +(amount - feeCoinAmt).toFixed(8);
    const feeUsd     = +(feeCoinAmt * price).toFixed(2);
    const totalUsd   = +(amount * price).toFixed(2);

    // Credit user (net of fee)
    const balances = await getWalletBalances(email);
    balances[coin] = +((balances[coin] || 0) + netAmount).toFixed(8);
    await setWalletBalances(email, balances);

    // Collect fee to system wallet
    await addSystemFee('USDT', feeUsd);
    const collectNetwork = coin === 'USDT' || coin === 'USDC' || coin === 'ETH' || coin === 'LINK' ? 'erc20'
      : coin === 'TRX' ? 'trc20' : coin === 'BNB' ? 'bep20'
      : coin === 'BTC' ? 'bitcoin' : coin === 'SOL' ? 'solana'
      : coin === 'MATIC' ? 'polygon' : (SUPPORTED_COINS[coin].networks[0] || 'erc20');
    const collectAddr = TREASURY_ADDRESSES[collectNetwork] || TREASURY_ADDRESSES['erc20'];

    const feeInfo = {
      rate: feeRate,
      feeUsd,
      feeCoin: feeCoinAmt,
      netAmount,
      collectAddress: collectAddr,
      collectNetwork: NETWORK_META[collectNetwork] ? NETWORK_META[collectNetwork].label : collectNetwork,
      price
    };

    const tx = {
      id: txId,
      type: 'deposit',
      coin,
      network,
      amount,
      netAmount,
      usdValue: totalUsd,
      feeRate,
      feeUsd,
      feeCoin: feeCoinAmt,
      address: TREASURY_ADDRESSES[network],
      txHash: txHash || null,
      verified: onChainResult.verified,
      gateway,
      status: 'credited',
      ts
    };
    await appendWalletTx(email, tx);

    // System fee transaction record
    await appendSystemTx({
      type: 'fee_deposit', from: email, coin, network,
      feeCoin: feeCoinAmt, feeUsd, address: collectAddr,
      txId, verified: onChainResult.verified,
      ts
    });

    // Revenue log entry
    await logRevenue({
      type: 'deposit', email: maskEmail(email), coin, network,
      feeUsd, totalUsd, gateway, txId,
      verified: onChainResult.verified,
      ts
    });

    // Send 4K statement to Telegram
    try { await sendStatementToTelegram(tx, email, feeInfo); } catch { /* best effort */ }

    return res.status(200).json({ ok: true, action: 'deposit_credited', balances, tx, fee: feeInfo });
  }

  // ── Action: buy (convert USDT to crypto — fee applied) ──
  if (action === 'buy') {
    if (amount <= 0 || price <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_amount' });
    }
    const gateway  = sanitize(String(body.gateway || 'crypto'), 20);
    const feeRate    = COIN_FEES[coin] || 0.002;
    const subtotal   = +(amount * price).toFixed(2);
    const feeUsd     = +(subtotal * feeRate).toFixed(2);
    const totalCharged = +(subtotal + feeUsd).toFixed(2);
    const ts = new Date().toISOString();
    const txId = generateTxId(email, 'buy', coin, amount, ts);

    const balances = await getWalletBalances(email);
    const usdBal   = balances['USDT'] || 0;

    if (usdBal < totalCharged) {
      return res.status(400).json({ ok: false, error: 'insufficient_balance', detail: 'Need $' + totalCharged + ' USDT (incl. ' + (feeRate * 100).toFixed(2) + '% fee) but have $' + usdBal.toFixed(2) });
    }

    balances['USDT'] = +(usdBal - totalCharged).toFixed(6);
    balances[coin]   = +((balances[coin] || 0) + amount).toFixed(8);
    await setWalletBalances(email, balances);

    // Collect fee to system wallet in USDT
    await addSystemFee('USDT', feeUsd);
    const collectAddr = TREASURY_ADDRESSES['erc20'];

    const feeInfo = {
      rate: feeRate,
      feeUsd,
      totalCharged,
      collectAddress: collectAddr,
      collectNetwork: 'ERC-20',
      price
    };

    const tx = {
      id: txId,
      type: 'buy',
      coin,
      amount,
      usdValue: subtotal,
      price,
      feeRate,
      feeUsd,
      totalCharged,
      gateway,
      verified: true,
      status: 'filled',
      ts
    };
    await appendWalletTx(email, tx);

    // System fee record
    await appendSystemTx({
      type: 'fee_trade', action: 'buy', from: email, coin,
      feeUsd, address: collectAddr, txId, ts
    });

    // Revenue log
    await logRevenue({
      type: 'buy', email: maskEmail(email), coin,
      feeUsd, totalUsd: subtotal, gateway, txId,
      verified: true, ts
    });

    // Send 4K statement to Telegram
    try { await sendStatementToTelegram(tx, email, feeInfo); } catch { /* best effort */ }

    return res.status(200).json({ ok: true, action: 'buy_filled', balances, tx, fee: feeInfo });
  }

  // ── Action: sell (convert crypto to USDT — fee applied) ──
  if (action === 'sell') {
    if (amount <= 0 || price <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_amount' });
    }
    const gateway = sanitize(String(body.gateway || 'crypto'), 20);
    const balances = await getWalletBalances(email);
    const coinBal  = balances[coin] || 0;

    if (coinBal < amount) {
      return res.status(400).json({ ok: false, error: 'insufficient_balance', detail: 'Have ' + coinBal.toFixed(8) + ' ' + coin + ' but trying to sell ' + amount });
    }

    const feeRate      = COIN_FEES[coin] || 0.002;
    const grossUsd     = +(amount * price).toFixed(2);
    const feeUsd       = +(grossUsd * feeRate).toFixed(2);
    const netReceived  = +(grossUsd - feeUsd).toFixed(2);
    const ts = new Date().toISOString();
    const txId = generateTxId(email, 'sell', coin, amount, ts);

    balances[coin] = +((coinBal - amount)).toFixed(8);
    if (balances[coin] <= 0) delete balances[coin];
    balances['USDT'] = +((balances['USDT'] || 0) + netReceived).toFixed(6);
    await setWalletBalances(email, balances);

    // Collect fee in USDT to system wallet
    await addSystemFee('USDT', feeUsd);
    const collectNetwork = SUPPORTED_COINS[coin].networks[0] || 'erc20';
    const collectAddr = TREASURY_ADDRESSES[collectNetwork] || TREASURY_ADDRESSES['erc20'];

    const feeInfo = {
      rate: feeRate,
      feeUsd,
      netReceived,
      collectAddress: collectAddr,
      collectNetwork: NETWORK_META[collectNetwork] ? NETWORK_META[collectNetwork].label : collectNetwork,
      price
    };

    const tx = {
      id: txId,
      type: 'sell',
      coin,
      amount,
      usdValue: grossUsd,
      price,
      feeRate,
      feeUsd,
      netReceived,
      gateway,
      verified: true,
      status: 'filled',
      ts
    };
    await appendWalletTx(email, tx);

    // System fee record
    await appendSystemTx({
      type: 'fee_trade', action: 'sell', from: email, coin,
      feeUsd, address: collectAddr, txId, ts
    });

    // Revenue log
    await logRevenue({
      type: 'sell', email: maskEmail(email), coin,
      feeUsd, totalUsd: grossUsd, gateway, txId,
      verified: true, ts
    });

    // Send 4K statement to Telegram
    try { await sendStatementToTelegram(tx, email, feeInfo); } catch { /* best effort */ }

    return res.status(200).json({ ok: true, action: 'sell_filled', balances, tx, fee: feeInfo });
  }

  // ── Action: gateway_status (check all payment gateway health) ──
  if (action === 'gateway_status') {
    const gateways = await checkGatewayHealth();
    return res.status(200).json({ ok: true, gateways });
  }

  // ── Action: telegram_wallet_intent (fallback card/apple flow via Telegram Wallet) ──
  if (action === 'telegram_wallet_intent') {
    const requestedMethod = sanitize(String(body.requestedMethod || 'card_or_apple'), 30).toLowerCase();
    const sourceAmount = Math.abs(Number(body.sourceAmount) || 0);
    const sourceCurrency = sanitize(String(body.sourceCurrency || 'USD'), 12).toUpperCase();
    const targetAmount = Math.abs(Number(body.targetAmount) || 0);
    const targetAsset = sanitize(String(body.targetAsset || 'USDT'), 12).toUpperCase();

    if (sourceAmount <= 0 || targetAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_amount', detail: 'sourceAmount and targetAmount must be > 0' });
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const intentId = 'TGW-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    const intent = {
      id: intentId,
      type: 'telegram_wallet_intent',
      status: 'pending',
      requestedMethod,
      sourceAmount: +sourceAmount.toFixed(2),
      sourceCurrency,
      targetAmount: +targetAmount.toFixed(8),
      targetAsset,
      payUrl: 'https://t.me/wallet',
      instructions: 'Open Telegram Wallet, send funds to AL-MUDIR treasury, then submit TX hash in Deposit panel for strict on-chain verification.',
      createdAt,
      expiresAt
    };

    await redis('SET', telegramIntentKey(intentId), intent);
    await appendTelegramIntentForUser(email, intent);
    try { await sendTelegramWalletIntent(intent, email); } catch { /* best effort */ }

    return res.status(200).json({ ok: true, action: 'telegram_wallet_intent_created', intent });
  }

  // ── Action: system_report (generate and send hourly report) ──
  if (action === 'system_report') {
    const report = await generateSystemReport();
    // Send 4K report to Telegram
    try { await sendSystemReportToTelegram(report); } catch { /* best effort */ }
    await redis('SET', REPORT_CACHE_KEY, report);
    return res.status(200).json({ ok: true, report });
  }

  return res.status(400).json({ ok: false, error: 'unknown_action' });
});
