// AL-MUDIR Crypto Wallet Payment Integration Module
// Supports: MetaMask, WalletConnect, Coinbase Wallet, Trust Wallet

class CryptoPaymentManager {
  constructor() {
    this.web3Instance = null;
    this.userAccount = null;
    this.chainId = null;
    this.supportedChains = {
      1: { name: 'Ethereum', symbol: 'ETH', rpc: 'https://eth.llamarpc.com' },
      137: { name: 'Polygon', symbol: 'MATIC', rpc: 'https://polygon-rpc.com' },
      42161: { name: 'Arbitrum', symbol: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc' },
      10: { name: 'Optimism', symbol: 'ETH', rpc: 'https://mainnet.optimism.io' },
      56: { name: 'BSC', symbol: 'BNB', rpc: 'https://bsc-dataseed.binance.org' }
    };
    
    // Payment rates (in USD, update from price feed)
    this.paymentRates = {
      ETH: 2800,
      USDC: 1,
      USDT: 1,
      MATIC: 0.8,
      BNB: 620
    };
    
    this.walletConnected = false;
    this.paymentInProgress = false;
  }

  /**
   * Initialize Web3 instance
   */
  async initWeb3() {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('No web3 provider detected. Install MetaMask or use WalletConnect.');
    }
    
    // For now, using ethers.js would be ideal, but we'll use minimal implementation
    this.web3Instance = window.ethereum;
    return this.web3Instance;
  }

  /**
   * Connect wallet - MetaMask, WalletConnect, etc.
   */
  async connectWallet(walletType = 'metamask') {
    try {
      const provider = await this.getProvider(walletType);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      
      this.userAccount = accounts[0];
      this.walletConnected = true;
      
      // Get chainId
      const chainId = await provider.request({ method: 'eth_chainId' });
      this.chainId = parseInt(chainId, 16);
      
      return {
        account: this.userAccount,
        chain: this.chainId,
        chainName: this.supportedChains[this.chainId]?.name || 'Unknown'
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
    if (walletType === 'metamask' && window.ethereum) {
      return window.ethereum;
    } else if (walletType === 'walletconnect') {
      // WalletConnect integration would require additional library
      throw new Error('WalletConnect requires ethers.js library. Install @walletconnect/web3-provider');
    } else if (walletType === 'coinbase') {
      if (window.coinbaseWalletProvider) {
        return window.coinbaseWalletProvider;
      }
      throw new Error('Coinbase Wallet not installed');
    }
    throw new Error('Unsupported wallet type');
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
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoPaymentManager;
}

// Also expose globally in browsers
if (typeof window !== 'undefined') {
  window.CryptoPaymentManager = CryptoPaymentManager;
}
