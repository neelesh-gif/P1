/**
 * LocalChat - Client Chat & Gatekeeper Logic
 * 100% Self-Contained, Zero External Dependencies
 */

(function () {
  let socket = null;
  let currentUser = {
    nickname: '',
    socketId: '',
    token: ''
  };

  let typingTimeout = null;
  let isTyping = false;
  const activeTypers = new Map(); // socketId -> nickname

  // DOM Elements
  const joinModal = document.getElementById('join-modal');
  const joinForm = document.getElementById('join-form');
  const nicknameInput = document.getElementById('nickname-input');
  const tokenInput = document.getElementById('token-input');
  const tokenGroup = document.getElementById('token-group');
  const joinError = document.getElementById('join-error');
  const joinSubmitBtn = document.getElementById('join-submit-btn');

  const waitingModal = document.getElementById('waiting-modal');
  const waitingNickname = document.getElementById('waiting-nickname');
  const waitingIp = document.getElementById('waiting-ip');

  const chatContainer = document.getElementById('chat-container');
  const chatViewport = document.getElementById('chat-viewport');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const fileInput = document.getElementById('file-input');
  const btnAttach = document.getElementById('btn-attach');
  const typingBar = document.getElementById('typing-bar');
  const userListContainer = document.getElementById('user-list');
  const onlineCount = document.getElementById('online-count');
  const sidebarToggleBtn = document.getElementById('btn-sidebar-toggle');
  const chatSidebar = document.getElementById('chat-sidebar');
  const dropOverlay = document.getElementById('drop-overlay');
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');

  // Initialize
  window.addEventListener('DOMContentLoaded', () => {
    initApp();
  });

  function initApp() {
    // Parse token from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');

    if (tokenFromUrl) {
      currentUser.token = tokenFromUrl.trim();
      tokenInput.value = currentUser.token;
      tokenGroup.style.display = 'none'; // Hide token input if provided in URL
    } else {
      tokenGroup.style.display = 'flex';
    }

    // Connect to Socket.io
    socket = io({
      reconnectionAttempts: 5,
      timeout: 10000
    });

    setupSocketListeners();
    setupUiListeners();
  }

  function setupUiListeners() {
    // Join form submission
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nick = nicknameInput.value.trim();
      const token = (currentUser.token || tokenInput.value).trim();

      if (!nick) {
        showJoinError('Please enter a display name');
        return;
      }
      if (!token) {
        showJoinError('Please enter an invite token');
        return;
      }

      currentUser.nickname = nick;
      currentUser.token = token;

      joinSubmitBtn.disabled = true;
      joinSubmitBtn.textContent = 'Connecting...';

      // Submit join request to host
      socket.emit('client:submit_join', {
        nickname: nick,
        token: token
      });
    });

    // Chat message form submission
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage();
    });

    // Typing debouncing
    chatInput.addEventListener('input', () => {
      if (!isTyping) {
        isTyping = true;
        socket.emit('chat:typing', { isTyping: true });
      }

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('chat:typing', { isTyping: false });
      }, 2000);
    });

    // File Attachment click
    btnAttach.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFileUpload(fileInput.files[0]);
        fileInput.value = '';
      }
    });

    // Drag and Drop files onto chat viewport
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dropOverlay) dropOverlay.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.clientX <= 0 || e.clientY <= 0) {
        if (dropOverlay) dropOverlay.classList.remove('active');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dropOverlay) dropOverlay.classList.remove('active');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    // Mobile sidebar toggle
    if (sidebarToggleBtn && chatSidebar) {
      sidebarToggleBtn.addEventListener('click', () => {
        chatSidebar.classList.toggle('open');
      });
    }

    // Lightbox close
    if (lightboxModal) {
      lightboxModal.addEventListener('click', () => {
        lightboxModal.style.display = 'none';
      });
    }
  }

  function setupSocketListeners() {
    // Gatekeeper: Waiting for approval
    socket.on('client:waiting_approval', (data) => {
      joinModal.style.display = 'none';
      waitingModal.style.display = 'flex';
      waitingNickname.textContent = currentUser.nickname;
      waitingIp.textContent = socket.clientIp || window.location.hostname;
    });

    // Gatekeeper: Approved!
    socket.on('client:approved', (data) => {
      currentUser.nickname = data.nickname;
      currentUser.socketId = data.socketId;

      waitingModal.style.display = 'none';
      chatContainer.style.display = 'flex';

      // Load history
      chatViewport.innerHTML = '';
      if (data.history && data.history.length > 0) {
        data.history.forEach(renderMessage);
      } else {
        renderEmptyState();
      }

      // Populate user roster
      if (data.users) {
        renderUserList(data.users);
      }

      scrollToBottom();
      window.SoundFx.play('join');
      window.showToast(`Welcome to the room, ${currentUser.nickname}!`, 'success');
      chatInput.focus();
    });

    // Gatekeeper: Rejected
    socket.on('client:rejected', (data) => {
      waitingModal.style.display = 'none';
      joinModal.style.display = 'flex';
      joinSubmitBtn.disabled = false;
      joinSubmitBtn.textContent = 'Request to Join';
      showJoinError(data.reason || 'Host rejected your join request.');
      window.showToast('Join request declined', 'error');
    });

    // Token invalid
    socket.on('client:invalid_token', (data) => {
      joinSubmitBtn.disabled = false;
      joinSubmitBtn.textContent = 'Request to Join';
      tokenGroup.style.display = 'flex';
      showJoinError(data.reason || 'Invalid or expired invite token.');
    });

    // Kicked by host
    socket.on('client:kicked', (data) => {
      alert(`You were removed from the room by the host: ${data.reason || 'No reason provided'}`);
      window.location.reload();
    });

    // Banned by host
    socket.on('client:banned', (data) => {
      alert('Your IP address has been banned by the host.');
      window.location.reload();
    });

    // Real-time Chat message
    socket.on('chat:message', (message) => {
      removeEmptyState();
      renderMessage(message);
      scrollToBottom();

      // Play chime if message came from someone else
      if (message.senderId !== socket.id) {
        window.SoundFx.play('message');
      }
    });

    // User joined notification
    socket.on('chat:user_joined', (data) => {
      renderSystemNotice(`${data.nickname} joined the room.`);
      scrollToBottom();
    });

    // User left notification
    socket.on('chat:user_left', (data) => {
      renderSystemNotice(`${data.nickname} left (${data.reason || 'disconnected'}).`);
      scrollToBottom();
    });

    // Active roster update
    socket.on('chat:user_list', (users) => {
      renderUserList(users);
    });

    // Typing indicators
    socket.on('chat:user_typing', (data) => {
      if (data.isTyping) {
        activeTypers.set(data.socketId, data.nickname);
      } else {
        activeTypers.delete(data.socketId);
      }
      renderTypingIndicator();
    });

    // Room purged by admin
    socket.on('chat:purged', (data) => {
      chatViewport.innerHTML = '';
      renderSystemNotice(`[HISTORY PURGED] ${data.message}`);
      window.SoundFx.play('wipe');
      window.showToast('Room history wiped by host', 'info');
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'BANNED_IP') {
        alert('Your IP is banned from accessing this chat server.');
      }
    });
  }

  function sendMessage() {
    const content = chatInput.value.trim();
    if (!content) return;

    socket.emit('chat:send', {
      content: content,
      type: 'text'
    });

    chatInput.value = '';
    clearTimeout(typingTimeout);
    if (isTyping) {
      isTyping = false;
      socket.emit('chat:typing', { isTyping: false });
    }
    chatInput.focus();
  }

  async function handleFileUpload(file) {
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      window.showToast('File exceeds 10MB limit', 'error');
      return;
    }

    window.showToast(`Uploading ${file.name}...`, 'info');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }

      // Broadcast attachment message
      socket.emit('chat:send', {
        content: '',
        type: 'file',
        attachment: data.file
      });

      window.showToast('File sent successfully', 'success');
    } catch (err) {
      console.error(err);
      window.showToast(err.message || 'Error uploading file', 'error');
    }
  }

  function renderMessage(msg) {
    const isOwn = msg.senderId === socket.id;
    const msgEl = document.createElement('div');
    msgEl.className = `message-item ${isOwn ? 'own-message' : ''}`;

    const avatarBg = window.getAvatarStyle(msg.senderName);
    const initials = window.getInitials(msg.senderName);
    const timeStr = window.formatTimestamp(msg.timestamp);

    let contentHtml = '';
    if (msg.content) {
      contentHtml = `<div class="message-text">${window.formatMessageContent(msg.content)}</div>`;
    }

    let attachmentHtml = '';
    if (msg.attachment) {
      const att = msg.attachment;
      const isImg = att.mimeType && att.mimeType.startsWith('image/');
      const isAudio = att.mimeType && att.mimeType.startsWith('audio/');

      if (isImg) {
        attachmentHtml = `
          <div class="attachment-card">
            <img src="${att.url}" alt="${att.originalName}" class="attachment-image-thumb" onclick="openLightbox('${att.url}')">
          </div>
        `;
      } else if (isAudio) {
        attachmentHtml = `
          <div class="attachment-card" style="padding: 6px 10px;">
            <div style="font-size: 0.8rem; margin-bottom: 4px; font-weight: 500;">${att.originalName}</div>
            <audio controls class="attachment-audio" src="${att.url}"></audio>
          </div>
        `;
      } else {
        attachmentHtml = `
          <div class="attachment-card">
            <a href="${att.url}" download="${att.originalName}" class="attachment-file-box">
              <div class="file-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
              </div>
              <div class="file-info">
                <span class="file-name" title="${att.originalName}">${att.originalName}</span>
                <span class="file-size">${window.formatFileSize(att.size)} • Click to download</span>
              </div>
            </a>
          </div>
        `;
      }
    }

    msgEl.innerHTML = `
      <div class="message-avatar" style="background: ${avatarBg};">
        ${initials}
      </div>
      <div class="message-content-wrapper">
        <div class="message-header">
          <span class="message-sender">${msg.senderName}</span>
          <span class="message-time">${timeStr}</span>
        </div>
        <div class="message-bubble">
          ${contentHtml}
          ${attachmentHtml}
        </div>
      </div>
    `;

    chatViewport.appendChild(msgEl);
  }

  function renderSystemNotice(text) {
    const notice = document.createElement('div');
    notice.className = 'message-system';
    notice.innerHTML = `<span>${text}</span>`;
    chatViewport.appendChild(notice);
  }

  function renderEmptyState() {
    chatViewport.innerHTML = `
      <div class="chat-empty-state" id="chat-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
        <p style="font-weight: 500; font-size: 0.95rem; margin-bottom: 4px;">Welcome to LocalChat</p>
        <p style="font-size: 0.82rem;">This is a private, real-time room on your local network. Say hi or drop a file to start chatting!</p>
      </div>
    `;
  }

  function removeEmptyState() {
    const empty = document.getElementById('chat-empty-state');
    if (empty) empty.remove();
  }

  function renderUserList(users) {
    if (!userListContainer) return;
    userListContainer.innerHTML = '';
    onlineCount.textContent = `${users.length} Online`;

    users.forEach((u) => {
      const card = document.createElement('div');
      card.className = 'user-card';

      const avatarBg = window.getAvatarStyle(u.nickname);
      const initials = window.getInitials(u.nickname);
      const isSelf = u.socketId === socket.id;

      card.innerHTML = `
        <div class="user-avatar" style="background: ${avatarBg};">
          ${initials}
        </div>
        <div class="user-meta">
          <span class="user-name">${u.nickname} ${isSelf ? '<span style="color:var(--text-muted); font-size:0.75rem;">(You)</span>' : ''}</span>
          <span class="user-status">Active now</span>
        </div>
      `;
      userListContainer.appendChild(card);
    });
  }

  function renderTypingIndicator() {
    if (!typingBar) return;
    const names = Array.from(activeTypers.values());

    if (names.length === 0) {
      typingBar.innerHTML = '';
      return;
    }

    let text = '';
    if (names.length === 1) {
      text = `${names[0]} is typing`;
    } else if (names.length === 2) {
      text = `${names[0]} and ${names[1]} are typing`;
    } else {
      text = `${names[0]} and ${names.length - 1} others are typing`;
    }

    typingBar.innerHTML = `
      <span>${text}</span>
      <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
    `;
  }

  function scrollToBottom() {
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  function showJoinError(msg) {
    joinError.textContent = msg;
    joinError.style.display = 'block';
  }

  // Lightbox helper exposed to window
  window.openLightbox = function (url) {
    if (lightboxModal && lightboxImg) {
      lightboxImg.src = url;
      lightboxModal.style.display = 'flex';
    }
  };
})();
