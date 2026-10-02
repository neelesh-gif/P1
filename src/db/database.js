const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

class DatabaseManager {
  constructor() {
    this.db = null;
    this.init();
  }

  init() {
    let dbPath = ':memory:';
    if (config.dbMode !== ':memory:') {
      if (!fs.existsSync(config.paths.data)) {
        fs.mkdirSync(config.paths.data, { recursive: true });
      }
      dbPath = path.join(config.paths.data, 'localchat.db');
    }

    this.db = new DatabaseSync(dbPath);
    this.createTables();
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        name TEXT,
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_ip TEXT,
        content TEXT,
        type TEXT DEFAULT 'text',
        attachment TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bans (
        ip TEXT PRIMARY KEY,
        reason TEXT,
        banned_at INTEGER NOT NULL,
        banned_by TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        ip TEXT,
        timestamp INTEGER NOT NULL
      );
    `);
  }

  // --- TOKEN OPERATIONS ---
  insertToken({ token, type, name = '', maxUses = 1, expiresAt = null }) {
    const stmt = this.db.prepare(`
      INSERT INTO tokens (token, type, name, max_uses, used_count, created_at, expires_at, revoked)
      VALUES (?, ?, ?, ?, 0, ?, ?, 0)
    `);
    stmt.run(token, type, name, maxUses, Date.now(), expiresAt);
    return this.getToken(token);
  }

  getToken(token) {
    const stmt = this.db.prepare('SELECT * FROM tokens WHERE token = ?');
    return stmt.get(token);
  }

  incrementTokenUse(token) {
    const stmt = this.db.prepare('UPDATE tokens SET used_count = used_count + 1 WHERE token = ?');
    stmt.run(token);
  }

  revokeToken(token) {
    const stmt = this.db.prepare('UPDATE tokens SET revoked = 1 WHERE token = ?');
    stmt.run(token);
  }

  getAllTokens() {
    const stmt = this.db.prepare('SELECT * FROM tokens ORDER BY created_at DESC');
    return stmt.all();
  }

  purgeTokens(keepAdmin = true) {
    if (keepAdmin) {
      this.db.prepare("DELETE FROM tokens WHERE type != 'admin'").run();
    } else {
      this.db.prepare('DELETE FROM tokens').run();
    }
  }

  // --- MESSAGE OPERATIONS ---
  insertMessage({ id, senderId, senderName, senderIp = '', content = '', type = 'text', attachment = null, timestamp = Date.now() }) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, sender_id, sender_name, sender_ip, content, type, attachment, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const attachmentJson = attachment ? JSON.stringify(attachment) : null;
    stmt.run(id, senderId, senderName, senderIp, content, type, attachmentJson, timestamp);
    return {
      id,
      senderId,
      senderName,
      senderIp,
      content,
      type,
      attachment,
      timestamp
    };
  }

  getRecentMessages(limit = 100) {
    const stmt = this.db.prepare('SELECT * FROM messages ORDER BY timestamp ASC LIMIT ?');
    const rows = stmt.all(limit);
    return rows.map(r => ({
      id: r.id,
      senderId: r.sender_id,
      senderName: r.sender_name,
      senderIp: r.sender_ip,
      content: r.content,
      type: r.type,
      attachment: r.attachment ? JSON.parse(r.attachment) : null,
      timestamp: r.timestamp
    }));
  }

  purgeMessages() {
    this.db.prepare('DELETE FROM messages').run();
  }

  // --- BAN OPERATIONS ---
  addBan(ip, reason = 'Banned by Admin', bannedBy = 'Admin') {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO bans (ip, reason, banned_at, banned_by)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(ip, reason, Date.now(), bannedBy);
  }

  removeBan(ip) {
    const stmt = this.db.prepare('DELETE FROM bans WHERE ip = ?');
    stmt.run(ip);
  }

  isBanned(ip) {
    if (!ip) return false;
    const stmt = this.db.prepare('SELECT ip FROM bans WHERE ip = ?');
    return !!stmt.get(ip);
  }

  getAllBans() {
    const stmt = this.db.prepare('SELECT * FROM bans ORDER BY banned_at DESC');
    return stmt.all();
  }

  // --- AUDIT LOG ---
  logAction(action, details = '', ip = '') {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (action, details, ip, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(action, details, ip, Date.now());
  }

  getAuditLogs(limit = 50) {
    const stmt = this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit);
  }

  purgeAll() {
    this.purgeMessages();
    this.purgeTokens(true);
    this.db.prepare('DELETE FROM audit_log').run();
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        // ignore if already closed
      }
      this.db = null;
    }
  }
}

// Singleton database instance
const dbManager = new DatabaseManager();
module.exports = dbManager;
