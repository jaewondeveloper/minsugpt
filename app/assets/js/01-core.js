if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html ??this module cannot run alone.");
}
function iconNameMap(name) {
      const map = {
        menu: 'tabler:menu-2',
        x: 'tabler:circle-x-filled',
        'square-pen': 'tabler:pencil-filled',
        search: 'tabler:search',
        library: 'tabler:book-filled',
        user: 'tabler:user-circle-filled',
        settings: 'tabler:settings-filled',
        plus: 'heroicons:plus-20-solid',
        'chevron-down': 'tabler:caret-down-filled',
        'arrow-up': 'heroicons:arrow-up-20-solid',
        ellipsis: 'heroicons:ellipsis-horizontal-20-solid',
        pin: 'tabler:map-pin-filled',
        pencil: 'tabler:pencil-filled',
        copy: 'tabler:copy',
        check: 'tabler:check',
        'trash-2': 'tabler:trash-filled',
        'thumb-up': 'tabler:thumb-up',
        'thumb-down': 'tabler:thumb-down',
        'refresh-cw': 'tabler:refresh',
        'chevron-left': 'tabler:chevron-left',
        'chevron-right': 'tabler:chevron-right',
        'logout-2': 'tabler:logout-2'
      };
      return map[name] || 'tabler:circle-filled';
    }

    function sidebarIconNameMap(name) {
      const map = {
        menu: 'streamline-flex:layout-right-sidebar',
        x: 'streamline-flex:remove-circle',
        'square-pen': 'streamline-flex:pencil-square',
        search: 'streamline-flex:code-analysis',
        library: 'streamline-flex:pictures-folder-memories',
        user: 'streamline-flex:user-circle-single',
        settings: 'streamline-flex:cog-circle',
        ellipsis: 'heroicons:ellipsis-horizontal-20-solid',
        pin: 'streamline-flex:pin',
        pencil: 'streamline-flex:pencil-circle',
        'logout-2': 'tabler:logout-2'
      };
      return map[name] || iconNameMap(name);
    }

    function renderRoundedIcons(root) {
      const scope = root || document;
      scope.querySelectorAll('[data-lucide]').forEach((el) => {
        const key = el.getAttribute('data-lucide') || '';
        const iconName = el.closest('#sidebar') ? sidebarIconNameMap(key) : iconNameMap(key);
        const classes = el.className || '';
        const icon = document.createElement('iconify-icon');
        icon.setAttribute('icon', iconName);
        icon.className = classes.trim();
        icon.setAttribute('aria-hidden', 'true');
        el.replaceWith(icon);
      });
    }

    function resolveLoginUrlFromApp() {
      return window.location.origin + '/login';
    }

    function parseAuthSessionRaw() {
      try {
        const raw = localStorage.getItem('minsugpt_auth_v1');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.token) return null;
        const issuedAtMs = Date.parse(parsed.issuedAt || '');
        const expiresAtMs = Date.parse(parsed.expiresAt || '');
        const fallbackExpires = issuedAtMs && !Number.isNaN(issuedAtMs) ? (issuedAtMs + 24 * 60 * 60 * 1000) : 0;
        const effectiveExpires = !Number.isNaN(expiresAtMs) && expiresAtMs ? expiresAtMs : fallbackExpires;
        if (!effectiveExpires || Date.now() > effectiveExpires) return null;
        return parsed;
      } catch {
        return null;
      }
    }

    if (!parseAuthSessionRaw()) {
      window.top.location.href = resolveLoginUrlFromApp();
      throw new Error('MinsuGPT auth required');
    }

    renderRoundedIcons(document);

    const API_BASE = 'https://sigan.onrender.com';
    const AUTH_BASE = 'https://jaewondev6.pythonanywhere.com';
    const AUTH_LOGIN_PATH = '/api/auth/login';
    const AUTH_VERIFY_PATH = '/api/auth/verify';
    const AUTH_CHAT_SESSIONS_PATH = '/api/chat/sessions';
    const AUTH_STORAGE_KEY = 'minsugpt_auth_v1';
    const AUTH_VERIFY_ON_LOAD = true;
    const NORMAL_LOGIN_MS = 24 * 60 * 60 * 1000;
    const STORAGE_KEY = 'minsugpt_chats_v1';
    const SLOT_X = [0, 11, 22];

    let chatHistory = [];
    let currentSessionId = null;
    let isSending = false;
    let isRegenerating = false;
    let loadingAnimStop = null;
    const typingAnimStates = new Set();

    function loginPageUrl() {
      return resolveLoginUrlFromApp();
    }

    function clearAuthSession() {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
      sessionsStore = { sessions: [], currentId: null };
      currentSessionId = null;
    }

    function setAuthSession(nextSession) {
      if (!nextSession || !nextSession.token) return;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
    }

    function getAuthSession() {
      try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.token) return null;
        const issuedAtMs = Date.parse(parsed.issuedAt || '');
        const expiresAtMs = Date.parse(parsed.expiresAt || '');
        const fallbackExpires = issuedAtMs && !Number.isNaN(issuedAtMs) ? (issuedAtMs + NORMAL_LOGIN_MS) : 0;
        const effectiveExpires = !Number.isNaN(expiresAtMs) && expiresAtMs ? expiresAtMs : fallbackExpires;
        if (!effectiveExpires || Date.now() > effectiveExpires) {
          clearAuthSession();
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }

    async function ensureAuthOrRedirect() {
      const session = getAuthSession();
      if (!session) {
        window.top.location.href = loginPageUrl();
        return null;
      }
      authUser = session.user || null;
      if (!AUTH_VERIFY_ON_LOAD) return session;
      try {
        const res = await fetch(AUTH_BASE + AUTH_VERIFY_PATH, {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + session.token }
        });
        if (!res.ok) throw new Error('invalid');
        const data = await res.json().catch(() => ({}));
        const merged = Object.assign({}, session, { user: data.user || session.user || null });
        setAuthSession(merged);
        authUser = merged.user || null;
        return merged;
      } catch {
        clearAuthSession();
        window.top.location.href = loginPageUrl();
        return null;
      }
    }

    function authHeaders() {
      const session = getAuthSession();
      if (!session) return {};
      return { Authorization: 'Bearer ' + session.token };
    }

    async function authApiFetch(path, options) {
      const opts = options || {};
      const headers = Object.assign({}, opts.headers || {}, authHeaders());
      const res = await fetch(AUTH_BASE + path, Object.assign({}, opts, { headers }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || ('요청 실패 (' + res.status + ')'));
      return data;
    }

    async function fetchRemoteSessions() {
      const data = await authApiFetch(AUTH_CHAT_SESSIONS_PATH, { method: 'GET' });
      const sessions = (data.sessions || []).map((s) => ({
        id: s.id,
        title: s.title || '새 채팅',
        messages: Array.isArray(s.messages) ? s.messages : [],
        updatedAt: s.updatedAt || new Date().toISOString()
      }));
      sessionsStore.sessions = sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return sessionsStore.sessions;
    }

    function syncSessionToServer(session) {
      return authApiFetch(AUTH_CHAT_SESSIONS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: session.id,
          title: session.title || '새 채팅',
          messages: session.messages || [],
          updatedAt: session.updatedAt || new Date().toISOString()
        })
      });
    }

    function deleteSessionFromServer(id) {
      return authApiFetch(AUTH_CHAT_SESSIONS_PATH + '/' + encodeURIComponent(id), { method: 'DELETE' });
    }

    function normalizeAssistantMessage(m) {
      if (m.role !== 'assistant') return m;
      if (m.versions && m.versions.length) {
        const versionIndex = typeof m.versionIndex === 'number'
          ? Math.max(0, Math.min(m.versionIndex, m.versions.length - 1))
          : m.versions.length - 1;
        return { role: 'assistant', versions: m.versions.slice(), versionIndex };
      }
      const content = m.content || '';
      return { role: 'assistant', versions: [content], versionIndex: 0 };
    }

    function normalizeHistoryMessage(m) {
      if (m.role === 'assistant') return normalizeAssistantMessage(m);
      return { role: 'user', content: m.content || '' };
    }

    function assistantActiveContent(m) {
      const norm = normalizeAssistantMessage(m);
      const idx = norm.versionIndex ?? norm.versions.length - 1;
      return norm.versions[idx] || '';
    }

    function historyForApi(untilIndex) {
      const list = untilIndex == null ? chatHistory : chatHistory.slice(0, untilIndex);
      return list.map((m) => {
        if (m.role === 'assistant') {
          return { role: 'assistant', content: assistantActiveContent(m) };
        }
        return { role: 'user', content: m.content };
      });
    }

    function serializeHistoryForStore() {
      return chatHistory.map((m) => {
        if (m.role === 'assistant') {
          const norm = normalizeAssistantMessage(m);
          return {
            role: 'assistant',
            versions: norm.versions,
            versionIndex: norm.versionIndex
          };
        }
        return { role: 'user', content: m.content };
      });
    }

    // ── 리플 효과 (마우스 + 터치 공통) ──
    function attachRipple(button) {
      function spawnRipple(clientX, clientY) {
        const old = button.querySelector('.ripple');
        if (old) old.remove();
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (clientX - rect.left - size / 2) + 'px';
        ripple.style.top  = (clientY - rect.top  - size / 2) + 'px';
        button.appendChild(ripple);
        requestAnimationFrame(() => { ripple.style.transform = 'scale(1)'; });
      }
      function fadeRipple() {
        const ripple = button.querySelector('.ripple');
        if (ripple) {
          ripple.classList.add('fade-out');
          setTimeout(() => ripple.remove(), 400);
        }
      }
      button.addEventListener('mousedown',   (e) => spawnRipple(e.clientX, e.clientY));
      button.addEventListener('mouseup',     fadeRipple);
      button.addEventListener('mouseleave',  fadeRipple);
      button.addEventListener('touchstart',  (e) => spawnRipple(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
      button.addEventListener('touchend',    fadeRipple, { passive: true });
      button.addEventListener('touchcancel', fadeRipple, { passive: true });
    }

    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mobileMenuOpen = document.getElementById('mobile-menu-open');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatHistoryList = document.getElementById('chat-history-list');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const mainPanel = document.getElementById('main-panel');
    const welcomeBlock = document.getElementById('welcome-block');
    const chatMessages = document.getElementById('chat-messages');
    const chatError = document.getElementById('chat-error');
    const searchBtn = document.getElementById('mobile-search-btn');
    const mobileTopNewChat = document.getElementById('mobile-top-new-chat');
    const mobileTopMore = document.getElementById('mobile-top-more');
    const searchModal = document.getElementById('chat-search-modal');
    const searchInput = document.getElementById('chat-search-input');
    const searchClose = document.getElementById('chat-search-close');
    const searchResults = document.getElementById('chat-search-results');
    const searchPreview = document.getElementById('chat-search-preview');
    const libraryBtn = document.getElementById('mobile-library-btn');
    const mobileSearchBtn = document.getElementById('mobile-search-btn');
    const profileMenu = document.getElementById('profile-menu');
    const profileMenuTrigger = document.getElementById('profile-menu-trigger');
    const profileMenuTriggerBtn = document.getElementById('profile-menu-trigger-btn');
    const profileMenuSettingsBtn = document.getElementById('profile-menu-settings');
    const profileMenuLogoutBtn = document.getElementById('profile-menu-logout');
    const profileNameEl = document.getElementById('profile-name');
    const profileAvatarEl = document.getElementById('profile-avatar');
    const historyActionMenu = document.getElementById('history-action-menu');
    const historyActionEdit = document.getElementById('history-action-edit');
    const historyActionDuplicate = document.getElementById('history-action-duplicate');
    const historyActionDelete = document.getElementById('history-action-delete');
    const historyDialog = document.getElementById('history-dialog');
    const historyDialogTitle = document.getElementById('history-dialog-title');
    const historyDialogDesc = document.getElementById('history-dialog-desc');
    const historyDialogInput = document.getElementById('history-dialog-input');
    const historyDialogCancel = document.getElementById('history-dialog-cancel');
    const historyDialogOk = document.getElementById('history-dialog-ok');
    let historyActionTargetId = null;
    let historyDialogResolver = null;
    let gradientRAF = null;
    let gradientFrozen = false;
    let gradientTickStart = performance.now();
    let gradientWaveTimer = null;
    let authUser = null;
    let sessionsStore = { sessions: [], currentId: null };
    let isLoadingSessions = false;

    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
    }

    const isMobile = () => window.innerWidth < 768;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const uid = () => 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    function loadStore() {
      return sessionsStore;
    }

    function saveStore() {
      sessionsStore.currentId = currentSessionId;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentId: currentSessionId }));
    }

    function getSession(id) {
      return sessionsStore.sessions.find((s) => s.id === id) || null;
    }

    function closeHistoryActionMenu() {
      historyActionMenu.classList.remove('show');
      historyActionTargetId = null;
    }

    function openHistoryDialog(options) {
      if (!historyDialog || !historyDialogTitle || !historyDialogDesc || !historyDialogInput || !historyDialogOk) {
        if (options.showInput) {
          const v = window.prompt(options.description || options.title || '입력', options.defaultValue || '');
          return Promise.resolve(v === null ? null : v);
        }
        const ok = window.confirm(options.description || options.title || '확인');
        return Promise.resolve(ok);
      }
      const { title, description, showInput, defaultValue, okText } = options;
      historyDialogTitle.textContent = title || '확인';
      historyDialogDesc.textContent = description || '';
      historyDialogOk.textContent = okText || '확인';
      historyDialogInput.value = defaultValue || '';
      historyDialogInput.classList.toggle('hidden', !showInput);
      historyDialog.classList.add('show');

      if (showInput) {
        setTimeout(() => {
          historyDialogInput.focus();
          historyDialogInput.select();
        }, 0);
      } else {
        setTimeout(() => historyDialogOk.focus(), 0);
      }

      return new Promise((resolve) => {
        historyDialogResolver = resolve;
      });
    }

    function closeHistoryDialog(result) {
      if (historyDialogResolver) {
        historyDialogResolver(result);
        historyDialogResolver = null;
      }
      historyDialog.classList.remove('show');
    }

    async function removeSessionById(id) {
      try {
        await deleteSessionFromServer(id);
      } catch (err) {
        console.error('[MinsuGPT][deleteSession]', err);
        showError('채팅 삭제에 실패했습니다.');
        return false;
      }
      sessionsStore.sessions = sessionsStore.sessions.filter((s) => s.id !== id);
      if (sessionsStore.currentId === id) sessionsStore.currentId = sessionsStore.sessions[0]?.id || null;
      saveStore();
      if (!sessionsStore.currentId) {
        startNewChat();
      } else if (currentSessionId === id) {
        loadSession(sessionsStore.currentId);
      } else {
        renderSidebar();
      }
      return true;
    }

    async function duplicateSessionById(id) {
      const src = getSession(id);
      if (!src) return;
      const copy = {
        id: uid(),
        title: sessionTitle((src.title || '새 채팅') + ' 복제'),
        messages: JSON.parse(JSON.stringify(src.messages || [])),
        updatedAt: new Date().toISOString()
      };
      upsertSession(copy);
      try {
        await syncSessionToServer(copy);
      } catch (err) {
        console.error('[MinsuGPT][duplicateSession]', err);
      }
      loadSession(copy.id);
    }

    async function renameSessionById(id) {
      const target = getSession(id);
      if (!target) return;
      const renamed = await openHistoryDialog({
        title: '채팅 제목 편집',
        description: '새 제목을 입력하세요.',
        showInput: true,
        defaultValue: target.title || '',
        okText: '저장'
      });
      if (renamed === null) return;
      const value = renamed.trim();
      if (!value) return;
      target.title = value.length > 40 ? value.slice(0, 40) + '…' : value;
      target.updatedAt = new Date().toISOString();
      upsertSession(target);
      syncSessionToServer(target).catch((err) => console.error('[MinsuGPT][renameSession]', err));
      renderSidebar();
    }

    function openHistoryActionMenu(id, anchorEl) {
      historyActionTargetId = id;
      const rect = anchorEl.getBoundingClientRect();
      const top = Math.min(window.innerHeight - 140, Math.max(12, rect.top - 4));
      let left = rect.right + 8;
      if (left > window.innerWidth - 150) {
        left = Math.max(8, rect.left - 142);
      }
      historyActionMenu.style.top = `${top}px`;
      historyActionMenu.style.left = `${left}px`;
      historyActionMenu.classList.add('show');
    }

    function upsertSession(session) {
      const idx = sessionsStore.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) sessionsStore.sessions[idx] = session;
      else sessionsStore.sessions.unshift(session);
      sessionsStore.sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      sessionsStore.currentId = session.id;
      saveStore();
    }

    function sessionTitle(text) {
      const t = (text || '').replace(/\s+/g, ' ').trim();
      return t.length > 28 ? t.slice(0, 28) + '…' : (t || '새 채팅');
    }

    function updateNavActiveState() {
      const isNewChatState = !currentSessionId;
      newChatBtn.classList.toggle('nav-item-active', isNewChatState);
      mobileTopNewChat.classList.toggle('nav-item-active', isNewChatState);
      if (!isNewChatState) {
        mobileSearchBtn.classList.remove('nav-item-active');
      }
    }

    function renderSidebar() {
      const store = loadStore();
      updateNavActiveState();
      chatHistoryList.innerHTML = '';
      if (isLoadingSessions) {
        const loading = document.createElement('div');
        loading.className = 'history-loading-wrap';
        loading.innerHTML = `
          <div class="typing-dots" aria-label="채팅 기록 로딩 중">
            <span style="transform: translate(0px, 0px)"></span>
            <span style="transform: translate(11px, 0px)"></span>
            <span style="transform: translate(22px, 0px)"></span>
          </div>
        `;
        chatHistoryList.appendChild(loading);
        const dots = loading.querySelector('.typing-dots');
        if (dots) loading._stopAnim = bootTypingAnimation(dots);
        return;
      }
      if (!store.sessions.length) {
        const empty = document.createElement('p');
        empty.className = 'px-2 py-2 text-[11px] text-gray-400';
        empty.textContent = '채팅 기록이 없습니다';
        chatHistoryList.appendChild(empty);
        return;
      }
      store.sessions.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'history-item history-pill ripple-btn flex items-center rounded-lg';
        if (s.id === currentSessionId) row.classList.add('active');
        row.dataset.id = s.id;
        const main = document.createElement('div');
        main.className = 'history-main';
        const span = document.createElement('span');
        span.className = 'truncate text-gray-600 w-full text-[12px] block';
        span.textContent = s.title || '새 채팅';
        main.appendChild(span);
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'history-more-btn ripple-btn';
        moreBtn.innerHTML = '<i data-lucide="ellipsis" class="w-3.5 h-3.5"></i>';

        row.appendChild(main);
        row.appendChild(moreBtn);
        row.addEventListener('click', (e) => {
          if (e.target.closest('.history-more-btn')) return;
          closeHistoryActionMenu();
          loadSession(s.id);
        });
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (historyActionMenu.classList.contains('show') && historyActionTargetId === s.id) {
            closeHistoryActionMenu();
            return;
          }
          openHistoryActionMenu(s.id, moreBtn);
        });
        attachRipple(row);
        attachRipple(moreBtn);
        chatHistoryList.appendChild(row);
      });
      renderRoundedIcons(chatHistoryList);
    }

    function showWelcomeLayout() {
      mainPanel.classList.add('welcome-mode');
      mainPanel.classList.remove('chat-mode');
      welcomeBlock.classList.remove('hidden');
      chatMessages.classList.add('hidden');
      chatMessages.classList.remove('min-h-[100px]', 'chat-active');
      chatMessages.innerHTML = '';
      mainPanel.classList.remove('justify-end', 'pt-4');
      if (!gradientFrozen) startGradientAnimation();
    }

    function showChatLayout() {
      mainPanel.classList.remove('welcome-mode');
      mainPanel.classList.add('chat-mode');
      welcomeBlock.classList.add('hidden');
      chatMessages.classList.remove('hidden');
      chatMessages.classList.add('min-h-[100px]', 'chat-active');
      mainPanel.classList.add('pt-4');
    }

    function setGradientVars(v) {
      mainPanel.style.setProperty('--grad-x1', v.x1 + '%');
      mainPanel.style.setProperty('--grad-y1', v.y1 + '%');
      mainPanel.style.setProperty('--grad-x2', v.x2 + '%');
      mainPanel.style.setProperty('--grad-y2', v.y2 + '%');
      mainPanel.style.setProperty('--grad-c1', v.c1);
      mainPanel.style.setProperty('--grad-c2', v.c2);
    }

    function gradientStateAt(t) {
      const p = t / 1000;
      const m = (a, b, s) => Math.round(a + (b - a) * s);
      const s1 = (Math.sin(p * 0.55) + 1) / 2;
      const s2 = (Math.sin(p * 0.48 + 1.6) + 1) / 2;
      const s3 = (Math.sin(p * 0.43 + 0.7) + 1) / 2;
      return {
        x1: 34 + s1 * 20,
        y1: 28 + s2 * 18,
        x2: 62 + s2 * 16,
        y2: 56 + s3 * 18,
        c1: `rgb(${m(194, 227, s1)}, ${m(216, 241, s2)}, ${m(255, 255, s3)})`,
        c2: `rgb(${m(255, 247, s2)}, ${m(207, 224, s1)}, ${m(233, 246, s3)})`
      };
    }

    function startGradientAnimation() {
      if (gradientRAF || gradientFrozen) return;
      const tick = (now) => {
        if (gradientFrozen) {
          gradientRAF = null;
          return;
        }
        setGradientVars(gradientStateAt(now - gradientTickStart));
        gradientRAF = requestAnimationFrame(tick);
      };
      gradientRAF = requestAnimationFrame(tick);
    }

    function freezeGradientNow() {
      gradientFrozen = true;
      if (gradientRAF) {
        cancelAnimationFrame(gradientRAF);
        gradientRAF = null;
      }
    }

    function triggerGradientWave() {
      if (!mainPanel.classList.contains('chat-mode')) return;
      if (gradientWaveTimer) {
        clearTimeout(gradientWaveTimer);
        gradientWaveTimer = null;
      }
      mainPanel.classList.remove('gradient-wave');
      void mainPanel.offsetWidth;
      mainPanel.classList.add('gradient-wave');
      gradientWaveTimer = setTimeout(() => {
        mainPanel.classList.remove('gradient-wave');
        gradientWaveTimer = null;
      }, 1520);
    }

    function collectSearchResults(keyword) {
      const q = (keyword || '').trim().toLowerCase();
      const store = loadStore();
      const sessions = store.sessions || [];
      return sessions
        .map((s) => {
          const text = (s.messages || []).map((m) => {
            const norm = normalizeHistoryMessage(m);
            const body = norm.role === 'assistant' ? assistantActiveContent(norm) : norm.content;
            return `${norm.role === 'user' ? '나' : 'AI'}: ${body}`;
          }).join('\n');
          const title = (s.title || '새 채팅');
          const whole = `${title}\n${text}`.toLowerCase();
          if (!q || whole.includes(q)) {
            return {
              id: s.id,
              title,
              excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 120) || '대화 내용이 없습니다.',
              full: text || '대화 내용이 없습니다.',
              updatedAt: s.updatedAt
            };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    function renderSearchPreview(item) {
      if (!item) {
        searchPreview.innerHTML = '<p class="text-sm text-gray-400">검색 결과를 선택하세요.</p>';
        return;
      }
      const md = typeof marked !== 'undefined'
        ? marked.parse(item.full || '')
        : (item.full || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
      searchPreview.innerHTML = `
        <h3 class="text-[15px] font-medium text-gray-800 mb-2">${item.title}</h3>
        <div class="md-body text-[13px] text-gray-600 leading-relaxed">${md}</div>
      `;
    }

    function renderSearchResults(keyword) {
      const results = collectSearchResults(keyword);
      searchResults.innerHTML = '';
      if (!results.length) {
        searchResults.innerHTML = '<p class="text-[13px] text-gray-400 px-1 py-2">검색 결과가 없습니다.</p>';
        renderSearchPreview(null);
        return;
      }
      results.forEach((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'search-item w-full text-left';
        row.innerHTML = `
          <p class="text-[13px] font-medium text-gray-700 truncate">${item.title}</p>
          <p class="text-[12px] text-gray-500 mt-1 line-clamp-2">${item.excerpt}</p>
        `;
        row.addEventListener('click', () => {
          if (!isMobile()) {
            searchResults.querySelectorAll('.search-item').forEach((el) => el.classList.remove('active'));
            row.classList.add('active');
            renderSearchPreview(item);
          } else {
            closeSearchModal();
            loadSession(item.id);
          }
        });
        row.addEventListener('dblclick', () => {
          closeSearchModal();
          loadSession(item.id);
        });
        searchResults.appendChild(row);
        if (idx === 0 && !isMobile()) {
          row.classList.add('active');
          renderSearchPreview(item);
        }
      });
    }

    function openSearchModal() {
      searchModal.classList.add('show');
      renderSearchResults('');
      searchInput.value = '';
      setTimeout(() => searchInput.focus(), 0);
      if (isMobile()) closeMobileSidebar();
    }

    function closeSearchModal() {
      searchModal.classList.remove('show');
    }

    function syncProfileAvatarFromName() {
      if (!profileNameEl || !profileAvatarEl) return;
      const displayName = (authUser && (authUser.name || authUser.username)) || '게스트';
      profileNameEl.textContent = displayName;
      const name = displayName.trim();
      const first = name ? Array.from(name)[0] : 'G';
      profileAvatarEl.textContent = first;
    }

    historyActionEdit.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!historyActionTargetId) return;
      await renameSessionById(historyActionTargetId);
      closeHistoryActionMenu();
    });
    historyActionDuplicate.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!historyActionTargetId) return;
      const targetId = historyActionTargetId;
      await duplicateSessionById(targetId);
      closeHistoryActionMenu();
    });
    historyActionDelete.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!historyActionTargetId) return;
      const targetId = historyActionTargetId;
      const ok = await openHistoryDialog({
        title: '채팅 삭제',
        description: '이 채팅을 삭제할까요? 이 작업은 되돌릴 수 없습니다.',
        showInput: false,
        okText: '삭제'
      });
      if (!ok) return;
      const removed = await removeSessionById(targetId);
      if (!removed) return;
      closeHistoryActionMenu();
    });
    historyDialogCancel.addEventListener('click', () => closeHistoryDialog(null));
    historyDialogOk.addEventListener('click', () => {
      const val = historyDialogInput.classList.contains('hidden') ? true : historyDialogInput.value;
      closeHistoryDialog(val);
    });
    historyDialog.addEventListener('click', (e) => {
      if (e.target === historyDialog) closeHistoryDialog(null);
    });
    historyDialogInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closeHistoryDialog(historyDialogInput.value);
      }
    });
    document.addEventListener('click', (e) => {
      if (!historyActionMenu.classList.contains('show')) return;
      if (e.target.closest('#history-action-menu') || e.target.closest('.history-more-btn')) return;
      closeHistoryActionMenu();
    });

    function showError(msg) {
      chatError.textContent = msg;
      chatError.classList.remove('hidden');
    }

    function hideError() {
      chatError.classList.add('hidden');
      chatError.textContent = '';
    }

    function scrollChatToBottom() {
      if (!chatMessages) return;
      const run = () => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      };
      run();
      requestAnimationFrame(() => requestAnimationFrame(run));
    }

    function renderMarkdown(text) {
      if (!text) return '<div class="md-body"></div>';
      const html = typeof marked !== 'undefined'
        ? marked.parse(text)
        : text.replace(/</g, '&lt;').replace(/\n/g, '<br>');
      return '<div class="md-body">' + html + '</div>';
    }

    function setAssistantHtml(bubble, text) {
      bubble.innerHTML = renderMarkdown(text);
      scrollChatToBottom();
    }

    async function copyTextToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text || '');
        return true;
      } catch {
        return false;
      }
    }

    function flashCheckIcon(btn, ms) {
      const icon = btn.querySelector('iconify-icon');
      if (!icon) return;
      const original = icon.getAttribute('icon');
      icon.setAttribute('icon', iconNameMap('check'));
      setTimeout(() => {
        if (icon.isConnected) icon.setAttribute('icon', original || iconNameMap('copy'));
      }, ms || 1000);
    }

    function updateUserActionVisibility() {
      const wraps = Array.from(chatMessages.querySelectorAll('.user-msg-wrap'));
      wraps.forEach((w) => w.classList.remove('latest-user'));
      if (wraps.length) wraps[wraps.length - 1].classList.add('latest-user');
    }

    function resizeUserEditTextarea(ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(240, Math.max(72, ta.scrollHeight)) + 'px';
    }

    function cancelUserInlineEdit(wrap, bubble, originalText) {
      wrap.classList.remove('is-editing');
      bubble.classList.remove('editing');
      bubble.textContent = originalText;
    }

    function startUserInlineEdit(wrap, bubble) {
      if (!wrap.classList.contains('latest-user') || wrap.classList.contains('is-editing')) return;
      if (isSending || isRegenerating) return;
      const originalText = (bubble.textContent || '').trim();
      wrap.classList.add('is-editing');
      bubble.classList.add('editing');
      bubble.textContent = '';
      const ta = document.createElement('textarea');
      ta.className = 'user-edit-textarea';
      ta.value = originalText;
      const footer = document.createElement('div');
      footer.className = 'user-edit-footer';
      footer.innerHTML = `
        <button type="button" class="user-edit-btn cancel ripple-btn">취소</button>
        <button type="button" class="user-edit-btn confirm ripple-btn">확인</button>
      `;
      bubble.appendChild(ta);
      bubble.appendChild(footer);
      footer.querySelectorAll('.ripple-btn').forEach(attachRipple);
      resizeUserEditTextarea(ta);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      const commit = async () => {
        const newText = ta.value.trim();
        if (!newText || isSending || isRegenerating) return;
        const idx = wrap._historyIndex;
        if (typeof idx !== 'number') return;
        wrap.classList.remove('is-editing');
        bubble.classList.remove('editing');
        chatHistory = chatHistory.slice(0, idx);
        reRenderChatFromHistory();
        await sendMessage(newText);
      };

      footer.querySelector('.cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        cancelUserInlineEdit(wrap, bubble, originalText);
      });
      footer.querySelector('.confirm').addEventListener('click', (e) => {
        e.stopPropagation();
        commit();
      });
      ta.addEventListener('input', () => resizeUserEditTextarea(ta));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelUserInlineEdit(wrap, bubble, originalText);
        }
      });
    }

    function reRenderChatFromHistory() {
      chatMessages.innerHTML = '';
      chatHistory.forEach((m, i) => {
        if (m.role === 'user') {
          appendMessage('user', m.content, { historyIndex: i });
          return;
        }
        const norm = normalizeAssistantMessage(m);
        const prevUser = chatHistory[i - 1]?.role === 'user' ? chatHistory[i - 1].content : '';
        appendMessage('assistant', assistantActiveContent(norm), {
          historyIndex: i,
          versions: norm.versions,
          versionIndex: norm.versionIndex,
          sourceUserText: prevUser
        });
      });
      updateUserActionVisibility();
      updateAssistantActionVisibility();
      scrollChatToBottom();
    }
