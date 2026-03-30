'use strict';
/**
 * AL-MUDIR PROFESSIONAL TREASURY ENGINE
 * ──────────────────────────────────────────────────────────
 * Hardcoded Master Wallet: TLNNQNDsH6JG9dxd99Tqfkb8eSPRUyhC4E
 * Network: TRON (TRC-20)
 * Asset: USDT
 *
 * All revenue, fees, and bot activation payments are routed
 * to this master wallet. No configuration overrides allowed.
 * ──────────────────────────────────────────────────────────
 */

const MASTER_TREASURY = 'TLNNQNDsH6JG9dxd99Tqfkb8eSPRUyhC4E';
const BOT_ACTIVATION_USDT = 399.00;
const SYSTEM_PERFORMANCE_FEE = 0.10; // 10% PRO LEVEL
const REQUIRED_CONFIRMATIONS = 19;

const RevenueEngine = {
  /** Master TRC-20 treasury address — immutable */
  MASTER_TREASURY,

  /** Bot activation price in USDT */
  BOT_ACTIVATION_USDT,

  /** System performance fee rate (10%) */
  SYSTEM_PERFORMANCE_FEE,

  /** Required TRC-20 confirmations */
  REQUIRED_CONFIRMATIONS,

  /**
   * Validate TRC-20 address format
   * @param {string} addr - Address to validate
   * @returns {boolean}
   */
  isValidTRC20: (addr) => /^T[A-Za-z1-9]{33}$/.test(addr),

  /**
   * Calculate the 10% system cut from bot trading profits
   * @param {number} profitUSD - Gross profit in USD
   * @returns {string} System cut formatted to 2 decimals
   */
  calculateSystemCut: (profitUSD) => {
    return profitUSD > 0 ? (profitUSD * SYSTEM_PERFORMANCE_FEE).toFixed(2) : '0.00';
  },

  /**
   * Generate payment details for bot activation
   * @returns {object} Payment instruction object
   */
  getPaymentDetails: () => ({
    wallet: MASTER_TREASURY,
    network: 'TRON (TRC-20)',
    asset: 'USDT',
    amount: BOT_ACTIVATION_USDT,
    confirmations_required: REQUIRED_CONFIRMATIONS
  }),

  /**
   * Verify a TRC-20 transaction against TronGrid
   * @param {string} txHash - Transaction hash to verify
   * @param {number} expectedAmount - Expected USDT amount
   * @returns {Promise<object>} Verification result
   */
  verifyTRC20Transaction: async (txHash, expectedAmount) => {
    if (!txHash || txHash.length < 60) {
      return { verified: false, error: 'invalid_tx_hash' };
    }
    try {
      const axios = require('axios');
      const url = 'https://api.trongrid.io/v1/transactions/' + txHash;
      const resp = await axios.get(url, { timeout: 10000 });
      const data = resp.data;

      if (!data || !data.ret || !Array.isArray(data.ret) || data.ret[0].contractRet !== 'SUCCESS') {
        return { verified: false, error: 'transaction_failed' };
      }

      // Check confirmations
      const info = await axios.get('https://api.trongrid.io/v1/transactions/' + txHash + '/info', { timeout: 10000 });
      const confirmations = info.data && info.data.confirmations ? info.data.confirmations : 0;

      if (confirmations < REQUIRED_CONFIRMATIONS) {
        return {
          verified: false,
          error: 'insufficient_confirmations',
          confirmations,
          required: REQUIRED_CONFIRMATIONS
        };
      }

      return {
        verified: true,
        txHash,
        confirmations,
        timestamp: data.raw_data && data.raw_data.timestamp ? new Date(data.raw_data.timestamp).toISOString() : null
      };
    } catch (err) {
      return { verified: false, error: 'trongrid_error', detail: err.message };
    }
  },

  /**
   * Log sweep operation to master treasury
   * @param {number} amount - USDT amount being swept
   * @param {string} source - Source description
   * @returns {object} Sweep record
   */
  createSweepRecord: (amount, source) => {
    return {
      destination: MASTER_TREASURY,
      network: 'TRON (TRC-20)',
      asset: 'USDT',
      amount: +Number(amount).toFixed(2),
      source,
      timestamp: new Date().toISOString(),
      status: 'queued'
    };
  }
};

module.exports = { RevenueEngine };
