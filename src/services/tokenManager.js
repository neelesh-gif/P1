const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const config = require('../config');

class TokenManager {
  constructor() {
    this.adminToken = config.adminKey;
    this.initAdminToken();
  }

  initAdminToken() {
    // Check if admin token exists in DB, if not insert it
    const existing = db.getToken(this.adminToken);
    if (!existing) {
      db.insertToken({
        token: this.adminToken,
        type: 'admin',
        name: 'Master Admin Token',
        maxUses: 0, // unlimited
        expiresAt: null
      });
    }
  }

  /**
   * Generates a new invite token.
   * @param {Object} options
   * @param {string} options.name Optional label for the token (e.g. "Bob's Phone", "Party Room")
   * @param {number} options.maxUses Maximum times token can be used (0 = unlimited, 1 = single use)
   * @param {number|null} options.expiryMinutes Minutes until expiry (0 or null = never expires)
   * @returns {Object} Created token record
   */
  createInviteToken({ name = '', maxUses = 1, expiryMinutes = 60 } = {}) {
    const token = uuidv4();
    const expiresAt = expiryMinutes && expiryMinutes > 0
      ? Date.now() + (expiryMinutes * 60 * 1000)
      : null;

    const record = db.insertToken({
      token,
      type: 'invite',
      name,
      maxUses,
      expiresAt
    });

    db.logAction('TOKEN_CREATED', `Token: ${token.substring(0, 8)}..., MaxUses: ${maxUses}, ExpiryMin: ${expiryMinutes}`);
    return record;
  }

  /**
   * Validates whether a token is valid, unrevoked, and unexpired.
   * @param {string} token
   * @param {string} expectedType 'admin' or 'invite' or null for any
   * @returns {{ valid: boolean, reason?: string, tokenData?: Object }}
   */
  validateToken(token, expectedType = null) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'Token parameter is missing' };
    }

    const trimmed = token.trim();

    // Check if it's the admin token
    if (trimmed === this.adminToken) {
      if (expectedType && expectedType !== 'admin') {
        return { valid: false, reason: 'Admin token cannot be used for friend invites' };
      }
      return {
        valid: true,
        tokenData: {
          token: this.adminToken,
          type: 'admin',
          name: 'Master Admin',
          maxUses: 0,
          usedCount: 0,
          expiresAt: null
        }
      };
    }

    const tokenRecord = db.getToken(trimmed);
    if (!tokenRecord) {
      return { valid: false, reason: 'Invite link is invalid or does not exist' };
    }

    if (tokenRecord.revoked) {
      return { valid: false, reason: 'This invite link has been revoked by the host' };
    }

    if (expectedType && tokenRecord.type !== expectedType) {
      return { valid: false, reason: `Token type mismatch (expected ${expectedType})` };
    }

    // Check expiration
    if (tokenRecord.expires_at && Date.now() > tokenRecord.expires_at) {
      return { valid: false, reason: 'This invite link has expired' };
    }

    // Check max uses (0 means unlimited)
    if (tokenRecord.max_uses > 0 && tokenRecord.used_count >= tokenRecord.max_uses) {
      return { valid: false, reason: 'This invite link has reached its maximum number of uses' };
    }

    return {
      valid: true,
      tokenData: {
        id: tokenRecord.id,
        token: tokenRecord.token,
        type: tokenRecord.type,
        name: tokenRecord.name,
        maxUses: tokenRecord.max_uses,
        usedCount: tokenRecord.used_count,
        createdAt: tokenRecord.created_at,
        expiresAt: tokenRecord.expires_at
      }
    };
  }

  /**
   * Consumes one use of an invite token.
   * Called when a user's join request is approved by the admin.
   */
  consumeToken(token) {
    if (!token || token === this.adminToken) return;
    db.incrementTokenUse(token);
  }

  /**
   * Revokes a specific token.
   */
  revokeToken(token) {
    if (token === this.adminToken) return false;
    db.revokeToken(token);
    db.logAction('TOKEN_REVOKED', `Token: ${token.substring(0, 8)}...`);
    return true;
  }

  /**
   * Lists all tokens for the admin view.
   */
  listTokens() {
    return db.getAllTokens().map(t => ({
      id: t.id,
      token: t.token,
      type: t.type,
      name: t.name,
      maxUses: t.max_uses,
      usedCount: t.used_count,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      revoked: !!t.revoked,
      isExpired: t.expires_at ? Date.now() > t.expires_at : false,
      isExhausted: t.max_uses > 0 && t.used_count >= t.max_uses
    }));
  }

  /**
   * Purges all friend invite tokens.
   */
  purgeInviteTokens() {
    db.purgeTokens(true);
    db.logAction('TOKENS_PURGED', 'All friend invite tokens were purged');
  }

  /**
   * Verifies if an admin key matches.
   */
  verifyAdminKey(key) {
    if (!key || typeof key !== 'string') return false;
    return key.trim() === this.adminToken;
  }
}

const tokenManager = new TokenManager();
module.exports = tokenManager;
