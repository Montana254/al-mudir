// AL-MUDIR Crypto Wallet Payment Integration Module
// Optimized for Trust Wallet + MetaMask
// Supports: USDT, BTC, TRON, ETH, BNB

class CryptoPaymentManager {
  constructor() {
    this.web3Instance = null;
    this.userAccount = null;
    this.chainId = null;
    
    // Simplified: Focus on main chains for Trust Wallet
    this.supportedChains = {
      1: { name: 'Ethereum', symbol: 'ETH', rpc: 'https://eth.llamarpc.com', nativeToken: 'ETH' },
      56: { name: 'BSC', symbol: 'BNB', rpc: 'https://bsc-dataseed.binance.org', nativeToken: 'BNB' },
      195: { name: 'TRON', symbol: 'TRX', rpc: 'https://api.trongrid.io', nativeToken: 'TRX' }
    };
    
    // Payment rates (in USD, update from price feed)
    this.paymentRates = {
      // Fiat Currencies
      USD: 1.00,
      EUR: 0.92,
      GBP: 0.79,
      JPY: 150.50,
      CHF: 0.91,
      CAD: 1.35,
      AUD: 1.52,
      CNY: 7.25,
      INR: 83.50,
      BRL: 5.20,
      ZAR: 18.75,
      AED: 3.67,
      // Cryptocurrencies
      BTC: 72000,
      ETH: 3500,
      BNB: 650,
      USDT: 1.00,
      USDC: 1.00,
      ADA: 0.45,
      SOL: 180,
      DOT: 6.80,
      LINK: 18.50,
      UNI: 8.90,
      TRON: 0.35
    };

    // Real-time conversion cache
    this.rateCache = {};
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes

    // API endpoints for real-time rates
    this.fiatApiUrl = 'https://api.exchangerate-api.com/v4/latest/USD';
    this.cryptoApiUrl = 'https://api.coingecko.com/api/v3/simple/price';
    
    // Supported currencies for real-time conversion
    this.fiatCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'BRL', 'ZAR', 'AED'];
    this.cryptoCurrencies = ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'LINK', 'UNI'];
    
    // Supported tokens by network
    this.tokensByNetwork = {
      1: ['ETH', 'USDT'],      // Ethereum: ETH, USDT
      56: ['BNB', 'USDT'],     // BSC: BNB, USDT
      195: ['TRON', 'USDT']    // TRON: TRX, USDT
    };
    
    // USDT contract addresses by chain
    this.usdtAddresses = {
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',   // Ethereum USDT
      56: '0x55d398326f99059fF775485246999027B3197955',  // BSC USDT
      195: 'TR7NHqjeKQxGTCi8q282KGLP235aKxaxS8'           // TRON USDT
    };
    
    this.walletConnected = false;
    this.paymentInProgress = false;

    // AL-MUDIR Treasury settings
    this.treasuryUSDTAddress = {
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      56: '0x55d398326f99059fF775485246999027B3197955',
      195: 'TR7NHqjeKQxGTCi8q282KGLP235aKxaxS8'
    };

    this.treasuryNativeAddress = {
      1: '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
      56: '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
      195: 'TLNNQNDsH6JG9dxd99Tqfkb8eSPRUyhC4E'
    };

    // Treasury addresses for deposits
    this.treasuryAddresses = {
      BTC: 'bc1qfe8kjaau2n2ggknmx6a8gclzwc9xz3zpj0lcsp',
      USDT_ERC20: '0x3b8BAdeCEbB98258F27405a8Dff37e2308AB6E20',
      USDT_TRC20: 'TLNNQNDsH6JG9dxd99Tqfkb8eSPRUyhC4E'
    };

    this.serviceFeeUSD = 5.00;

    // Gift card catalog (in USD)
    this.allowedGiftCards = {
      'ALMUDIR-GIFT-50': 50,
      'ALMUDIR-GIFT-100': 100,
      'ALMUDIR-GIFT-250': 250
    };
  }

  /**
   * Initialize Web3 instance - Trust Wallet or MetaMask
   */
  async initWeb3() {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('No crypto wallet detected. Please install Trust Wallet or MetaMask.');
    }
    
    this.web3Instance = window.ethereum;
    return this.web3Instance;
  }

  /**
   * Connect wallet - Trust Wallet via WalletConnect or MetaMask
   */
  async connectWallet(walletType = 'trustwallet') {
    try {
      const provider = await this.getProvider(walletType);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      
      this.userAccount = accounts[0];
      this.walletConnected = true;
      
      // Get chainId
      const chainId = await provider.request({ method: 'eth_chainId' });
      this.chainId = parseInt(chainId, 16);
      
      // Validate chain is supported
      if (!this.supportedChains[this.chainId]) {
        throw new Error(`Chain ID ${this.chainId} not supported. Please switch to Ethereum, BSC, or TRON.`);
      }
      
      return {
        account: this.userAccount,
        chain: this.chainId,
        chainName: this.supportedChains[this.chainId].name
      };
    } catch (error) {
      console.error('Wallet connection failed:', error);
      throw error;
    }
  }

  /**
   * Get provider based on wallet type
   */
  async getProvider(walletType) {
    // Trust Wallet uses window.ethereum just like MetaMask
    // Both are compatible with EVM chains
    if ((walletType === 'trustwallet' || walletType === 'metamask') && window.ethereum) {
      return window.ethereum;
    }
    throw new Error('Trust Wallet or MetaMask not detected. Please install one of these wallets.');
  }

  /**
   * Process cryptocurrency payment
   * @param {Object} paymentDetails - { amount, currency, recipientAddress }
   */
  async processPayment(paymentDetails) {
    if (!this.walletConnected) {
      throw new Error('Wallet not connected');
    }

    const { amount, currency, recipientAddress, description } = paymentDetails;

    if (this.paymentInProgress) {
      throw new Error('Payment already in progress');
    }

    this.paymentInProgress = true;

    try {
      // Convert amount to wei for ERC20 or native tokens
      const chainData = this.supportedChains[this.chainId];
      
      // Create transaction based on currency
      let txPayload = await this.buildTransactionPayload(
        amount,
        currency,
        recipientAddress,
        description
      );

      // Sign and send transaction
      const txHash = await this.web3Instance.request({
        method: 'eth_sendTransaction',
        params: [txPayload]
      });

      return {
        transactionHash: txHash,
        amount: amount,
        currency: currency,
        recipientAddress: recipientAddress,
        chainId: this.chainId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Payment processing failed:', error);
      throw error;
    } finally {
      this.paymentInProgress = false;
    }
  }

  /**
   * Build transaction payload
   */
  async buildTransactionPayload(amount, currency, recipientAddress, description) {
    const gasPrice = await this.getGasPrice();
    
    // Convert amount to proper denomination
    let valueInWei = this.toWei(amount, currency);

    return {
      from: this.userAccount,
      to: recipientAddress || '0x7Kef1234567890abcdefghijklmnopqrstuvwxyz', // AL-MUDIR treasury
      value: valueInWei,
      gas: '21000',
      gasPrice: gasPrice,
      data: this.encodePaymentData(description)
    };
  }

  /**
   * Get current gas price
   */
  async getGasPrice() {
    const gasPrice = await this.web3Instance.request({
      method: 'eth_gasPrice'
    });
    return gasPrice;
  }

  /**
   * Convert amount to wei based on currency
   */
  toWei(amount, currency) {
    const decimals = {
      ETH: 18,
      USDC: 6,
      USDT: 6,
      MATIC: 18,
      BNB: 18
    };

    const decimalPlaces = decimals[currency] || 18;
    const multiplier = Math.pow(10, decimalPlaces);
    return (amount * multiplier).toFixed(0);
  }

  /**
   * Encode payment description for on-chain data
   */
  encodePaymentData(description) {
    if (!description) return '0x';
    
    // Browser-compatible UTF-8 to hex encoding
    let hexStr = '';
    for (let i = 0; i < description.length; i++) {
      hexStr += description.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return '0x' + hexStr.substring(0, 128);
  }

  /**
   * Verify transaction on-chain
   */
  async verifyTransaction(txHash) {
    try {
      const receipt = await this.web3Instance.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      });

      return {
        confirmed: receipt && receipt.status === '0x1',
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Transaction verification failed:', error);
      throw error;
    }
  }

  /**
   * Calculate payment in USD
   */
  calculateUSD(amount, currency) {
    const rate = this.paymentRates[currency] || 0;
    return amount * rate;
  }

  /**
   * Fetch real-time fiat currency rates from ExchangeRate-API
   */
  async fetchFiatRates() {
    try {
      const response = await fetch(this.fiatApiUrl);
      const data = await response.json();

      if (data && data.rates) {
        // Inject USD base if missing
        data.rates.USD = data.rates.USD || 1;

        this.rateCache.fiat = {
          rates: data.rates,
          timestamp: Date.now()
        };
        return data.rates;
      }
      throw new Error('Invalid fiat rates response');
    } catch (error) {
      console.error('Failed to fetch fiat rates:', error);
      return null;
    }
  }

  /**
   * Fetch real-time cryptocurrency rates from CoinGecko
   */
  async fetchCryptoRates() {
    try {
      const cryptoIds = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        BNB: 'binancecoin',
        ADA: 'cardano',
        SOL: 'solana',
        DOT: 'polkadot',
        LINK: 'chainlink',
        UNI: 'uniswap'
      };

      const ids = Object.values(cryptoIds).join(',');
      const response = await fetch(`${this.cryptoApiUrl}?ids=${ids}&vs_currencies=usd`);
      const data = await response.json();

      if (data) {
        const rates = {};

        Object.entries(cryptoIds).forEach(([code, id]) => {
          if (data[id] && typeof data[id].usd === 'number') {
            rates[code] = data[id].usd;
          }
        });

        this.rateCache.crypto = {
          rates,
          timestamp: Date.now()
        };
        return rates;
      }
      throw new Error('Invalid crypto rates response');
    } catch (error) {
      console.error('Failed to fetch crypto rates:', error);
      return null;
    }
  }

  /**
   * Get cached rate or fetch new one if expired
   */
  async getRate(currency) {
    const upperCurrency = (currency || '').toUpperCase();

    if (upperCurrency === 'USD') {
      return 1;
    }

    const now = Date.now();

    if (this.fiatCurrencies.includes(upperCurrency)) {
      let rates = this.rateCache.fiat?.rates;

      if (!rates || (now - this.rateCache.fiat.timestamp) > this.cacheExpiry) {
        rates = await this.fetchFiatRates();
      }

      const fiatRate = rates?.[upperCurrency];
      if (fiatRate) {
        console.debug('fiat rate', upperCurrency, fiatRate);
        return fiatRate;
      }

      console.warn(`Fiat rate not found for ${upperCurrency}, falling back to static`);
      return this.paymentRates[upperCurrency] || 1;
    }

    if (this.cryptoCurrencies.includes(upperCurrency)) {
      let rates = this.rateCache.crypto?.rates;

      if (!rates || (now - this.rateCache.crypto.timestamp) > this.cacheExpiry) {
        rates = await this.fetchCryptoRates();
      }

      const cryptoRate = rates?.[upperCurrency];
      if (cryptoRate) {
        console.debug('crypto rate', upperCurrency, cryptoRate);
        return cryptoRate;
      }

      console.warn(`Crypto rate not found for ${upperCurrency}, falling back to static`);
      return this.paymentRates[upperCurrency] || 1;
    }

    console.warn(`Currency ${upperCurrency} not in fiat or crypto list, falling back to static`);
    return this.paymentRates[upperCurrency] || 1;
  }

  /**
   * Convert amount from one currency to another with real-time rates
   */
  async convertCurrency(amount, fromCurrency, toCurrency) {
    try {
      const fromCode = (fromCurrency || '').toUpperCase();
      const toCode = (toCurrency || '').toUpperCase();

      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }

      if (fromCode === toCode) {
        return amount;
      }

      const [fromRate, toRate] = await Promise.all([
        this.getRate(fromCode),
        this.getRate(toCode)
      ]);

      if (!fromRate || !toRate) {
        throw new Error('Rate lookup failed');
      }

      const usdAmount = amount / fromRate;
      const convertedAmount = usdAmount * toRate;

      return convertedAmount;
    } catch (error) {
      console.error('Currency conversion failed:', error);
      const fromRate = this.paymentRates[fromCurrency] || 1;
      const toRate = this.paymentRates[toCurrency] || 1;
      return (amount * fromRate) / toRate;
    }
  }

  /**
   * Convert any supported currency amount to the equivalent USDT amount
   */
  convertToUSDT(amount, currency) {
    const rate = this.paymentRates[currency] || 0;
    if (rate <= 0) {
      throw new Error('Currency conversion not supported');
    }
    const usdValue = this.calculateUSD(amount, currency);
    return usdValue / this.paymentRates.USDT;
  }

  /**
   * Process a card payment (simulated) and then convert to USDT and send to treasury
   */
  async processCardPayment(paymentDetails) {
    const { usdAmount, cardLast4 } = paymentDetails;

    if (usdAmount < this.serviceFeeUSD) {
      throw new Error(`Minimum service fee is $${this.serviceFeeUSD.toFixed(2)} USD`);
    }

    // Payment processing must be done by a PCI-compliant backend in production.
    // This client-side stub simulates successful card authorization.
    const txReference = `CARD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Simulate USDT conversion and send. Here we only return values to be confirmed by backend.
    const usdtAmount = usdAmount / this.paymentRates.USDT;

    return {
      status: 'authorized',
      txReference,
      cardLast4,
      usdAmount,
      usdtAmount,
      recipient: this.treasuryUSDTAddress[this.chainId] || this.treasuryUSDTAddress[1],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate a gift card code and return its USD amount
   */
  validateGiftCard(code) {
    const normalized = String(code).trim().toUpperCase();
    if (this.allowedGiftCards[normalized]) {
      return this.allowedGiftCards[normalized];
    }
    throw new Error('Invalid gift card code');
  }

  /**
   * Get supported chain info
   */
  getChainInfo(chainId) {
    return this.supportedChains[chainId];
  }

  /**
   * Switch network
   */
  async switchNetwork(chainId) {
    try {
      await this.web3Instance.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + chainId.toString(16) }]
      });
      this.chainId = chainId;
      return true;
    } catch (error) {
      if (error.code === 4902) {
        // Chain not added to wallet, need to add it
        return await this.addNetwork(chainId);
      }
      throw error;
    }
  }

  /**
   * Add network to wallet
   */
  async addNetwork(chainId) {
    const chain = this.supportedChains[chainId];
    if (!chain) throw new Error('Chain not supported');

    try {
      await this.web3Instance.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: '0x' + chainId.toString(16),
            chainName: chain.name,
            rpcUrls: [chain.rpc],
            nativeCurrency: {
              name: chain.name,
              symbol: chain.symbol,
              decimals: 18
            }
          }
        ]
      });
      return true;
    } catch (error) {
      console.error('Failed to add network:', error);
      throw error;
    }
  }

  /**
   * Disconnect wallet
   */
  disconnectWallet() {
    this.userAccount = null;
    this.walletConnected = false;
    this.web3Instance = null;
    console.log('Wallet disconnected');
  }

  /**
   * Get wallet balance
   */
  async getBalance() {
    if (!this.walletConnected) {
      throw new Error('Wallet not connected');
    }

    try {
      const balance = await this.web3Instance.request({
        method: 'eth_getBalance',
        params: [this.userAccount, 'latest']
      });

      return (parseInt(balance, 16) / Math.pow(10, 18)).toFixed(4);
    } catch (error) {
      console.error('Failed to get balance:', error);
      throw error;
    }
  }

  /**
   * Fetch real-time fiat currency rates from ExchangeRate-API
   */
  async fetchFiatRates() {
    try {
      const response = await fetch(this.fiatApiUrl);
      const data = await response.json();

      if (data.rates) {
        // Cache the rates
        this.rateCache.fiat = {
          rates: data.rates,
          timestamp: Date.now()
        };
        return data.rates;
      }
      throw new Error('Invalid fiat rates response');
    } catch (error) {
      console.error('Failed to fetch fiat rates:', error);
      return null;
    }
  }

  /**
   * Fetch real-time cryptocurrency rates from CoinGecko
   */
  async fetchCryptoRates() {
    try {
      const cryptoIds = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        BNB: 'binancecoin',
        ADA: 'cardano',
        SOL: 'solana',
        DOT: 'polkadot',
        LINK: 'chainlink',
        UNI: 'uniswap'
      };

      const ids = Object.values(cryptoIds).join(',');
      const response = await fetch(`${this.cryptoApiUrl}?ids=${ids}&vs_currencies=usd`);
      const data = await response.json();

      if (data) {
        // Convert back to our currency codes and cache
        const rates = {};
        Object.entries(cryptoIds).forEach(([code, id]) => {
          if (data[id] && data[id].usd) {
            rates[code] = data[id].usd;
          }
        });

        this.rateCache.crypto = {
          rates: rates,
          timestamp: Date.now()
        };
        return rates;
      }
      throw new Error('Invalid crypto rates response');
    } catch (error) {
      console.error('Failed to fetch crypto rates:', error);
      return null;
    }
  }

  /**
   * Get cached rate or fetch new one if expired
   */
  async getRate(currency) {
    const now = Date.now();
    let rates;

    if (this.fiatCurrencies.includes(currency)) {
      // Fiat currency
      if (!this.rateCache.fiat || (now - this.rateCache.fiat.timestamp) > this.cacheExpiry) {
        rates = await this.fetchFiatRates();
      } else {
        rates = this.rateCache.fiat.rates;
      }

      if (rates && rates[currency]) {
        return rates[currency];
      }
    } else if (this.cryptoCurrencies.includes(currency)) {
      // Cryptocurrency
      if (!this.rateCache.crypto || (now - this.rateCache.crypto.timestamp) > this.cacheExpiry) {
        rates = await this.fetchCryptoRates();
      } else {
        rates = this.rateCache.crypto.rates;
      }

      if (rates && rates[currency]) {
        return rates[currency];
      }
    }

    // Fallback to static rates
    return this.paymentRates[currency] || 1;
  }

  /**
   * Convert amount from one currency to another with real-time rates
   */
  async convertCurrency(amount, fromCurrency, toCurrency) {
    try {
      if (fromCurrency === toCurrency) {
        return amount;
      }

      // Get real-time rates
      const [fromRate, toRate] = await Promise.all([
        this.getRate(fromCurrency),
        this.getRate(toCurrency)
      ]);

      // Convert through USD as base
      const usdAmount = amount / fromRate;
      const convertedAmount = usdAmount * toRate;

      return convertedAmount;
    } catch (error) {
      console.error('Currency conversion failed:', error);
      // Fallback to static rates
      const fromRate = this.paymentRates[fromCurrency] || 1;
      const toRate = this.paymentRates[toCurrency] || 1;
      return (amount * fromRate) / toRate;
    }
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoPaymentManager;
}

// Also expose globally in browsers
if (typeof window !== 'undefined') {
  window.CryptoPaymentManager = CryptoPaymentManager;
}
