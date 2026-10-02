const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const tokenManager = require('../services/tokenManager');
const banManager = require('../services/banManager');
const db = require('../db/database');
const { getNetworkInfo } = require('../network');

const router = express.Router();

// Ensure upload folder exists
if (!fs.existsSync(config.paths.uploads)) {
  fs.mkdirSync(config.paths.uploads, { recursive: true });
}

// Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.paths.uploads);
  },
  filename: (req, file, cb) => {
    const randomHex = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 30);
    cb(null, `${Date.now()}-${randomHex}-${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024 // e.g. 10MB
  }
});

// Admin authentication middleware for API
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const queryKey = req.query.key || req.headers['x-admin-key'];
  let key = queryKey;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.substring(7);
  }

  if (!tokenManager.verifyAdminKey(key)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Key' });
  }
  next();
}

/**
 * Upload file endpoint (capped at 10MB).
 * Accepts file upload and returns metadata for chat broadcast.
 */
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File exceeds maximum allowed size of ${config.maxFileSizeMb}MB`
        });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: `Upload failed: ${err.message}` });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file was provided' });
    }

    const fileMeta = {
      url: `/uploads/${req.file.filename}`,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    };

    return res.json({
      success: true,
      file: fileMeta
    });
  });
});

/**
 * Verify a token before user submits join form.
 */
router.get('/tokens/verify', (req, res) => {
  const token = req.query.token;
  const result = tokenManager.validateToken(token, 'invite');
  if (!result.valid) {
    return res.status(400).json({ valid: false, reason: result.reason });
  }
  return res.json({
    valid: true,
    tokenData: {
      name: result.tokenData.name,
      expiresAt: result.tokenData.expiresAt
    }
  });
});

/**
 * Verify admin key validity.
 */
router.post('/admin/verify', (req, res) => {
  const { key } = req.body;
  if (tokenManager.verifyAdminKey(key)) {
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid admin key' });
});

/**
 * Admin: Generate invite token.
 */
router.post('/admin/tokens/create', requireAdminAuth, (req, res) => {
  const { name, maxUses, expiryMinutes } = req.body;
  const tokenRecord = tokenManager.createInviteToken({
    name: name || '',
    maxUses: parseInt(maxUses || '1', 10),
    expiryMinutes: expiryMinutes !== undefined ? parseInt(expiryMinutes, 10) : 60
  });

  const netInfo = getNetworkInfo();
  const joinUrl = `http://${netInfo.primaryIp}:${config.port}/join?token=${tokenRecord.token}`;

  return res.json({
    success: true,
    token: tokenRecord,
    joinUrl,
    lanIp: netInfo.primaryIp
  });
});

/**
 * Admin: List all tokens.
 */
router.get('/admin/tokens', requireAdminAuth, (req, res) => {
  const tokens = tokenManager.listTokens();
  const netInfo = getNetworkInfo();
  return res.json({
    tokens,
    lanIp: netInfo.primaryIp,
    port: config.port
  });
});

/**
 * Admin: Revoke a token.
 */
router.post('/admin/tokens/revoke', requireAdminAuth, (req, res) => {
  const { token } = req.body;
  const success = tokenManager.revokeToken(token);
  return res.json({ success });
});

/**
 * Admin: List all bans.
 */
router.get('/admin/bans', requireAdminAuth, (req, res) => {
  const bans = banManager.getAll();
  return res.json({ bans });
});

/**
 * Admin: Unban an IP.
 */
router.post('/admin/bans/remove', requireAdminAuth, (req, res) => {
  const { ip } = req.body;
  const success = banManager.unban(ip);
  return res.json({ success });
});

/**
 * Admin: Purge chat room messages, uploads, and tokens.
 */
router.post('/admin/purge', requireAdminAuth, (req, res) => {
  db.purgeAll();

  // Wipe uploads folder
  try {
    if (fs.existsSync(config.paths.uploads)) {
      const files = fs.readdirSync(config.paths.uploads);
      for (const file of files) {
        fs.unlinkSync(path.join(config.paths.uploads, file));
      }
    }
  } catch (e) {
    console.error('Error clearing uploads during purge:', e);
  }

  return res.json({ success: true, message: 'All messages, uploads, and invite tokens purged' });
});

/**
 * Get server & network info.
 */
router.get('/system/info', (req, res) => {
  const net = getNetworkInfo();
  return res.json({
    primaryIp: net.primaryIp,
    allIps: net.allIps,
    port: config.port,
    maxFileSizeMb: config.maxFileSizeMb
  });
});

module.exports = router;
