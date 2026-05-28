if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html ??this module cannot run alone.");
}
async function streamAssistantReply(bubble, fullText) {
      const body = document.createElement('div');
      body.className = 'md-body';
      bubble.innerHTML = '';
      bubble.appendChild(body);

      const segments = parseContentSegments(fullText);
      const tableSlots = [];

      for (const seg of segments) {
        if (seg.type === 'text') {
          await streamTextWithFade(body, seg.content);
        } else {
          const slot = createTablePlaceholder(body, seg.content);
          tableSlots.push(slot);
          await sleep(520);
        }
      }

      const tail = body.querySelector('.md-stream-tail');
      if (tail) tail.remove();

      for (const slot of tableSlots) {
        if (slot._stopAnim) slot._stopAnim();
        const md = slot.dataset.tableMd || '';
        const block = document.createElement('div');
        block.className = 'md-frozen-block';
        appendMarkdownBlock(block, md);
        slot.replaceWith(block);
        scrollChatToBottom();
        await sleep(120);
      }

      setAssistantHtml(bubble, fullText);
      const wrap = bubble.closest('.assistant-msg-wrap');
      if (wrap) {
        wrap.classList.remove('actions-pending');
        wrap.classList.add('actions-ready');
        updateVersionNav(wrap, wrap.querySelector('.assistant-actions'));
        updateAssistantActionVisibility();
      }
    }

    function createLoadingBubble() {
      const wrap = document.createElement('div');
      wrap.className = 'flex w-full justify-start';
      const bubble = document.createElement('div');
      bubble.className = 'msg-assistant';
      wrap.appendChild(bubble);
      chatMessages.appendChild(wrap);
      scrollChatToBottom();
      const stop = mountTypingLoader(bubble);
      loadingAnimStop = stop;
      return { wrap, bubble, stop };
    }

    function stopLoading(loader) {
      if (loader && loader.stop) loader.stop();
      else if (loadingAnimStop) {
        loadingAnimStop();
      }
      loadingAnimStop = null;
    }

    function appendMessage(role, content, opts) {
      opts = opts || {};
      const wrap = document.createElement('div');
      wrap.className = 'flex w-full ' + (role === 'user' ? 'justify-end' : 'justify-start max-w-full');
      if (typeof opts.historyIndex === 'number') wrap._historyIndex = opts.historyIndex;
      const bubble = document.createElement('div');
      if (role === 'user') {
        wrap.classList.add('user-msg-wrap');
        bubble.className = 'msg-user text-[14px] leading-relaxed';
        bubble.textContent = content;
      } else {
        wrap.classList.add('assistant-msg-wrap');
        bubble.className = 'msg-assistant text-[14px] leading-relaxed';
        const versions = opts.versions || [content];
        const versionIndex = typeof opts.versionIndex === 'number'
          ? opts.versionIndex
          : versions.length - 1;
        setAssistantHtml(bubble, versions[versionIndex] || content);
      }
      wrap.appendChild(bubble);
      if (role === 'user') {
        attachUserActions(wrap, bubble);
      }
      if (role === 'assistant') {
        attachAssistantActions(wrap, bubble, opts.sourceUserText || '');
        if (opts.deferActions) wrap.classList.add('actions-pending');
        else wrap.classList.add('actions-ready');
      }
      chatMessages.appendChild(wrap);
      scrollChatToBottom();
      if (role === 'user') updateUserActionVisibility();
      if (role === 'assistant') updateAssistantActionVisibility();
      return { bubble, wrap };
    }

    function persistCurrentSession() {
      if (!currentSessionId) return;
      const existing = getSession(currentSessionId);
      if (!existing) return;
      existing.messages = serializeHistoryForStore();
      existing.updatedAt = new Date().toISOString();
      upsertSession(existing);
      renderSidebar();
      syncSessionToServer(existing).catch((err) => console.error('[MinsuGPT][persistSession]', err));
    }

    function ensureSession(firstUserText) {
      if (currentSessionId && getSession(currentSessionId)) return;
      const session = {
        id: uid(),
        title: sessionTitle(firstUserText),
        messages: [],
        updatedAt: new Date().toISOString()
      };
      currentSessionId = session.id;
      upsertSession(session);
      renderSidebar();
      syncSessionToServer(session).catch((err) => console.error('[MinsuGPT][createSession]', err));
    }

    function clearChatView() {
      chatMessages.innerHTML = '';
      chatHistory = [];
      hideError();
    }

    function startNewChat() {
      stopLoading();
      isSending = false;
      currentSessionId = null;
      gradientFrozen = false;
      gradientTickStart = performance.now();
      saveStore();
      clearChatView();
      showWelcomeLayout();
      renderSidebar();
      chatInput.value = '';
      chatInput.style.height = '24px';
      chatInput.dispatchEvent(new Event('input'));
      chatInput.focus();
      if (isMobile()) closeMobileSidebar();
    }

    function loadSession(id) {
      const session = getSession(id);
      if (!session) return;
      stopLoading();
      currentSessionId = id;
      saveStore();
      clearChatView();
      chatHistory = (session.messages || []).map((m) => normalizeHistoryMessage(m));
      if (chatHistory.length) {
        showChatLayout();
        reRenderChatFromHistory();
        scrollChatToBottom();
      } else {
        showWelcomeLayout();
      }
      renderSidebar();
      hideError();
      if (isMobile()) closeMobileSidebar();
    }

    function setSendLoading(loading) {
      isSending = loading;
      syncRegenButtonsBusy();
      sendBtn.disabled = loading || chatInput.value.trim().length === 0;
      if (loading) {
        sendBtn.classList.add('opacity-60', 'pointer-events-none');
      } else {
        sendBtn.classList.remove('opacity-60', 'pointer-events-none');
        chatInput.dispatchEvent(new Event('input'));
      }
    }

    async function sendMessage(overrideText) {
      const text = (overrideText != null ? String(overrideText) : chatInput.value).trim();
      if (!text || isSending) return;
      if (!gradientFrozen && chatHistory.length === 0) freezeGradientNow();

      hideError();
      ensureSession(text);
      showChatLayout();
      const userResult = appendMessage('user', text);
      const userWrap = userResult.wrap;

      const session = getSession(currentSessionId);
      if (session && session.title === '새 채팅') {
        session.title = sessionTitle(text);
        upsertSession(session);
        syncSessionToServer(session).catch((err) => console.error('[MinsuGPT][titleSync]', err));
        renderSidebar();
      }

      if (overrideText == null) {
        chatInput.value = '';
        chatInput.style.height = '24px';
      }
      setSendLoading(true);

      const loader = createLoadingBubble();
      scrollChatToBottom();

      try {
        const res = await fetch(API_BASE + '/api/ai/chat', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({
            message: text,
            messages: historyForApi(),
            system_prompt: (
              '당신은 MinsuGPT입니다. 누구나 사용할 수 있는 친절한 AI 도우미입니다. ' +
              '항상 한국어로 간결하고 따뜻하게 답하세요. 마크다운(표, 목록, 굵게)으로 보기 좋게 답하세요. ' +
              '시간표·급식·학사일정 질문은 제공된 도구 결과만 사용하고, 없으면 임의로 만들지 마세요.'
            )
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || ('서버 오류 (' + res.status + ')'));
        }

        const reply = (data.reply || '').trim();
        if (!reply) throw new Error('AI 응답이 비어 있습니다.');

        stopLoading(loader);
        loader.wrap.remove();

        chatHistory.push({ role: 'user', content: text });
        userWrap._historyIndex = chatHistory.length - 1;
        persistCurrentSession();

        const assistantResult = appendMessage('assistant', '', {
          sourceUserText: text,
          deferActions: true,
          historyIndex: chatHistory.length
        });
        const assistantWrap = assistantResult.wrap;
        const bubble = assistantResult.bubble;

        await streamAssistantReply(bubble, reply);
        triggerGradientWave();

        chatHistory.push({ role: 'assistant', versions: [reply], versionIndex: 0 });
        assistantWrap._historyIndex = chatHistory.length - 1;
        updateVersionNav(assistantWrap, assistantWrap.querySelector('.assistant-actions'));
        persistCurrentSession();
      } catch (err) {
        stopLoading(loader);
        loader.wrap.remove();
        showError(err.message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        console.error('[MinsuGPT]', err);
      } finally {
        setSendLoading(false);
        scrollChatToBottom();
        chatInput.focus();
      }
    }

    newChatBtn.addEventListener('click', startNewChat);
    mobileTopNewChat.addEventListener('click', startNewChat);
    mobileTopMore.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!currentSessionId || !getSession(currentSessionId)) {
        openMobileSidebar();
        return;
      }
      openHistoryActionMenu(currentSessionId, mobileTopMore);
    });
    searchBtn.addEventListener('click', openSearchModal);
    searchInput.addEventListener('input', (e) => renderSearchResults(e.target.value));
    searchClose.addEventListener('click', closeSearchModal);
    searchModal.addEventListener('click', (e) => {
      if (e.target === searchModal) closeSearchModal();
    });
    libraryBtn.addEventListener('click', () => {
      showError('라이브러리는 준비 중입니다.');
      setTimeout(hideError, 1500);
      if (isMobile()) closeMobileSidebar();
    });

    function closeProfileMenu() {
      if (!profileMenu) return;
      profileMenu.classList.remove('show');
    }

    function openProfileMenu(anchorEl) {
      if (!profileMenu || !anchorEl) return;
      profileMenu.style.visibility = 'hidden';
      profileMenu.style.display = 'block';
      const rect = anchorEl.getBoundingClientRect();
      const menuRect = profileMenu.getBoundingClientRect();
      profileMenu.style.display = '';
      profileMenu.style.visibility = '';

      const top = Math.min(window.innerHeight - (menuRect.height || 98) - 10, rect.bottom + 6);
      let left = rect.right - (menuRect.width || 138);
      if (left > window.innerWidth - (menuRect.width || 138) - 8) left = window.innerWidth - (menuRect.width || 138) - 8;
      profileMenu.style.top = top + 'px';
      profileMenu.style.left = Math.max(8, left) + 'px';
      profileMenu.classList.add('show');
      renderRoundedIcons(profileMenu);
    }

    function triggerLogout() {
      if (authReverifyTimer) {
        window.clearInterval(authReverifyTimer);
        authReverifyTimer = null;
      }
      clearAuthSession();
      window.top.location.href = loginPageUrl();
    }

    if (profileMenuTrigger) {
      profileMenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!profileMenu) return;
        if (profileMenu.classList.contains('show')) closeProfileMenu();
        else openProfileMenu(profileMenuTrigger);
      });
    }
    if (profileMenuTriggerBtn) {
      profileMenuTriggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!profileMenu) return;
        if (profileMenu.classList.contains('show')) closeProfileMenu();
        else openProfileMenu(profileMenuTriggerBtn);
      });
    }
    if (profileMenuSettingsBtn) {
      profileMenuSettingsBtn.addEventListener('click', () => {
        closeProfileMenu();
        showError('설정은 준비 중입니다.');
        setTimeout(hideError, 1400);
      });
    }
    if (profileMenuLogoutBtn) {
      profileMenuLogoutBtn.addEventListener('click', () => {
        closeProfileMenu();
        triggerLogout();
      });
    }
    document.addEventListener('click', (e) => {
      if (!profileMenu || !profileMenu.classList.contains('show')) return;
      if (e.target.closest('#profile-menu') || e.target.closest('#profile-menu-trigger') || e.target.closest('#profile-menu-trigger-btn')) return;
      closeProfileMenu();
    });

    (async function init() {
      const auth = await ensureAuthOrRedirect();
      if (!auth) return;
      isLoadingSessions = true;
      renderSidebar();
      try {
        await fetchRemoteSessions();
      } catch (err) {
        console.error('[MinsuGPT][loadSessions]', err);
        showError('채팅 기록을 불러오지 못했습니다.');
      } finally {
        isLoadingSessions = false;
      }
      sessionsStore.currentId = null;
      currentSessionId = null;
      saveStore();
      renderSidebar();
      syncProfileAvatarFromName();
      startAuthStatusPolling();
      startGradientAnimation();
      showWelcomeLayout();
    })();

    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const sidebarCloseMobile = document.getElementById('sidebar-close-mobile');
    const menuBtnWrap = document.getElementById('mobile-menu-btn-wrap');
    const mobileTopActions = document.getElementById('mobile-top-actions');

    function openMobileSidebar() {
      // 버튼 숨기기
      if (menuBtnWrap) menuBtnWrap.style.display = 'none';
      if (mobileTopActions) mobileTopActions.style.display = 'none';

      sidebar.style.transition = 'none';
      sidebar.style.transform = 'translateX(-100%)';
      sidebar.classList.remove('hidden');
      sidebarBackdrop.style.opacity = '0';
      sidebarBackdrop.classList.remove('hidden');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sidebar.style.transition = '';
          sidebar.style.transform = 'translateX(0)';
          sidebarBackdrop.style.opacity = '1';
        });
      });
    }

    function closeMobileSidebar() {
      sidebar.style.transition = '';
      sidebar.style.transform = 'translateX(-100%)';
      sidebarBackdrop.style.opacity = '0';
      setTimeout(() => {
        sidebar.classList.add('hidden');
        sidebarBackdrop.classList.add('hidden');
        // 버튼 다시 보이기
        if (menuBtnWrap) menuBtnWrap.style.display = '';
        if (mobileTopActions) mobileTopActions.style.display = '';
      }, 380);
    }

    function handleResize() {
      if (isMobile()) {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('sidebar-mini');
        sidebar.style.transform = 'translateX(-100%)';
      } else {
        sidebar.classList.remove('hidden');
        sidebar.style.transform = 'translateX(0)';
      }
    }
    window.addEventListener('resize', handleResize);
    handleResize(); // 즉시 실행 (DOMContentLoaded 이미 지난 경우 대비)

    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function() {
        if (isMobile()) {
          closeMobileSidebar();
        } else {
          sidebar.classList.toggle('sidebar-mini');
        }
      });
    }

    mobileMenuOpen.addEventListener('click', function() {
      openMobileSidebar();
    });

    sidebarCloseMobile.addEventListener('click', function() {
      closeMobileSidebar();
    });

    sidebarBackdrop.addEventListener('click', function() {
      closeMobileSidebar();
    });

    let touchStartX = 0;
    let touchCurrentX = 0;
    let isSwiping = false;

    sidebar.addEventListener('touchstart', function(e) {
      if (!isMobile()) return;
      touchStartX = e.changedTouches[0].clientX;
      touchCurrentX = touchStartX;
      isSwiping = true;
      sidebar.style.transition = 'none';
      sidebarBackdrop.style.transition = 'none';
    }, { passive: true });

    sidebar.addEventListener('touchmove', function(e) {
      if (!isMobile() || !isSwiping) return;
      touchCurrentX = e.changedTouches[0].clientX;
      const dx = touchCurrentX - touchStartX;
      if (dx < 0) {
        sidebar.style.transform = 'translateX(' + dx + 'px)';
        const progress = Math.min(1, Math.abs(dx) / window.innerWidth);
        sidebarBackdrop.style.opacity = String(1 - progress);
      }
    }, { passive: true });

    sidebar.addEventListener('touchend', function(e) {
      if (!isMobile() || !isSwiping) return;
      isSwiping = false;
      sidebar.style.transition = '';
      sidebarBackdrop.style.transition = '';
      const dx = touchCurrentX - touchStartX;
      if (dx < -60) {
        closeMobileSidebar();
      } else {
        sidebar.style.transform = 'translateX(0)';
        sidebarBackdrop.style.opacity = '1';
      }
    }, { passive: true });

    chatInput.addEventListener('input', function() {
      if (this.value.trim().length > 0) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
        sendBtn.classList.add('bg-[#74b9ff]', 'text-white', 'cursor-pointer', 'shadow-sm');
      } else {
        sendBtn.disabled = true;
        sendBtn.classList.remove('bg-[#74b9ff]', 'text-white', 'cursor-pointer', 'shadow-sm');
        sendBtn.classList.add('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
      }

      this.style.height = '24px'; 
      let nextHeight = this.scrollHeight;
      this.style.height = (this.value === '') ? '24px' : nextHeight + 'px';
    });

    sendBtn.addEventListener('click', () => sendMessage());

    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this.value.trim().length > 0) sendMessage();
      }
    });

    window.addEventListener('keydown', function(e) {
      if (e.isComposing) return;
      const target = e.target;
      const isInputLike = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      const key = (e.key || '').toLowerCase();

      if (e.ctrlKey && e.shiftKey && key === 'd') {
        e.preventDefault();
        e.stopPropagation();
        startNewChat();
        return;
      }

      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && key === 'f') {
        if (isInputLike || (searchModal && searchModal.classList.contains('show'))) return;
        e.preventDefault();
        e.stopPropagation();
        openSearchModal();
      }
    }, true);

    // ── 모바일 키보드 대응: visualViewport로 키보드 높이 감지 → main-panel 높이 조정 ──
    if (window.visualViewport && isMobile()) {
      function onViewportResize() {
        if (!isMobile()) return;
        const kbHeight = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
        if (kbHeight > 50) {
          // 키보드 올라옴: body 하단 패딩을 키보드 높이만큼 줘서 입력창이 위로 밀림
          document.body.style.paddingBottom = kbHeight + 'px';
          // 채팅이면 스크롤 맨 아래로
          if (!chatMessages.classList.contains('hidden')) {
            setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
          }
        } else {
          document.body.style.paddingBottom = 'env(safe-area-inset-bottom)';
        }
      }
      window.visualViewport.addEventListener('resize', onViewportResize);
      window.visualViewport.addEventListener('scroll', onViewportResize);
    }

    document.querySelectorAll('.ripple-btn').forEach(attachRipple);
