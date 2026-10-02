/**
 * Automated End-to-End & Unit Verification Suite for LocalChat
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { io: ClientSocket } = require('socket.io-client');

const config = require('../src/config');
const { getNetworkInfo } = require('../src/network');
const db = require('../src/db/database');
const tokenManager = require('../src/services/tokenManager');
const banManager = require('../src/services/banManager');
const { escapeHtml, sanitizeNickname, parseDeviceAgent } = require('../src/utils/sanitize');

async function runAllTests() {
  console.log('\n======================================================');
  console.log('       RUNNING LOCALCHAT AUTOMATED TEST SUITE        ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // 1. Network Discovery Test
  await test('Network IP Detection: returns non-internal IPv4', () => {
    const net = getNetworkInfo();
    assert(net.primaryIp, 'Primary IP should exist');
    assert(typeof net.primaryIp === 'string', 'Primary IP should be string');
    assert(net.primaryIp.includes('.'), 'Primary IP should be IPv4');
    console.log(`         Detected Primary LAN IP: ${net.primaryIp}`);
  });

  // 2. Sanitization Utilities
  await test('Sanitization: escapes HTML & trims nicknames', () => {
    const dangerous = '<script>alert("xss")</script>&foo="bar"';
    const clean = escapeHtml(dangerous);
    assert(!clean.includes('<script>'), 'Should escape HTML tags');
    assert(clean.includes('&lt;script&gt;'), 'Should encode angle brackets');

    const longNick = '   SuperLongNicknameThatShouldBeTruncatedExceedingLimits   ';
    const nick = sanitizeNickname(longNick);
    assert(nick.length <= 24, 'Nickname should be truncated to 24 chars');
    assert(!nick.startsWith(' '), 'Nickname should be trimmed');
  });

  // 3. Token Lifecycle & Expiration
  await test('TokenManager: full token lifecycle (create, use, exhaust, expire)', () => {
    // Single-use token
    const token1 = tokenManager.createInviteToken({ name: 'Test Token', maxUses: 1, expiryMinutes: 60 });
    assert(token1.token, 'Token string should be generated');

    const check1 = tokenManager.validateToken(token1.token, 'invite');
    assert(check1.valid, 'Newly created token should be valid');

    // Consume token
    tokenManager.consumeToken(token1.token);
    const check2 = tokenManager.validateToken(token1.token, 'invite');
    assert(!check2.valid, 'Exhausted token should be invalid');
    assert(check2.reason.includes('maximum number of uses'), 'Reason should specify max uses');

    // Expired token (simulate negative expiry)
    const expiredToken = db.insertToken({
      token: 'expired-test-uuid',
      type: 'invite',
      name: 'Expired',
      maxUses: 10,
      expiresAt: Date.now() - 10000 // already in the past
    });
    const check3 = tokenManager.validateToken(expiredToken.token, 'invite');
    assert(!check3.valid, 'Past token should be invalid');
    assert(check3.reason.includes('expired'), 'Reason should specify expired');

    // Revocation
    const tokenToRevoke = tokenManager.createInviteToken({ name: 'To Revoke', maxUses: 5 });
    tokenManager.revokeToken(tokenToRevoke.token);
    const checkRevoked = tokenManager.validateToken(tokenToRevoke.token, 'invite');
    assert(!checkRevoked.valid, 'Revoked token should be invalid');
    assert(checkRevoked.reason.includes('revoked'), 'Reason should specify revoked');
  });

  // 4. BanManager Blacklisting
  await test('BanManager: IP normalization & blacklist enforcement', () => {
    const testIp = '192.168.1.99';
    assert(!banManager.isBanned(testIp), 'IP should not be banned initially');

    banManager.ban(testIp, 'Testing ban system');
    assert(banManager.isBanned(testIp), 'IP should now be banned');
    // Test IPv6 mapping normalization
    assert(banManager.isBanned(`::ffff:${testIp}`), 'IPv6 mapped address should also register as banned');

    banManager.unban(testIp);
    assert(!banManager.isBanned(testIp), 'IP should be unbanned');
  });

  // 5. Database Message & Audit Operations
  await test('Database: message insertion & retrieval', () => {
    const testMsgId = 'msg-' + Date.now();
    db.insertMessage({
      id: testMsgId,
      senderId: 'sock-123',
      senderName: 'Tester',
      content: 'Hello World LAN'
    });

    const messages = db.getRecentMessages(50);
    const found = messages.find(m => m.id === testMsgId);
    assert(found, 'Inserted message should be retrievable');
    assert.strictEqual(found.content, 'Hello World LAN');
  });

  // 6. End-to-End Real-Time Socket.io & Gatekeeper Integration
  await test('E2E Socket.io: Gatekeeper approval & messaging pipeline', async () => {
    const { server } = require('../server');
    const testPort = 3199;

    await new Promise((resolve) => {
      server.listen(testPort, '127.0.0.1', resolve);
    });

    try {
      const serverUrl = `http://127.0.0.1:${testPort}`;
      const invite = tokenManager.createInviteToken({ maxUses: 2 });

      // Admin client
      const adminSocket = ClientSocket(serverUrl);
      let adminAuthSuccess = false;
      let joinRequestReceived = false;

      await new Promise((resolve, reject) => {
        adminSocket.on('connect', () => {
          adminSocket.emit('admin:authenticate', { adminKey: config.adminKey });
        });

        adminSocket.on('admin:auth_success', () => {
          adminAuthSuccess = true;
          resolve();
        });

        adminSocket.on('admin:auth_failed', (err) => reject(new Error(err.message)));
        setTimeout(() => reject(new Error('Admin auth timed out')), 3000);
      });

      assert(adminAuthSuccess, 'Admin should authenticate successfully');

      // User client connects
      const userSocket = ClientSocket(serverUrl);
      let userWaiting = false;
      let userApproved = false;
      let messageReceived = false;

      // Listen for join request on admin side
      const joinRequestPromise = new Promise((resolve) => {
        adminSocket.on('admin:join_request', (req) => {
          if (req.nickname === 'Alice') {
            joinRequestReceived = true;
            // Admin approves the user
            adminSocket.emit('admin:approve_user', { socketId: req.socketId });
            resolve();
          }
        });
      });

      // User submits join
      userSocket.on('connect', () => {
        userSocket.emit('client:submit_join', {
          nickname: 'Alice',
          token: invite.token
        });
      });

      userSocket.on('client:waiting_approval', () => {
        userWaiting = true;
      });

      const userApprovedPromise = new Promise((resolve, reject) => {
        userSocket.on('client:approved', (data) => {
          userApproved = true;
          assert.strictEqual(data.nickname, 'Alice');
          resolve();
        });
        setTimeout(() => reject(new Error('User approval timed out')), 4000);
      });

      await Promise.all([joinRequestPromise, userApprovedPromise]);

      assert(userWaiting, 'User should enter waiting state');
      assert(joinRequestReceived, 'Admin should receive join_request');
      assert(userApproved, 'User should receive client:approved');

      // Test real-time message sending
      const messagePromise = new Promise((resolve, reject) => {
        userSocket.on('chat:message', (msg) => {
          if (msg.content === 'Integration test message') {
            messageReceived = true;
            resolve();
          }
        });
        userSocket.emit('chat:send', { content: 'Integration test message' });
        setTimeout(() => reject(new Error('Message broadcast timed out')), 3000);
      });

      await messagePromise;
      assert(messageReceived, 'Chat message should be broadcast to room members');

      // Disconnect test sockets
      adminSocket.disconnect();
      userSocket.disconnect();
    } finally {
      server.close();
    }
  });

  console.log('\n======================================================');
  console.log(` TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
