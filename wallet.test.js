// wallet.test.js — Node.js unit tests for CryptoPaymentManager
// Run: node wallet.test.js

// ─── Browser global shims ────────────────────────────────────────────────────
global.window = global;
global.fetch = async () => ({ json: async () => null }); // simulates offline/failed fetch

const CryptoPaymentManager = require('./crypto-payment.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    process.stdout.write(`  \x1b[32m✓\x1b[0m  ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  \x1b[31m✗\x1b[0m  ${label}${detail ? ' — ' + detail : ''}\n`);
    failed++;
  }
}

async function run() {
  console.log('\n\x1b[1mAL-MUDIR — CryptoPaymentManager test suite\x1b[0m\n');

  // ── 1. Instantiation ───────────────────────────────────────────────────────
  console.log('1. Instantiation');
  const mgr = new CryptoPaymentManager();
  assert('instance created', mgr instanceof CryptoPaymentManager);
  assert('walletConnected defaults false', mgr.walletConnected === false);
  assert('paymentInProgress defaults false', mgr.paymentInProgress === false);
  assert('supportedChains has ETH mainnet (1)', !!mgr.supportedChains[1]);
  assert('supportedChains has BNB chain (56)', !!mgr.supportedChains[56]);
  assert('treasuryNativeAddress eth set', typeof mgr.treasuryNativeAddress[1] === 'string');
  assert('treasuryNativeAddress bnb set', typeof mgr.treasuryNativeAddress[56] === 'string');

  // ── 2. Provider detection — no wallet installed ───────────────────────────
  console.log('\n2. Provider detection (no injected wallet)');
  delete global.window.ethereum;
  delete global.window.BinanceChain;
  const noProviders = mgr.getInjectedProviders();
  assert('returns empty array when no wallet', Array.isArray(noProviders) && noProviders.length === 0);
  assert('hasInjectedWallets false when no wallet', mgr.hasInjectedWallets() === false);

  let noWalletThrew = false;
  try { mgr.pickProvider('auto'); } catch (e) {
    noWalletThrew = true;
    assert('pickProvider throws when no provider', e.message.includes('No compatible wallet'));
  }
  if (!noWalletThrew) assert('pickProvider throws when no provider', false, 'no error thrown');

  // ── 3. Provider matching ──────────────────────────────────────────────────
  console.log('\n3. Provider matching');
  const mockMM  = { isMetaMask: true };
  const mockTW  = { isTrust: true };
  const mockTW2 = { isTrustWallet: true };
  const mockCB  = { isCoinbaseWallet: true };
  const mockBN  = { isBinance: true };
  const mockGeneric = { request: async () => null, on: () => {} };

  assert('auto matches anything',                mgr.matchProvider('auto', mockMM));
  assert('metamask matches MetaMask',            mgr.matchProvider('metamask', mockMM));
  assert('metamask rejects TrustWallet',        !mgr.matchProvider('metamask', mockTW));
  assert('trustwallet matches isTrust',          mgr.matchProvider('trustwallet', mockTW));
  assert('trustwallet matches isTrustWallet',    mgr.matchProvider('trustwallet', mockTW2));
  assert('coinbase matches isCoinbaseWallet',    mgr.matchProvider('coinbase', mockCB));
  assert('binance matches isBinance',            mgr.matchProvider('binance', mockBN));
  assert('unknown type matches generic provider', mgr.matchProvider('unknown_ext', mockGeneric));

  // ── 4. detectProviderName ─────────────────────────────────────────────────
  console.log('\n4. detectProviderName');
  assert('metamask',    mgr.detectProviderName(mockMM) === 'metamask');
  assert('trustwallet', mgr.detectProviderName(mockTW) === 'trustwallet');
  assert('coinbase',    mgr.detectProviderName(mockCB) === 'coinbase');
  assert('binance',     mgr.detectProviderName(mockBN) === 'binance');
  assert('null = unknown', mgr.detectProviderName(null) === 'unknown');
  assert('bare object = injected', mgr.detectProviderName({}) === 'injected');

  // ── 5. pickProvider with injected providers ───────────────────────────────
  console.log('\n5. pickProvider selection (mocked window.ethereum)');
  global.window.ethereum = { providers: [mockMM, mockTW] };

  const allProviders = mgr.getInjectedProviders();
  // window.ethereum itself is also added when it differs from its .providers children
  assert('detects both providers in array', allProviders.length >= 2);
  assert('hasInjectedWallets true when provider exists', mgr.hasInjectedWallets() === true);

  const pickedMM = mgr.pickProvider('metamask');
  assert('picks MetaMask when requested', pickedMM === mockMM);

  const pickedTW = mgr.pickProvider('trustwallet');
  assert('picks TrustWallet when requested', pickedTW === mockTW);

  const pickedAuto = mgr.pickProvider('auto');
  assert('auto picks first provider', pickedAuto !== undefined);

  // WalletConnect never matches an injected provider — should throw
  let wcThrew = false;
  delete global.window.BinanceChain;
  try { mgr.pickProvider('walletconnect'); } catch (e) {
    wcThrew = true;
    assert('walletconnect throws fallback guidance', e.message.includes('WalletConnect requested') || e.message.includes('Open this page in a wallet app'));
  }
  if (!wcThrew) assert('walletconnect throws fallback guidance', false);

  // ── 5b. Wallet app fallback links ─────────────────────────────────────────
  console.log('\n5b. wallet app fallback links');
  const dappUrl = 'https://al-mudir.org/#portalAuth';
  assert('MetaMask deeplink generated', mgr.getWalletAppLink('metamask', dappUrl).startsWith('https://metamask.app.link/dapp/'));
  assert('Trust Wallet deeplink generated', mgr.getWalletAppLink('trustwallet', dappUrl).startsWith('https://link.trustwallet.com/open_url?url='));
  assert('Coinbase deeplink generated', mgr.getWalletAppLink('coinbase', dappUrl).startsWith('https://go.cb-w.com/dapp?cb_url='));
  assert('Auto fallback returns site URL', mgr.getWalletAppLink('auto', dappUrl) === dappUrl);

  // ── 6. connectWallet flow (mocked) ────────────────────────────────────────
  console.log('\n6. connectWallet (mocked Ethereum mainnet)');
  const mockProvider = {
    isMetaMask: true,
    request: async (args) => {
      if (args.method === 'eth_requestAccounts') return ['0xDeAdBeEfCaFe'];
      if (args.method === 'eth_chainId') return '0x1'; // mainnet
      return null;
    }
  };
  global.window.ethereum = mockProvider;

  const mgr2 = new CryptoPaymentManager();
  const wallet = await mgr2.connectWallet('auto');
  assert('returns account address',     wallet.account === '0xDeAdBeEfCaFe');
  assert('chainId parsed to 1',         wallet.chain === 1);
  assert('chainName is Ethereum',       wallet.chainName === 'Ethereum');
  assert('provider name is metamask',   wallet.provider === 'metamask');
  assert('walletConnected = true',      mgr2.walletConnected === true);

  // ── 7. connectWallet — empty accounts rejection ───────────────────────────
  console.log('\n7. connectWallet edge cases');
  const emptyAccountProvider = {
    isMetaMask: true,
    request: async (args) => {
      if (args.method === 'eth_requestAccounts') return [];
      if (args.method === 'eth_chainId') return '0x1';
      return null;
    }
  };
  global.window.ethereum = emptyAccountProvider;
  const mgr3 = new CryptoPaymentManager();
  let emptyErr = false;
  try { await mgr3.connectWallet('auto'); } catch (e) {
    emptyErr = true;
    assert('rejects when wallet returns no accounts', e.message.includes('no accounts'));
  }
  if (!emptyErr) assert('rejects when wallet returns no accounts', false);

  // Additional supported chain (Polygon = 0x89 = 137)
  const polygonProvider = {
    isMetaMask: true,
    request: async (args) => {
      if (args.method === 'eth_requestAccounts') return ['0xABC'];
      if (args.method === 'eth_chainId') return '0x89';
      return null;
    }
  };
  global.window.ethereum = polygonProvider;
  const mgr4 = new CryptoPaymentManager();
  const polygonWallet = await mgr4.connectWallet('auto');
  assert('accepts supported chain (Polygon)', polygonWallet.chain === 137);
  assert('reports Polygon chain name', polygonWallet.chainName === 'Polygon');

  // ── 8. Currency conversion (fallback rates — fetch is mocked to fail) ──────
  console.log('\n8. Currency conversion (offline fallback)');
  const mgr5 = new CryptoPaymentManager();

  const usdToEur = await mgr5.convertCurrency(100, 'USD', 'EUR');
  assert('USD→EUR uses fallback, result > 0',   typeof usdToEur === 'number' && usdToEur > 0);
  assert('USD→EUR plausible range (0.5–1.5)',    usdToEur > 50 && usdToEur < 150);

  const ethToUsd = await mgr5.convertCurrency(1, 'ETH', 'USD');
  assert('ETH→USD uses fallback rate',           typeof ethToUsd === 'number' && ethToUsd > 0);
  assert('ETH→USD plausible ($1000–$10000)',     ethToUsd > 1000 && ethToUsd < 10000);

  const same = await mgr5.convertCurrency(42, 'USD', 'USD');
  assert('same currency returns same amount',    same === 42);

  const supportedSymbols = mgr5.getSupportedCurrencySymbols();
  assert('supported list includes JPY', supportedSymbols.includes('JPY'));
  assert('supported list includes XRP', supportedSymbols.includes('XRP'));

  const usdToJpy = await mgr5.convertCurrency(10, 'USD', 'JPY');
  assert('USD→JPY converts with expanded fiat support', typeof usdToJpy === 'number' && usdToJpy > 1000);

  const xrpToUsd = await mgr5.convertCurrency(100, 'XRP', 'USD');
  assert('XRP→USD converts with expanded crypto support', typeof xrpToUsd === 'number' && xrpToUsd > 10);

  let negErr = false;
  try { await mgr5.convertCurrency(-5, 'USD', 'ETH'); } catch (e) {
    negErr = true;
    assert('rejects negative amount',            e.message === 'Invalid amount');
  }
  if (!negErr) assert('rejects negative amount', false);

  let zeroErr = false;
  try { await mgr5.convertCurrency(0, 'USD', 'ETH'); } catch (e) {
    zeroErr = true;
    assert('rejects zero amount',                e.message === 'Invalid amount');
  }
  if (!zeroErr) assert('rejects zero amount', false);

  // ── 9. processPayment guards ───────────────────────────────────────────────
  console.log('\n9. processPayment guards');
  const mgr6 = new CryptoPaymentManager();
  // not connected
  let notConnErr = false;
  try { await mgr6.processPayment({ amount: 0.1, currency: 'ETH' }); } catch (e) {
    notConnErr = true;
    assert('rejects when wallet not connected',  e.message === 'Wallet not connected');
  }
  if (!notConnErr) assert('rejects when wallet not connected', false);

  // paymentInProgress guard
  const mgr7 = new CryptoPaymentManager();
  mgr7.walletConnected = true;
  mgr7.paymentInProgress = true;
  let inProgressErr = false;
  try { await mgr7.processPayment({ amount: 0.1, currency: 'ETH' }); } catch (e) {
    inProgressErr = true;
    assert('rejects duplicate payment in-progress', e.message.includes('already in progress'));
  }
  if (!inProgressErr) assert('rejects duplicate payment in-progress', false);

  // Direct token payment uses token transfer path
  const mgr7b = new CryptoPaymentManager();
  mgr7b.walletConnected = true;
  mgr7b.userAccount = '0x1111111111111111111111111111111111111111';
  mgr7b.chainId = 1;
  mgr7b.web3Instance = {
    request: async (args) => {
      if (args.method === 'eth_gasPrice') return '0x3b9aca00';
      if (args.method === 'eth_sendTransaction') return '0xtokenhash';
      return null;
    }
  };
  const tokenPayment = await mgr7b.processPayment({ amount: 25, currency: 'USDT' });
  assert('routes USDT payments through token transfer path', tokenPayment.transactionHash === '0xtokenhash');
  assert('token payment keeps connected chain', tokenPayment.chainId === 1);

  // ── 10. toWei conversion ──────────────────────────────────────────────────
  console.log('\n10. toWei conversion');
  const mgr8 = new CryptoPaymentManager();
  assert('1 ETH = 1e18 wei',    mgr8.toWei(1, 'ETH') === String(1e18));
  assert('0.5 ETH correct',     mgr8.toWei(0.5, 'ETH') === '500000000000000000');
  assert('1 BNB = 1e18 wei',    mgr8.toWei(1, 'BNB') === String(1e18));

  // ── 11. encodePaymentData ──────────────────────────────────────────────────
  console.log('\n11. encodePaymentData');
  const mgr9 = new CryptoPaymentManager();
  assert('null → 0x',              mgr9.encodePaymentData(null) === '0x');
  assert('empty string → 0x',      mgr9.encodePaymentData('') === '0x');
  const enc = mgr9.encodePaymentData('ALMUDIR');
  assert('non-empty starts with 0x', enc.startsWith('0x'));
  assert('non-empty has hex chars',  /^0x[0-9a-f]+$/.test(enc));
  assert('max 128 hex chars + 0x',   enc.length <= 130);

  // ── 12. disconnectWallet resets state ────────────────────────────────────
  console.log('\n12. disconnectWallet');
  const mgr10 = new CryptoPaymentManager();
  mgr10.userAccount = '0xABC';
  mgr10.walletConnected = true;
  mgr10.chainId = 1;
  mgr10.disconnectWallet();
  assert('userAccount cleared',    mgr10.userAccount === null);
  assert('walletConnected false',  mgr10.walletConnected === false);
  assert('chainId cleared',        mgr10.chainId === null);

  // ── 13. getBalance requires connection ───────────────────────────────────
  console.log('\n13. getBalance guard');
  const mgr11 = new CryptoPaymentManager();
  let balErr = false;
  try { await mgr11.getBalance(); } catch (e) {
    balErr = true;
    assert('rejects getBalance when not connected', e.message.includes('not connected'));
  }
  if (!balErr) assert('rejects getBalance when not connected', false);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(48));
  const total = passed + failed;
  console.log(`Tests: ${total}  \x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\n\x1b[31mTest runner crashed:\x1b[0m', err);
  process.exit(1);
});
