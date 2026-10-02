const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const config = require('./src/config');
const { getNetworkInfo } = require('./src/network');
const banManager = require('./src/services/banManager');
const tokenManager = require('./src/services/tokenManager');
const db = require('./src/db/database');
const apiRoutes = require('./src/routes/api');
const pageRoutes = require('./src/routes/pages');
const initSocketHandler = require('./src/sockets/socketHandler');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with HTTP long-polling fallback and CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7 // 10MB
});

// Configure Express Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enforce IP ban check on all incoming requests
app.use(banManager.middleware());

// Serve static assets from public directory
app.use(express.static(config.paths.public));

// Serve uploaded files buffer directly from disk
app.use('/uploads', express.static(config.paths.uploads));

// Mount REST API routes
app.use('/api', apiRoutes);

// Mount Page routes
app.use('/', pageRoutes);

// Initialize real-time Socket.io handlers
initSocketHandler(io);

// Ensure uploads and data directories exist
if (!fs.existsSync(config.paths.uploads)) {
  fs.mkdirSync(config.paths.uploads, { recursive: true });
}
if (!fs.existsSync(config.paths.data)) {
  fs.mkdirSync(config.paths.data, { recursive: true });
}

// Generate an initial starter invite token so the host has one immediately ready to share
const starterInvite = tokenManager.createInviteToken({
  name: 'Initial Host Invite',
  maxUses: 5,
  expiryMinutes: config.defaultTokenExpiryMinutes
});

function startServer(port = config.port, host = config.host) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const netInfo = getNetworkInfo();
      const primaryIp = netInfo.primaryIp;

      const adminUrlLan = `http://${primaryIp}:${port}/admin?key=${config.adminKey}`;
      const adminUrlLocal = `http://localhost:${port}/admin?key=${config.adminKey}`;
      const inviteUrl = `http://${primaryIp}:${port}/join?token=${starterInvite.token}`;

      console.log('\n=============================================================');
      console.log('                 LOCALCHAT - LAN REAL-TIME SERVER            ');
      console.log('=============================================================');
      console.log(` Status:           Online & Listening on 0.0.0.0:${port}`);
      console.log(` Host LAN IP:      ${primaryIp}`);
      if (netInfo.allIps.length > 1) {
        console.log(` Other IPs:        ${netInfo.allIps.filter(ip => ip !== primaryIp).join(', ')}`);
      }
      console.log('-------------------------------------------------------------');
      console.log(` [ADMIN PANEL] (For Host Only):`);
      console.log(`   LAN Access:     ${adminUrlLan}`);
      console.log(`   Local Access:   ${adminUrlLocal}`);
      console.log(`   Admin Key:      ${config.adminKey}`);
      console.log('-------------------------------------------------------------');
      console.log(` [STARTER INVITE LINK] (Share with friends on same Wi-Fi):`);
      console.log(`   URL:            ${inviteUrl}`);
      console.log(`   Max Uses:       ${starterInvite.max_uses} friends (valid for ${config.defaultTokenExpiryMinutes} mins)`);
      console.log('-------------------------------------------------------------');
      console.log(' [PRIVACY NOTICE]  No external CDNs. All assets self-hosted.');
      console.log('                   Auto-wipe on shutdown is ENABLED.');
      console.log('=============================================================\n');
      resolve(server);
    });
  });
}

// Start listening if run directly
if (require.main === module) {
  startServer();
}

// Graceful shutdown & self-destruct cleanup
function cleanupAndExit(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Cleaning up LocalChat environment...`);

  try {
    if (config.autoWipeOnShutdown) {
      console.log('[SHUTDOWN] Purging temporary uploaded files...');
      if (fs.existsSync(config.paths.uploads)) {
        const files = fs.readdirSync(config.paths.uploads);
        for (const file of files) {
          fs.unlinkSync(path.join(config.paths.uploads, file));
        }
      }
      console.log('[SHUTDOWN] Uploads directory cleanly wiped.');
    }

    // Close DB
    db.close();
    console.log('[SHUTDOWN] Database connection closed.');

    server.close(() => {
      console.log('[SHUTDOWN] HTTP/Socket server terminated cleanly. Goodbye!\n');
      process.exit(0);
    });

    // Force exit after 3 seconds if server hasn't closed
    setTimeout(() => {
      process.exit(0);
    }, 3000);
  } catch (err) {
    console.error('[SHUTDOWN ERROR]', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => cleanupAndExit('SIGINT'));
process.on('SIGTERM', () => cleanupAndExit('SIGTERM'));

module.exports = { app, server, startServer };
