const express = require('express');
const path = require('path');
const config = require('../config');
const tokenManager = require('../services/tokenManager');

const router = express.Router();

/**
 * Main chat / landing page
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

/**
 * Join route for friends: /join?token=<INVITE_TOKEN>
 */
router.get('/join', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Missing Invite - LocalChat</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0d14; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #111827; border: 1px solid #374151; border-radius: 14px; padding: 36px; max-width: 440px; text-align: center; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
          h1 { color: #818cf8; margin-top: 0; font-size: 1.5rem; }
          p { color: #9ca3af; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Invite Link Required</h1>
          <p>LocalChat is a private LAN chat network. You need a valid invite link from the host to join.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Pre-validate token to give immediate feedback if expired/revoked
  const validation = tokenManager.validateToken(token, 'invite');
  if (!validation.valid) {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invalid Invite - LocalChat</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0d14; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #111827; border: 1px solid #ef4444; border-radius: 14px; padding: 36px; max-width: 440px; text-align: center; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
          h1 { color: #f87171; margin-top: 0; font-size: 1.5rem; }
          p { color: #9ca3af; line-height: 1.5; }
          .reason { background: #1f2937; color: #fb7185; padding: 10px; border-radius: 8px; font-weight: 500; margin: 16px 0; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Invite Link Expired or Invalid</h1>
          <div class="reason">${validation.reason}</div>
          <p>Please ask the host administrator for a fresh invite link to join this room.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Valid token -> Serve client application
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

/**
 * Chat direct route
 */
router.get('/chat', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

/**
 * Admin dashboard route
 */
router.get('/admin', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'admin.html'));
});

module.exports = router;
