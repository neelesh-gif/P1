const db = require('../db/database');

class BanManager {
  constructor() {
    this.bannedSet = new Set();
    this.loadBans();
  }

  loadBans() {
    try {
      const bans = db.getAllBans();
      this.bannedSet.clear();
      for (const ban of bans) {
        this.bannedSet.add(this.cleanIp(ban.ip));
      }
    } catch (e) {
      console.error('Error loading bans:', e);
    }
  }

  /**
   * Normalizes IP strings from Express or Socket.io.
   * Strips IPv6 prefix for IPv4-mapped addresses (::ffff:192.168.1.1 -> 192.168.1.1).
   */
  cleanIp(ip) {
    if (!ip) return '';
    let cleaned = ip.trim();
    if (cleaned.startsWith('::ffff:')) {
      cleaned = cleaned.substring(7);
    }
    if (cleaned === '::1') {
      cleaned = '127.0.0.1';
    }
    return cleaned;
  }

  isBanned(rawIp) {
    const ip = this.cleanIp(rawIp);
    if (!ip) return false;
    return this.bannedSet.has(ip) || db.isBanned(ip);
  }

  ban(rawIp, reason = 'Banned by Admin', bannedBy = 'Admin') {
    const ip = this.cleanIp(rawIp);
    if (!ip) return false;

    this.bannedSet.add(ip);
    db.addBan(ip, reason, bannedBy);
    db.logAction('IP_BANNED', `IP: ${ip}, Reason: ${reason}`, ip);
    return true;
  }

  unban(rawIp) {
    const ip = this.cleanIp(rawIp);
    if (!ip) return false;

    this.bannedSet.delete(ip);
    db.removeBan(ip);
    db.logAction('IP_UNBANNED', `IP: ${ip}`, ip);
    return true;
  }

  getAll() {
    return db.getAllBans();
  }

  /**
   * Express middleware to block banned IPs.
   */
  middleware() {
    return (req, res, next) => {
      const clientIp = this.cleanIp(
        req.headers['x-forwarded-for']?.split(',')[0] ||
        req.socket.remoteAddress ||
        req.ip
      );

      if (this.isBanned(clientIp)) {
        return res.status(403).send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Access Denied - LocalChat</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #111827; border: 1px solid #ef4444; border-radius: 12px; padding: 32px; max-width: 450px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
              h1 { margin-top: 0; font-size: 1.5rem; color: #f87171; }
              p { color: #9ca3af; line-height: 1.5; font-size: 0.95rem; }
              .ip-badge { display: inline-block; background: #1f2937; padding: 4px 10px; border-radius: 6px; font-family: monospace; color: #e5e7eb; margin-top: 10px; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Access Restricted</h1>
              <p>Your local IP address has been banned by the host administrator.</p>
              <div class="ip-badge">IP: ${clientIp}</div>
            </div>
          </body>
          </html>
        `);
      }
      next();
    };
  }
}

const banManager = new BanManager();
module.exports = banManager;
