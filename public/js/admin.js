/**
 * LocalChat - Admin Dashboard Logic
 * 100% Self-Contained, Zero External Dependencies
 */

(function () {
  let socket = null;
  let adminKey = '';
  let serverLanIp = '';
  let serverPort = 3000;
  let lastQueueCount = 0;

  // DOM Elements
  const authModal = document.getElementById('admin-auth-modal');
  const authForm = document.getElementById('admin-auth-form');
  const authKeyInput = document.getElementById('admin-key-input');
  const authError = document.getElementById('admin-auth-error');

  const lanIpBadge = document.getElementById('host-lan-ip');
  const statActiveUsers = document.getElementById('stat-active-users');
  const statPendingQueue = document.getElementById('stat-pending-queue');
  const statBannedIps = document.getElementById('stat-banned-ips');
  const statActiveTokens = document.getElementById('stat-active-tokens');

  const queueContainer = document.getElementById('queue-container');
  const queueEmpty = document.getElementById('queue-empty');
  const rosterTbody = document.getElementById('roster-tbody');
  const tokensTbody = document.getElementById('tokens-tbody');
  const bansTbody = document.getElementById('bans-tbody');

  const inviteForm = document.getElementById('invite-form');
  const inviteNameInput = document.getElementById('invite-name');
  const inviteMaxUsesInput = document.getElementById('invite-max-uses');
  const inviteExpiryInput = document.getElementById('invite-expiry');
  const generatedLinkBox = document.getElementById('generated-link-box');
  const generatedUrlInput = document.getElementById('generated-url');
  const btnCopyGenerated = document.getElementById('btn-copy-generated');
  const qrCanvas = document.getElementById('qr-canvas');

  const btnPurge = document.getElementById('btn-purge-room');
  const purgeModal = document.getElementById('purge-modal');
  const btnConfirmPurge = document.getElementById('btn-confirm-purge');
  const btnCancelPurge = document.getElementById('btn-cancel-purge');

  window.addEventListener('DOMContentLoaded', () => {
    initAdmin();
  });

  function initAdmin() {
    // 1. Get key from URL or SessionStorage
    const params = new URLSearchParams(window.location.search);
    const keyFromUrl = params.get('key');
    const storedKey = sessionStorage.getItem('localchat_admin_key');

    adminKey = keyFromUrl || storedKey || '';

    // 2. Connect socket
    socket = io();
    setupSocketListeners();
    setupUiListeners();

    if (adminKey) {
      authKeyInput.value = adminKey;
      authenticate();
    } else {
      authModal.style.display = 'flex';
    }
  }

  function setupUiListeners() {
    // Auth Form
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      adminKey = authKeyInput.value.trim();
      if (!adminKey) return;
      authenticate();
    });

    // Generate Invite Form
    inviteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = inviteNameInput.value.trim();
      const maxUses = parseInt(inviteMaxUsesInput.value, 10);
      const expiryMinutes = parseInt(inviteExpiryInput.value, 10);

      socket.emit('admin:generate_invite', {
        name,
        maxUses,
        expiryMinutes
      });
    });

    // Copy generated link
    btnCopyGenerated.addEventListener('click', () => {
      window.copyToClipboard(generatedUrlInput.value, 'Invite link copied to clipboard!');
    });

    // Purge Room Modal
    btnPurge.addEventListener('click', () => {
      purgeModal.style.display = 'flex';
    });

    btnCancelPurge.addEventListener('click', () => {
      purgeModal.style.display = 'none';
    });

    btnConfirmPurge.addEventListener('click', () => {
      socket.emit('admin:purge_room');
      purgeModal.style.display = 'none';
      window.showToast('Room history and invite tokens purged!', 'warning');
    });
  }

  function authenticate() {
    socket.emit('admin:authenticate', { adminKey });
  }

  function setupSocketListeners() {
    socket.on('admin:auth_success', (data) => {
      sessionStorage.setItem('localchat_admin_key', adminKey);
      authModal.style.display = 'none';
      serverLanIp = data.serverConfig.lanIp;
      serverPort = data.serverConfig.port;
      lanIpBadge.textContent = `${serverLanIp}:${serverPort}`;
      window.showToast('Admin authenticated successfully', 'success');
    });

    socket.on('admin:auth_failed', (data) => {
      authModal.style.display = 'flex';
      authError.textContent = data.message || 'Invalid Master Admin Key';
      authError.style.display = 'block';
      sessionStorage.removeItem('localchat_admin_key');
    });

    // Real-time State Update
    socket.on('admin:state_update', (state) => {
      serverLanIp = state.lanIp;
      serverPort = state.port;
      lanIpBadge.textContent = `${serverLanIp}:${serverPort}`;

      // Update counters
      statActiveUsers.textContent = state.stats.activeCount;
      statPendingQueue.textContent = state.stats.pendingCount;
      statBannedIps.textContent = state.stats.bannedCount;
      statActiveTokens.textContent = state.stats.tokenCount;

      renderQueue(state.queue);
      renderRoster(state.roster);
      renderTokens(state.tokens);
      renderBans(state.bans);
    });

    // New Incoming Join Request
    socket.on('admin:join_request', (request) => {
      window.SoundFx.play('alert');
      window.showToast(`Join Request: ${request.nickname} (${request.localIp})`, 'info');
    });

    // Invite generated response
    socket.on('admin:invite_generated', ({ token, joinUrl }) => {
      generatedLinkBox.style.display = 'block';
      generatedUrlInput.value = joinUrl;

      // Render QR Code onto canvas
      if (window.renderQRCode && qrCanvas) {
        window.renderQRCode(qrCanvas, joinUrl, 160);
      }

      window.showToast('Invite link generated!', 'success');
    });
  }

  // Render Gatekeeper Pending Queue
  function renderQueue(queue) {
    if (!queue || queue.length === 0) {
      queueContainer.innerHTML = '';
      queueEmpty.style.display = 'block';
      return;
    }

    queueEmpty.style.display = 'none';
    queueContainer.innerHTML = '';

    queue.forEach((req) => {
      const card = document.createElement('div');
      card.className = 'queue-card';

      const dev = req.deviceAgent || { os: 'Unknown OS', browser: 'Unknown Browser', device: 'Desktop' };

      card.innerHTML = `
        <div class="queue-card-top">
          <span class="queue-card-user">${req.nickname}</span>
          <span class="badge badge-pending">Waiting</span>
        </div>
        <div class="queue-card-details">
          <div><strong>IP:</strong> <span style="font-family:var(--font-mono);">${req.localIp}</span></div>
          <div><strong>Device:</strong> ${dev.device} • ${dev.os} (${dev.browser})</div>
          <div><strong>Token:</strong> <span style="font-family:var(--font-mono); font-size:0.75rem;">${req.token.substring(0, 13)}...</span></div>
        </div>
        <div class="queue-card-actions">
          <button class="btn btn-success btn-sm btn-approve" data-id="${req.socketId}">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Approve
          </button>
          <button class="btn btn-danger btn-sm btn-reject" data-id="${req.socketId}">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            Reject
          </button>
        </div>
      `;

      // Wire buttons
      card.querySelector('.btn-approve').addEventListener('click', () => {
        socket.emit('admin:approve_user', { socketId: req.socketId });
        window.showToast(`Approved ${req.nickname}`, 'success');
      });

      card.querySelector('.btn-reject').addEventListener('click', () => {
        socket.emit('admin:reject_user', { socketId: req.socketId });
        window.showToast(`Rejected ${req.nickname}`, 'info');
      });

      queueContainer.appendChild(card);
    });
  }

  // Render Live Roster Table
  function renderRoster(roster) {
    if (!rosterTbody) return;

    if (!roster || roster.length === 0) {
      rosterTbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No active users connected currently.</td></tr>`;
      return;
    }

    rosterTbody.innerHTML = '';

    roster.forEach((u) => {
      const tr = document.createElement('tr');
      const dev = u.deviceAgent || { os: 'Unknown OS', browser: 'Unknown Browser', device: 'Desktop' };
      const duration = window.formatDuration(u.joinTime);

      tr.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--success);"></span>
            <strong>${u.nickname}</strong>
          </div>
        </td>
        <td><span style="font-family:var(--font-mono);">${u.localIp}</span></td>
        <td>${dev.device} / ${dev.os}</td>
        <td><span style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.75rem;">${u.socketId.substring(0, 10)}...</span></td>
        <td>${duration}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline-danger btn-sm btn-kick" title="Kick user from room">Kick</button>
            <button class="btn btn-danger btn-sm btn-ban" title="Ban IP address from server">Ban IP</button>
          </div>
        </td>
      `;

      tr.querySelector('.btn-kick').addEventListener('click', () => {
        if (confirm(`Kick ${u.nickname} from the chat?`)) {
          socket.emit('admin:kick_user', { socketId: u.socketId });
        }
      });

      tr.querySelector('.btn-ban').addEventListener('click', () => {
        const reason = prompt(`Ban IP ${u.localIp} from server?\nEnter reason:`, 'Violating room rules');
        if (reason !== null) {
          socket.emit('admin:ban_ip', { ip: u.localIp, reason });
        }
      });

      rosterTbody.appendChild(tr);
    });
  }

  // Render Invite Tokens Table
  function renderTokens(tokens) {
    if (!tokensTbody) return;

    const invites = (tokens || []).filter(t => t.type === 'invite');

    if (invites.length === 0) {
      tokensTbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No invite tokens created yet.</td></tr>`;
      return;
    }

    tokensTbody.innerHTML = '';

    invites.forEach((t) => {
      const tr = document.createElement('tr');
      const fullUrl = `http://${serverLanIp}:${serverPort}/join?token=${t.token}`;

      let statusBadge = '<span class="badge badge-online">Active</span>';
      if (t.revoked) {
        statusBadge = '<span class="badge" style="background:rgba(239,68,68,0.2); color:#f87171;">Revoked</span>';
      } else if (t.isExpired) {
        statusBadge = '<span class="badge" style="background:rgba(100,116,139,0.2); color:#94a3b8;">Expired</span>';
      } else if (t.isExhausted) {
        statusBadge = '<span class="badge" style="background:rgba(245,158,11,0.2); color:#fbbf24;">Exhausted</span>';
      }

      const usesStr = t.maxUses === 0 ? `${t.usedCount} (Unlimited)` : `${t.usedCount} / ${t.maxUses}`;
      const expiryStr = t.expiresAt ? new Date(t.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';

      tr.innerHTML = `
        <td><strong>${t.name || 'Invite Link'}</strong></td>
        <td><span style="font-family:var(--font-mono); font-size:0.75rem;">${t.token.substring(0, 13)}...</span></td>
        <td>${usesStr}</td>
        <td>${expiryStr}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-secondary btn-sm btn-copy-token">Copy URL</button>
        </td>
        <td>
          ${!t.revoked ? `<button class="btn btn-outline-danger btn-sm btn-revoke">Revoke</button>` : '<span style="color:var(--text-muted); font-size:0.8rem;">Revoked</span>'}
        </td>
      `;

      tr.querySelector('.btn-copy-token').addEventListener('click', () => {
        window.copyToClipboard(fullUrl, 'Invite link copied!');
      });

      const revokeBtn = tr.querySelector('.btn-revoke');
      if (revokeBtn) {
        revokeBtn.addEventListener('click', () => {
          if (confirm('Revoke this invite link immediately?')) {
            socket.emit('admin:revoke_token', { token: t.token });
          }
        });
      }

      tokensTbody.appendChild(tr);
    });
  }

  // Render Banned IPs Table
  function renderBans(bans) {
    if (!bansTbody) return;

    if (!bans || bans.length === 0) {
      bansTbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No IP addresses are currently banned.</td></tr>`;
      return;
    }

    bansTbody.innerHTML = '';

    bans.forEach((b) => {
      const tr = document.createElement('tr');
      const dateStr = new Date(b.banned_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

      tr.innerHTML = `
        <td><span style="font-family:var(--font-mono); color:#f87171;">${b.ip}</span></td>
        <td>${b.reason || 'Banned by Admin'}</td>
        <td>${dateStr}</td>
        <td>
          <button class="btn btn-secondary btn-sm btn-unban">Unban</button>
        </td>
      `;

      tr.querySelector('.btn-unban').addEventListener('click', () => {
        socket.emit('admin:unban_ip', { ip: b.ip });
        window.showToast(`Unbanned IP ${b.ip}`, 'info');
      });

      bansTbody.appendChild(tr);
    });
  }
})();
