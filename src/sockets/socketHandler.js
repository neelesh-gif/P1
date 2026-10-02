const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const tokenManager = require('../services/tokenManager');
const banManager = require('../services/banManager');
const db = require('../db/database');
const { getNetworkInfo } = require('../network');
const { escapeHtml, sanitizeNickname, parseDeviceAgent } = require('../utils/sanitize');

function initSocketHandler(io) {
  // In-memory active user registry: socketId -> user details
  const activeUsers = new Map();
  // In-memory pending approval queue: socketId -> pending details
  const pendingQueue = new Map();

  // Middleware: inspect handshake and reject banned IPs
  io.use((socket, next) => {
    const rawIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0] ||
      socket.handshake.address ||
      socket.conn.remoteAddress;
    const clientIp = banManager.cleanIp(rawIp);

    if (banManager.isBanned(clientIp)) {
      return next(new Error('BANNED_IP'));
    }

    socket.clientIp = clientIp;
    socket.userAgent = socket.handshake.headers['user-agent'] || '';
    next();
  });

  function broadcastAdminState() {
    const roster = Array.from(activeUsers.values());
    const queue = Array.from(pendingQueue.values());
    const bans = banManager.getAll();
    const tokens = tokenManager.listTokens();
    const net = getNetworkInfo();

    io.to('admin_room').emit('admin:state_update', {
      roster,
      queue,
      bans,
      tokens,
      lanIp: net.primaryIp,
      port: config.port,
      stats: {
        activeCount: roster.length,
        pendingCount: queue.length,
        bannedCount: bans.length,
        tokenCount: tokens.length
      }
    });
  }

  function broadcastRoomUsers() {
    const userList = Array.from(activeUsers.values()).map(u => ({
      socketId: u.socketId,
      nickname: u.nickname,
      joinTime: u.joinTime,
      role: u.role
    }));
    io.to('chat_room').emit('chat:user_list', userList);
  }

  io.on('connection', (socket) => {
    const clientIp = socket.clientIp;
    const deviceInfo = parseDeviceAgent(socket.userAgent);

    // ----------------------------------------------------
    // ADMIN AUTHENTICATION & EVENTS
    // ----------------------------------------------------
    socket.on('admin:authenticate', ({ adminKey }) => {
      if (!tokenManager.verifyAdminKey(adminKey)) {
        return socket.emit('admin:auth_failed', { message: 'Invalid Master Admin Key' });
      }

      socket.isAdmin = true;
      socket.join('admin_room');
      socket.emit('admin:auth_success', {
        message: 'Admin authenticated successfully',
        serverConfig: {
          port: config.port,
          lanIp: getNetworkInfo().primaryIp,
          maxFileSizeMb: config.maxFileSizeMb
        }
      });

      // Send initial state immediately
      broadcastAdminState();
    });

    socket.on('admin:approve_user', ({ socketId }) => {
      if (!socket.isAdmin) return;

      const pending = pendingQueue.get(socketId);
      if (!pending) return;

      // Consume one use of invite token
      tokenManager.consumeToken(pending.token);
      pendingQueue.delete(socketId);

      const targetSocket = io.sockets.sockets.get(socketId);
      if (!targetSocket) {
        broadcastAdminState();
        return;
      }

      // Add to active users
      const userData = {
        socketId: pending.socketId,
        nickname: pending.nickname,
        localIp: pending.localIp,
        deviceAgent: pending.deviceAgent,
        joinTime: Date.now(),
        role: 'user'
      };

      activeUsers.set(socketId, userData);
      targetSocket.isApproved = true;
      targetSocket.userData = userData;
      targetSocket.join('chat_room');

      // Send approval payload to client with history & users
      targetSocket.emit('client:approved', {
        nickname: userData.nickname,
        socketId: userData.socketId,
        history: db.getRecentMessages(100),
        users: Array.from(activeUsers.values()).map(u => ({
          socketId: u.socketId,
          nickname: u.nickname,
          joinTime: u.joinTime,
          role: u.role
        }))
      });

      // Notify the chat room that someone joined
      io.to('chat_room').emit('chat:user_joined', {
        nickname: userData.nickname,
        socketId: userData.socketId,
        timestamp: Date.now()
      });

      broadcastRoomUsers();
      broadcastAdminState();
      db.logAction('USER_APPROVED', `Nickname: ${userData.nickname}, IP: ${userData.localIp}`, userData.localIp);
    });

    socket.on('admin:reject_user', ({ socketId, reason }) => {
      if (!socket.isAdmin) return;

      const pending = pendingQueue.get(socketId);
      if (pending) {
        pendingQueue.delete(socketId);
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('client:rejected', {
            reason: reason || 'Your join request was declined by the host.'
          });
          targetSocket.disconnect(true);
        }
        broadcastAdminState();
        db.logAction('USER_REJECTED', `Nickname: ${pending.nickname}, IP: ${pending.localIp}`, pending.localIp);
      }
    });

    socket.on('admin:kick_user', ({ socketId, reason }) => {
      if (!socket.isAdmin) return;

      const user = activeUsers.get(socketId);
      if (user) {
        activeUsers.delete(socketId);
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('client:kicked', {
            reason: reason || 'You were removed from the chat by the host.'
          });
          targetSocket.leave('chat_room');
          targetSocket.disconnect(true);
        }

        io.to('chat_room').emit('chat:user_left', {
          nickname: user.nickname,
          socketId: user.socketId,
          reason: 'Removed by host',
          timestamp: Date.now()
        });

        broadcastRoomUsers();
        broadcastAdminState();
        db.logAction('USER_KICKED', `Nickname: ${user.nickname}, IP: ${user.localIp}`, user.localIp);
      }
    });

    socket.on('admin:ban_ip', ({ ip, reason }) => {
      if (!socket.isAdmin) return;

      const cleanTargetIp = banManager.cleanIp(ip);
      if (!cleanTargetIp) return;

      banManager.ban(cleanTargetIp, reason || 'Banned by Admin');

      // Disconnect any active or pending sockets matching this IP
      for (const [sId, u] of activeUsers.entries()) {
        if (u.localIp === cleanTargetIp) {
          activeUsers.delete(sId);
          const s = io.sockets.sockets.get(sId);
          if (s) {
            s.emit('client:banned', { reason: 'Your IP was banned by the host.' });
            s.disconnect(true);
          }
          io.to('chat_room').emit('chat:user_left', {
            nickname: u.nickname,
            socketId: u.socketId,
            reason: 'Banned by host',
            timestamp: Date.now()
          });
        }
      }

      for (const [sId, p] of pendingQueue.entries()) {
        if (p.localIp === cleanTargetIp) {
          pendingQueue.delete(sId);
          const s = io.sockets.sockets.get(sId);
          if (s) {
            s.emit('client:banned', { reason: 'Your IP was banned by the host.' });
            s.disconnect(true);
          }
        }
      }

      broadcastRoomUsers();
      broadcastAdminState();
    });

    socket.on('admin:unban_ip', ({ ip }) => {
      if (!socket.isAdmin) return;
      banManager.unban(ip);
      broadcastAdminState();
    });

    socket.on('admin:purge_room', () => {
      if (!socket.isAdmin) return;

      // Purge database
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

      // Broadcast purge notice to chat room
      io.to('chat_room').emit('chat:purged', {
        timestamp: Date.now(),
        message: 'The room history and shared files have been wiped by the host.'
      });

      broadcastAdminState();
    });

    socket.on('admin:generate_invite', ({ name, maxUses, expiryMinutes }) => {
      if (!socket.isAdmin) return;

      const tokenRecord = tokenManager.createInviteToken({
        name: name || '',
        maxUses: parseInt(maxUses || '1', 10),
        expiryMinutes: expiryMinutes !== undefined ? parseInt(expiryMinutes, 10) : 60
      });

      const net = getNetworkInfo();
      const joinUrl = `http://${net.primaryIp}:${config.port}/join?token=${tokenRecord.token}`;

      socket.emit('admin:invite_generated', {
        token: tokenRecord,
        joinUrl
      });

      broadcastAdminState();
    });

    socket.on('admin:revoke_token', ({ token }) => {
      if (!socket.isAdmin) return;
      tokenManager.revokeToken(token);
      broadcastAdminState();
    });

    // ----------------------------------------------------
    // CLIENT JOIN & GATEKEEPER FLOW
    // ----------------------------------------------------
    socket.on('client:submit_join', ({ nickname, token }) => {
      // Re-verify IP isn't banned
      if (banManager.isBanned(clientIp)) {
        return socket.emit('client:error', { message: 'Your IP is banned from this chat room.' });
      }

      const validation = tokenManager.validateToken(token, 'invite');
      if (!validation.valid) {
        return socket.emit('client:invalid_token', { reason: validation.reason });
      }

      const safeNick = sanitizeNickname(nickname);

      const pendingData = {
        socketId: socket.id,
        nickname: safeNick,
        localIp: clientIp,
        deviceAgent: deviceInfo,
        token: token.trim(),
        requestedAt: Date.now()
      };

      pendingQueue.set(socket.id, pendingData);
      socket.emit('client:waiting_approval', {
        message: 'Your join request was submitted. Please wait for host approval.'
      });

      // Notify admin
      io.to('admin_room').emit('admin:join_request', pendingData);
      broadcastAdminState();
      db.logAction('JOIN_REQUESTED', `Nickname: ${safeNick}, IP: ${clientIp}`, clientIp);
    });

    // ----------------------------------------------------
    // CHAT MESSAGING & TYPING
    // ----------------------------------------------------
    socket.on('chat:send', (payload) => {
      if (!socket.isApproved || !socket.userData) {
        return socket.emit('client:error', { message: 'You are not approved to send messages.' });
      }

      const { content, type = 'text', attachment = null } = payload || {};
      const safeContent = content ? escapeHtml(content.trim()) : '';

      // Do not broadcast empty messages without attachment
      if (!safeContent && !attachment) return;

      const messageObj = {
        id: uuidv4(),
        senderId: socket.id,
        senderName: socket.userData.nickname,
        senderIp: socket.userData.localIp,
        content: safeContent,
        type: type === 'file' ? 'file' : 'text',
        attachment: attachment || null,
        timestamp: Date.now()
      };

      // Save to SQLite
      db.insertMessage(messageObj);

      // Broadcast to room
      io.to('chat_room').emit('chat:message', messageObj);
    });

    socket.on('chat:typing', ({ isTyping }) => {
      if (!socket.isApproved || !socket.userData) return;

      // Broadcast to other users in the room
      socket.to('chat_room').emit('chat:user_typing', {
        socketId: socket.id,
        nickname: socket.userData.nickname,
        isTyping: !!isTyping
      });
    });

    // ----------------------------------------------------
    // DISCONNECT
    // ----------------------------------------------------
    socket.on('disconnect', () => {
      if (pendingQueue.has(socket.id)) {
        pendingQueue.delete(socket.id);
        broadcastAdminState();
      }

      if (activeUsers.has(socket.id)) {
        const user = activeUsers.get(socket.id);
        activeUsers.delete(socket.id);

        io.to('chat_room').emit('chat:user_left', {
          nickname: user.nickname,
          socketId: user.socketId,
          reason: 'Disconnected',
          timestamp: Date.now()
        });

        broadcastRoomUsers();
        broadcastAdminState();
      }
    });
  });
}

module.exports = initSocketHandler;
