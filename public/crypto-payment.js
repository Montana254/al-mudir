// AL-MUDIR Crypto wallet and conversion helper
// Supports injected EVM wallets: MetaMask, Trust Wallet, Coinbase Wallet, Binance Wallet, and auto-detect.

class CryptoPaymentManager {
  constructor() {
    this.web3Instance = null;
    this.userAccount = null;
    this.chainId = null;
    this.walletConnected = false;
    this.paymentInProgress = false;

    this.supportedChains = {
      1: { name: 'Ethereum', symbol: 'ETH', rpc: 'https://eth.llamarpc.com' },
      56: { name: 'BNB Smart Chain', symbol: 'BNB', rpc: 'https://bsc-dataseed.binance.org' }
    };

    this.paymentRates = {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      JPY: 149,
      CHF: 0.88,
      CAD: 1.35,
      AUD: 1.52,
      NZD: 1.65,
      SEK: 10.4,
      NOK: 10.6,
      DKK: 6.9,
      SGD: 1.34,
      HKD: 7.8,
      CNY: 7.2,
      INR: 83.1,
      AED: 3.67,
      ZAR: 18.4,
      TRY: 31.2,
      MXN: 16.8,
      BRL: 5.1,
      PLN: 3.9,
      CZK: 22.7,
      HUF: 360,
      RUB: 91,
      BTC: 87000,
      ETH: 2050,
      BNB: 620,
      USDT: 1,
      USDC: 1,
      XRP: 2.3,
      LTC: 100,
      BCH: 370,
      DOGE: 0.18,
      TRX: 0.23,
      TON: 3.6,
      XLM: 0.32,
      AVAX: 22,
      MATIC: 0.38,
      APT: 5.5,
      ADA: 0.72,
      SOL: 130,
      DOT: 4.5,
      LINK: 14,
      UNI: 6.5
    };

    this.fiatApiUrl = 'https://api.exchangerate-api.com/v4/latest/USD';
    this.cryptoApiUrl = 'https://api.coingecko.com/api/v3/simple/price';
    this.cacheExpiry = 5 * 60 * 1000;
    this.rateCache = {};

    this.fiatCurrencies = [
      'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK',
      'SGD', 'HKD', 'CNY', 'INR', 'AED', 'ZAR', 'TRY', 'MXN', 'BRL', 'PLN', 'CZK',
      'HUF', 'RUB'
    ];
    this.cryptoCurrencies = [
      'BTC', 'ETH', 'BNB', 'USDT', 'USDC', 'XRP', 'LTC', 'BCH', 'DOGE', 'TRX',
      'TON', 'XLM', 'AVAX', 'MATIC', 'APT', 'ADA', 'SOL', 'DOT', 'LINK', 'UNI'
    ];

    this.treasuryNativeAddress = {
      1: '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
      56: '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20'
    };

    this.treasuryAddresses = {
      BTC: 'bc1qfe8kjaau2n2ggknmx6a8gclzwc9xz3zpj0lcsp',
      USDT_ERC20: '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
      USDT_TRC20: 'TLNNQNDsH6JG9dxd99Tqfkb8eSPRUyhC4E'
    };

    // ERC-20 / BEP-20 token contracts for direct wallet transfers
    this.tokenContracts = {
      1: { // Ethereum Mainnet
        USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
        USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
        LINK: { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 }
      },
      56: { // BNB Smart Chain
        USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
        USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }
      }
    };

    // Quick deposit coin → network mapping for backend
    this.quickDepositNetworkMap = {
      1:  { ETH: 'erc20', USDT: 'erc20', USDC: 'erc20', LINK: 'erc20' },
      56: { BNB: 'bep20', USDT: 'bep20', USDC: 'bep20' }
    };
  }

  getInjectedProviders() {
    const providers = [];

    if (window.ethereum?.providers && Array.isArray(window.ethereum.providers)) {
      providers.push(...window.ethereum.providers);
    }

    if (window.ethereum && !providers.includes(window.ethereum)) {
      providers.push(window.ethereum);
    }

    if (window.BinanceChain && !providers.includes(window.BinanceChain)) {
      providers.push(window.BinanceChain);
    }

    return providers;
  }

  getSupportedCurrencySymbols() {
    return Array.from(new Set([...this.fiatCurrencies, ...this.cryptoCurrencies]));
  }

  getPayoutCurrencySymbols() {
    return this.getSupportedCurrencySymbols();
  }

  hasInjectedWallets() {
    return this.getInjectedProviders().length > 0;
  }

  isMobileBrowser(userAgent) {
    const ua = String(
      userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '')
    ).toLowerCase();
    return /android|iphone|ipad|ipod|mobile/.test(ua);
  }

  getWalletAppLink(walletType = 'auto', targetUrl) {
    const type = String(walletType || 'auto').toLowerCase();
    const dappUrl = String(
      targetUrl ||
        (typeof window !== 'undefined'
          ? window.location.origin + window.location.pathname + '#portalAuth'
          : '')
    ).trim();
    const strippedUrl = dappUrl.replace(/^https?:\/\//i, '');

    if (type === 'metamask') {
      return 'https://metamask.app.link/dapp/' + strippedUrl;
    }

    if (type === 'trustwallet') {
      return 'https://link.trustwallet.com/open_url?url=' + encodeURIComponent(dappUrl);
    }

    if (type === 'coinbase') {
      return 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(dappUrl);
    }

    return dappUrl;
  }

  matchProvider(walletType, provider) {
    if (!provider) return false;

    const type = String(walletType || 'auto').toLowerCase();
    if (type === 'auto') {
      return true;
    }

    if (type === 'metamask') return !!provider.isMetaMask;
    if (type === 'trustwallet') return !!provider.isTrust || !!provider.isTrustWallet;
    if (type === 'coinbase') return !!provider.isCoinbaseWallet;
    if (type === 'binance') return !!provider.isBinance || provider === window.BinanceChain;
    if (type === 'walletconnect') return false; // WalletConnect is not an injected provider

    return true;
  }

  pickProvider(walletType = 'auto') {
    const providers = this.getInjectedProviders();

    if (!providers.length) {
      throw new Error('No compatible wallet provider detected in this browser.');
    }

    const matched = providers.find((provider) => this.matchProvider(walletType, provider));
    if (matched) return matched;

    if (walletType === 'walletconnect') {
      throw new Error('No extension detected. Open this page in a wallet app or scan the QR helper in Deposit.');
    }

    throw new Error('Selected wallet provider is not detected. Please install or enable that wallet.');
  }

  detectProviderName(provider) {
    if (!provider) return 'unknown';
    if (provider.isMetaMask) return 'metamask';
    if (provider.isTrust || provider.isTrustWallet) return 'trustwallet';
    if (provider.isCoinbaseWallet) return 'coinbase';
    if (provider.isBinance || provider === window.BinanceChain) return 'binance';
    return 'injected';
  }

  async connectWallet(walletType = 'auto') {
    const provider = this.pickProvider(walletType);

    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) {
      throw new Error('Wallet returned no accounts.');
    }

    this.web3Instance = provider;
    this.userAccount = accounts[0];
    this.walletConnected = true;

    const rawChain = await provider.request({ method: 'eth_chainId' });
    this.chainId = String(rawChain).startsWith('0x') ? parseInt(rawChain, 16) : Number(rawChain);

    if (!this.supportedChains[this.chainId]) {
      throw new Error('Unsupported network. Switch to Ethereum Mainnet or BNB Smart Chain.');
    }

    return {
      account: this.userAccount,
      chain: this.chainId,
      chainName: this.supportedChains[this.chainId].name,
      provider: this.detectProviderName(provider)
    };
  }

  async getGasPrice() {
    return this.web3Instance.request({ method: 'eth_gasPrice' });
  }

  toWei(amount, currency) {
    const decimals = {
      ETH: 18,
      BNB: 18
    };
    const units = decimals[currency] || 18;
    return Math.floor(Number(amount) * Math.pow(10, units)).toString();
  }

  encodePaymentData(description) {
    if (!description) return '0x';
    const encoded = Array.from(description)
      .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    return '0x' + encoded.slice(0, 128);
  }

  async buildTransactionPayload(amount, currency, recipientAddress, description) {
    const supportedNative = ['ETH', 'BNB'];
    if (!supportedNative.includes(currency)) {
      throw new Error('Direct wallet transfer currently supports ETH or BNB only. Use Deposit for BTC/USDT transfers.');
    }

    const gasPrice = await this.getGasPrice();
    const defaultRecipient = this.treasuryNativeAddress[this.chainId] || this.treasuryNativeAddress[1];

    return {
      from: this.userAccount,
      to: recipientAddress || defaultRecipient,
      value: this.toWei(amount, currency),
      gas: '21000',
      gasPrice: gasPrice,
      data: this.encodePaymentData(description)
    };
  }

  async processPayment(paymentDetails) {
    if (!this.walletConnected) {
      throw new Error('Wallet not connected');
    }

    if (this.paymentInProgress) {
      throw new Error('Payment already in progress');
    }

    this.paymentInProgress = true;

    try {
      const txPayload = await this.buildTransactionPayload(
        paymentDetails.amount,
        paymentDetails.currency,
        paymentDetails.recipientAddress,
        paymentDetails.description
      );

      const txHash = await this.web3Instance.request({
        method: 'eth_sendTransaction',
        params: [txPayload]
      });

      return {
        transactionHash: txHash,
        amount: paymentDetails.amount,
        currency: paymentDetails.currency,
        recipientAddress: txPayload.to,
        chainId: this.chainId,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.paymentInProgress = false;
    }
  }

  async fetchFiatRates() {
    try {
      const response = await fetch(this.fiatApiUrl);
      const data = await response.json();
      if (!data?.rates) throw new Error('Invalid fiat rate response');

      data.rates.USD = data.rates.USD || 1;
      this.rateCache.fiat = { rates: data.rates, timestamp: Date.now() };
      return data.rates;
    } catch (_) {
      return null;
    }
  }

  async fetchCryptoRates() {
    try {
      const cryptoIds = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        BNB: 'binancecoin',
        USDT: 'tether',
        USDC: 'usd-coin',
        XRP: 'ripple',
        LTC: 'litecoin',
        BCH: 'bitcoin-cash',
        DOGE: 'dogecoin',
        TRX: 'tron',
        TON: 'the-open-network',
        XLM: 'stellar',
        AVAX: 'avalanche-2',
        MATIC: 'matic-network',
        APT: 'aptos',
        ADA: 'cardano',
        SOL: 'solana',
        DOT: 'polkadot',
        LINK: 'chainlink',
        UNI: 'uniswap'
      };

      const ids = Object.values(cryptoIds).join(',');
      const response = await fetch(`${this.cryptoApiUrl}?ids=${ids}&vs_currencies=usd`);
      const data = await response.json();
      if (!data) throw new Error('Invalid crypto rate response');

      const rates = {};
      Object.entries(cryptoIds).forEach(([symbol, id]) => {
        if (data[id]?.usd) rates[symbol] = data[id].usd;
      });

      this.rateCache.crypto = { rates, timestamp: Date.now() };
      return rates;
    } catch (_) {
      return null;
    }
  }

  async getRate(currency) {
    const code = String(currency || '').toUpperCase();
    if (code === 'USD') return 1;

    const now = Date.now();

    // Fiat path: support broad ISO fiat symbols using live API rates.
    if (!this.rateCache.fiat || now - this.rateCache.fiat.timestamp > this.cacheExpiry) {
      await this.fetchFiatRates();
    }
    const fiatRate = this.rateCache.fiat?.rates?.[code];
    if (typeof fiatRate === 'number' && fiatRate > 0) {
      return fiatRate;
    }

    if (this.cryptoCurrencies.includes(code)) {
      if (!this.rateCache.crypto || now - this.rateCache.crypto.timestamp > this.cacheExpiry) {
        await this.fetchCryptoRates();
      }
      const cryptoRate = this.rateCache.crypto?.rates?.[code] || this.paymentRates[code];
      if (typeof cryptoRate === 'number' && cryptoRate > 0) {
        return cryptoRate;
      }
    }

    if (typeof this.paymentRates[code] === 'number' && this.paymentRates[code] > 0) {
      return this.paymentRates[code];
    }

    throw new Error('Unsupported currency: ' + code);
  }

  async convertCurrency(amount, fromCurrency, toCurrency) {
    const value = Number(amount);
    const fromCode = String(fromCurrency || '').toUpperCase();
    const toCode = String(toCurrency || '').toUpperCase();

    if (!value || value <= 0) throw new Error('Invalid amount');
    if (fromCode === toCode) return value;

    // Rate normalisation:
    // - Fiat rates (exchangerate-api) = units of that currency per 1 USD  (EUR: 0.92 → 1 USD = 0.92 EUR)
    //   So: 1 unit costs 1/rate USD.
    // - Crypto rates (CoinGecko)      = USD price per 1 unit              (ETH: 3500 → 1 ETH = $3500)
    //   So: 1 unit costs rate USD.
    const toUsdPrice = (code, rate) => {
      if (code === 'USD') return 1;
      return this.fiatCurrencies.includes(code) ? 1 / rate : rate;
    };

    try {
      const [fromRate, toRate] = await Promise.all([this.getRate(fromCode), this.getRate(toCode)]);
      const fromUsd = toUsdPrice(fromCode, fromRate);
      const toUsd = toUsdPrice(toCode, toRate);
      return (value * fromUsd) / toUsd;
    } catch (_) {
      const fromRate = this.paymentRates[fromCode] || 1;
      const toRate = this.paymentRates[toCode] || 1;
      const fromUsd = toUsdPrice(fromCode, fromRate);
      const toUsd = toUsdPrice(toCode, toRate);
      return (value * fromUsd) / toUsd;
    }
  }

  disconnectWallet() {
    this.userAccount = null;
    this.walletConnected = false;
    this.web3Instance = null;
    this.chainId = null;
  }

  /**
   * Get the list of coins available for quick (one-click) deposit on the current chain.
   * Returns array of { coin, type: 'native'|'token', network, decimals?, tokenAddress? }
   */
  getQuickDepositCoins() {
    if (!this.chainId) return [];
    const chain = this.supportedChains[this.chainId];
    if (!chain) return [];

    const coins = [];
    const networkMap = this.quickDepositNetworkMap[this.chainId] || {};

    // Native coin first
    coins.push({
      coin: chain.symbol,
      type: 'native',
      network: networkMap[chain.symbol] || 'erc20',
      decimals: 18
    });

    // ERC-20 / BEP-20 tokens
    const tokens = this.tokenContracts[this.chainId] || {};
    for (const [symbol, info] of Object.entries(tokens)) {
      coins.push({
        coin: symbol,
        type: 'token',
        network: networkMap[symbol] || 'erc20',
        decimals: info.decimals,
        tokenAddress: info.address
      });
    }

    return coins;
  }

  /**
   * Get ERC-20 / BEP-20 token balance for the connected wallet.
   */
  async getTokenBalance(tokenAddress, decimals) {
    if (!this.walletConnected || !this.userAccount) throw new Error('Wallet not connected');

    // balanceOf(address) selector: 0x70a08231
    const data = '0x70a08231' + this.userAccount.slice(2).toLowerCase().padStart(64, '0');

    const balanceHex = await this.web3Instance.request({
      method: 'eth_call',
      params: [{ to: tokenAddress, data: data }, 'latest']
    });

    return parseInt(balanceHex, 16) / Math.pow(10, decimals);
  }

  /**
   * Send ERC-20 / BEP-20 token from connected wallet to treasury.
   */
  async sendToken(tokenAddress, amount, decimals, recipientAddress) {
    if (!this.walletConnected) throw new Error('Wallet not connected');
    if (this.paymentInProgress) throw new Error('Payment already in progress');

    this.paymentInProgress = true;
    try {
      const to = recipientAddress || this.treasuryNativeAddress[this.chainId] || this.treasuryNativeAddress[1];

      // Encode transfer(address, uint256)
      // Parse amount to token units avoiding floating point issues
      const parts = String(amount).split('.');
      const whole = parts[0] || '0';
      const frac = (parts[1] || '').slice(0, decimals).padEnd(decimals, '0');
      const unitsBigInt = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
      const amountHex = unitsBigInt.toString(16).padStart(64, '0');
      const addrHex = to.slice(2).toLowerCase().padStart(64, '0');
      const data = '0xa9059cbb' + addrHex + amountHex;

      const gasPrice = await this.getGasPrice();

      const txHash = await this.web3Instance.request({
        method: 'eth_sendTransaction',
        params: [{
          from: this.userAccount,
          to: tokenAddress,
          value: '0x0',
          gas: '0x' + (100000).toString(16),
          gasPrice: gasPrice,
          data: data
        }]
      });

      return {
        transactionHash: txHash,
        amount: amount,
        tokenAddress: tokenAddress,
        recipientAddress: to,
        chainId: this.chainId,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.paymentInProgress = false;
    }
  }

  async getBalance() {
    if (!this.walletConnected || !this.userAccount) throw new Error('Wallet not connected');

    const balanceHex = await this.web3Instance.request({
      method: 'eth_getBalance',
      params: [this.userAccount, 'latest']
    });

    return (parseInt(balanceHex, 16) / Math.pow(10, 18)).toFixed(4);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoPaymentManager;
}

if (typeof window !== 'undefined') {
  window.CryptoPaymentManager = CryptoPaymentManager;
}
