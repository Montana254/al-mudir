'use strict';

// ────────────────────────────────────────────────────────
// Public Real-Time Market Prices API
// No auth required — serves live CoinGecko crypto prices
// plus forex/commodity quotes for the market dashboard
// ────────────────────────────────────────────────────────

const CRYPTO_CACHE = { rates: {}, changes: {}, ts: 0 };
const FOREX_CACHE  = { rates: {}, ts: 0 };
const CRYPTO_TTL   = 30 * 1000;  // 30s
const FOREX_TTL    = 60 * 1000;  // 60s

const COIN_IDS = 'bitcoin,ethereum,binancecoin,tether,usd-coin,ripple,litecoin,solana,dogecoin,tron,cardano,avalanche-2,polkadot,chainlink,matic-network,the-open-network,stellar';
const COIN_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', USDT: 'tether', USDC: 'usd-coin',
  XRP: 'ripple', LTC: 'litecoin', SOL: 'solana', DOGE: 'dogecoin', TRX: 'tron',
  ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot', LINK: 'chainlink',
  MATIC: 'matic-network', TON: 'the-open-network', XLM: 'stellar'
};

async function fetchCrypto() {
  if (Date.now() - CRYPTO_CACHE.ts < CRYPTO_TTL && Object.keys(CRYPTO_CACHE.rates).length) {
    return { rates: CRYPTO_CACHE.rates, changes: CRYPTO_CACHE.changes };
  }
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + COIN_IDS + '&vs_currencies=usd&include_24hr_change=true';
    const r = await fetch(url);
    if (!r.ok) throw new Error('CoinGecko ' + r.status);
    const data = await r.json();
    const rates = {}, changes = {};
    for (const [sym, id] of Object.entries(COIN_MAP)) {
      if (data[id]) {
        if (data[id].usd) rates[sym] = data[id].usd;
        if (data[id].usd_24h_change != null) changes[sym] = +data[id].usd_24h_change.toFixed(2);
      }
    }
    if (Object.keys(rates).length > 0) {
      CRYPTO_CACHE.rates = rates;
      CRYPTO_CACHE.changes = changes;
      CRYPTO_CACHE.ts = Date.now();
    }
    return { rates, changes };
  } catch {
    return { rates: CRYPTO_CACHE.rates, changes: CRYPTO_CACHE.changes };
  }
}

async function fetchForex() {
  if (Date.now() - FOREX_CACHE.ts < FOREX_TTL && Object.keys(FOREX_CACHE.rates).length) {
    return FOREX_CACHE.rates;
  }
  try {
    // ExchangeRate-API free tier for forex pairs
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!r.ok) throw new Error('ExchangeRate ' + r.status);
    const data = await r.json();
    const rates = {};
    if (data.rates) {
      if (data.rates.EUR) rates['EURUSD'] = +(1 / data.rates.EUR).toFixed(5);
      if (data.rates.JPY) rates['USDJPY'] = +data.rates.JPY.toFixed(3);
      if (data.rates.GBP) rates['GBPUSD'] = +(1 / data.rates.GBP).toFixed(5);
    }
    if (Object.keys(rates).length > 0) {
      FOREX_CACHE.rates = rates;
      FOREX_CACHE.ts = Date.now();
    }
    return rates;
  } catch {
    return FOREX_CACHE.rates;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const [crypto, forex] = await Promise.all([fetchCrypto(), fetchForex()]);

  // Build market board entries with real data
  const market = [];

  // Crypto pairs
  const cryptoSymbols = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC', 'TRX', 'MATIC', 'TON', 'XLM'];
  for (const sym of cryptoSymbols) {
    if (crypto.rates[sym]) {
      market.push({
        symbol: sym + 'USDT',
        price: crypto.rates[sym],
        change: crypto.changes[sym] || 0,
        type: 'crypto'
      });
    }
  }

  // Forex pairs
  for (const [symbol, price] of Object.entries(forex)) {
    market.push({ symbol, price, change: 0, type: 'forex' });
  }

  return res.status(200).json({
    ok: true,
    ts: Date.now(),
    cryptoUpdatedAt: CRYPTO_CACHE.ts,
    forexUpdatedAt: FOREX_CACHE.ts,
    market,
    prices: crypto.rates,
    changes: crypto.changes
  });
};
