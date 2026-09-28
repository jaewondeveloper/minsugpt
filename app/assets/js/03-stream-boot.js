if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html — this module cannot run alone.");
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

    // 오류/연결 실패 메시지를 모달이나 배너 대신, AI가 말하듯 채팅창에 스트리밍으로 표시
    async function streamAssistantErrorMessage(message) {
      const wrap = document.createElement('div');
      wrap.className = 'flex w-full justify-start';
      const bubble = document.createElement('div');
      bubble.className = 'msg-assistant msg-assistant-error text-[14px] leading-relaxed';
      wrap.appendChild(bubble);
      chatMessages.appendChild(wrap);
      scrollChatToBottom();
      await streamAssistantReply(bubble, message);
      scrollChatToBottom();
      return wrap;
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
        if (!content) bubble.style.display = 'none'; // 텍스트 없이 파일만 보낸 경우 빈 말풍선을 감춘다
      } else {
        wrap.classList.add('assistant-msg-wrap');
        bubble.className = 'msg-assistant text-[14px] leading-relaxed';
        const versions = opts.versions || [content];
        const versionIndex = typeof opts.versionIndex === 'number'
          ? opts.versionIndex
          : versions.length - 1;
        setAssistantHtml(bubble, versions[versionIndex] || content);
      }
      if (role === 'assistant' && opts.toolLog && opts.toolLog.length) {
        wrap.appendChild(createToolLogButton(opts.toolLog));
      }
      if (role === 'user' && opts.files && opts.files.length) {
        wrap.appendChild(createMessageFilesRow(opts.files));
      }
      wrap.appendChild(bubble);
      if (role === 'user') {
        attachUserActions(wrap, bubble);
      }
      if (role === 'assistant') {
        attachAssistantActions(wrap, bubble, opts.sourceUserText || '');
        if (opts.deferActions) wrap.classList.add('actions-pending');
        else wrap.classList.add('actions-ready');
        if (opts.editedFiles && opts.editedFiles.length) {
          wrap.appendChild(createToolFileResultsRow(opts.editedFiles));
        }
      }
      chatMessages.appendChild(wrap);
      if (role === 'user') updateUserBubbleShape(bubble); // DOM에 붙은 뒤라야 실제 줄 수를 잴 수 있다
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
      checkPendingForSession(id).catch((err) => console.error('[MinsuGPT][pendingCheck]', err));
    }

    // 전송 버튼은 상태에 따라 세 모습을 오간다.
    // hidden: 입력이 비어있을 때 (폭 0으로 접힘, 클릭 불가)
    // ready:  입력이 있을 때 (그라데이션 알약, 전송 아이콘)
    // stop:   응답을 기다리는 중 (검정 알약, 안쪽이 채워진 사각형 정지 아이콘 → 누르면 응답 중단)
    const SEND_BTN_SIZE_CLASSES = ['min-w-[54px]', 'px-4', 'ml-1.5', 'opacity-100'];
    const SEND_BTN_HIDDEN_CLASSES = ['w-0', 'min-w-0', 'px-0', 'ml-0', 'opacity-0', 'pointer-events-none', 'bg-gray-100', 'text-gray-400', 'cursor-not-allowed'];
    const SEND_BTN_READY_CLASSES = ['send-btn-gradient', 'text-white', 'cursor-pointer'];
    const SEND_BTN_STOP_CLASSES = ['bg-gray-900', 'text-white', 'cursor-pointer'];

    function setSendBtnState(state) {
      sendBtn.classList.remove(
        ...SEND_BTN_HIDDEN_CLASSES, ...SEND_BTN_READY_CLASSES, ...SEND_BTN_STOP_CLASSES, ...SEND_BTN_SIZE_CLASSES
      );
      if (state === 'hidden') {
        sendBtn.disabled = true;
        sendBtn.classList.add(...SEND_BTN_HIDDEN_CLASSES);
      } else {
        sendBtn.disabled = false;
        sendBtn.classList.add(...SEND_BTN_SIZE_CLASSES, ...(state === 'stop' ? SEND_BTN_STOP_CLASSES : SEND_BTN_READY_CLASSES));
      }
      if (sendBtnIcon) {
        sendBtnIcon.setAttribute('icon', state === 'stop' ? iconNameMap('square-stop') : iconNameMap('send'));
      }
    }

    function setSendLoading(loading) {
      isSending = loading;
      syncRegenButtonsBusy();
      if (loading) {
        setSendBtnState('stop');
      } else {
        setSendBtnState(chatInput.value.trim().length > 0 ? 'ready' : 'hidden');
      }
    }

    // 응답을 기다리는 중(정지 버튼 상태)에 사용자가 클릭하면 진행 중인 스트림을 끊는다.
    function stopGeneration() {
      if (activeAbortController) activeAbortController.abort();
    }

    async function sendMessage(overrideText) {
      const text = (overrideText != null ? String(overrideText) : chatInput.value).trim();
      if (!text || isSending) return;
      if (!gradientFrozen && chatHistory.length === 0) freezeGradientNow();

      hideError();
      ensureSession(text);
      showChatLayout();

      // 첨부/토글은 메시지 하나당 한 번만 쓴다 - 지금 붙어있는 첨부 파일을 먼저
      // 그대로 떼어내서(스냅샷) 말풍선 미리보기와 요청 본문에 함께 쓰고,
      // 입력 UI는 바로 원래 상태로 되돌린다(칩 비우기, 토글 끄기).
      const attachedFilesSnapshot = attachedFiles.slice();
      const requestFileIds = attachedFilesSnapshot.map((f) => f.file_id);
      const requestReasoningEffort = reasoningEffortOn ? 'high' : null;
      const requestForceSearch = searchOn;
      clearAttachedFiles();
      setReasoningEffort(false);
      setSearchOn(false);
      closeAttachPanel();

      const userResult = appendMessage('user', text, { files: attachedFilesSnapshot });
      const userWrap = userResult.wrap;

      // 응답을 기다리지 않고 사용자 메시지를 먼저 기록/저장한다.
      // → 서버는 이 시점 이후 백그라운드에서 계속 답을 생성하므로,
      //   중간에 페이지를 나가도 최소한 보낸 메시지는 항상 남아있다.
      const historyBeforeThis = historyForApi();
      chatHistory.push({ role: 'user', content: text, files: attachedFilesSnapshot });
      userWrap._historyIndex = chatHistory.length - 1;
      persistCurrentSession();

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
      const controller = new AbortController();
      activeAbortController = controller;

      const sessionIdForRequest = currentSessionId;
      const assistantResult = appendMessage('assistant', '', {
        sourceUserText: text,
        deferActions: true,
        historyIndex: chatHistory.length
      });
      const assistantWrap = assistantResult.wrap;
      const bubble = assistantResult.bubble;
      const stopDots = mountTypingLoader(bubble);
      const toolTracker = createLiveToolTracker(assistantWrap);
      scrollChatToBottom();

      const requestBody = {
        message: text,
        messages: historyBeforeThis,
        session_id: sessionIdForRequest,
        system_prompt: AI_SYSTEM_PROMPT
      };
      if (requestFileIds.length) requestBody.file_ids = requestFileIds;
      if (requestReasoningEffort) requestBody.reasoning_effort = requestReasoningEffort;
      if (requestForceSearch) requestBody.force_search = true;

      let accumulated = '';
      let gotFirstToken = false;

      try {
        await requestAiChatStream(
          requestBody,
          {
            onTool: (payload) => toolTracker.addEvent(payload),
            onToken: (chunk) => {
              if (!gotFirstToken) { stopDots(); toolTracker.markStreaming(); gotFirstToken = true; }
              accumulated += chunk;
              if (currentSessionId === sessionIdForRequest) {
                setAssistantHtml(bubble, accumulated);
              }
            },
            onDone: () => {
              const finalText = accumulated.trim() || '죄송해요, 응답을 생성하지 못했어요.';
              if (currentSessionId === sessionIdForRequest) {
                setAssistantHtml(bubble, finalText);
                chatHistory.push({
                  role: 'assistant', versions: [finalText], versionIndex: 0,
                  toolLog: toolTracker.getLog(), editedFiles: toolTracker.getEditedFiles()
                });
                assistantWrap._historyIndex = chatHistory.length - 1;
                if (toolTracker.getEditedFiles().length) {
                  assistantWrap.appendChild(createToolFileResultsRow(toolTracker.getEditedFiles()));
                }
                finalizeAssistantWrap(assistantWrap);
                triggerGradientWave();
                persistCurrentSession();
              } else {
                assistantWrap.remove();
                appendAssistantReplyToStoredSession(sessionIdForRequest, finalText);
              }
            },
            // 정지 버튼으로 사용자가 직접 중단한 경우 - 오류가 아니라 그때까지 받은 내용을 그대로 확정한다.
            onAbort: () => {
              if (!gotFirstToken) stopDots();
              if (currentSessionId === sessionIdForRequest) {
                const finalText = accumulated.trim();
                if (finalText) {
                  setAssistantHtml(bubble, finalText);
                  chatHistory.push({
                    role: 'assistant', versions: [finalText], versionIndex: 0,
                    toolLog: toolTracker.getLog(), editedFiles: toolTracker.getEditedFiles()
                  });
                  assistantWrap._historyIndex = chatHistory.length - 1;
                  finalizeAssistantWrap(assistantWrap);
                  persistCurrentSession();
                } else {
                  assistantWrap.remove();
                }
              } else {
                assistantWrap.remove();
              }
            },
            onError: (message) => {
              if (!gotFirstToken) stopDots();
              if (currentSessionId === sessionIdForRequest) {
                assistantWrap.remove();
                streamAssistantErrorMessage(message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
              } else {
                assistantWrap.remove();
              }
              console.error('[MinsuGPT]', message);
            }
          },
          controller.signal
        );
      } catch (err) {
        if (!gotFirstToken) stopDots();
        assistantWrap.remove();
        if (currentSessionId === sessionIdForRequest) {
          await streamAssistantErrorMessage(err.message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
        console.error('[MinsuGPT]', err);
      } finally {
        if (activeAbortController === controller) activeAbortController = null;
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
      sidebarBackdrop.style.transition = 'none';
      sidebarBackdrop.style.opacity = '0';
      sidebarBackdrop.classList.remove('hidden');

      // 강제 리플로우: 위에서 지정한 '닫힌' 상태를 브라우저가 바로 반영하게 만든다.
      // (requestAnimationFrame을 두 번 쌓아서 다음 프레임에 열리게 하던 예전 방식은
      //  드물게 프레임이 씹히면 열림 애니메이션 자체가 실행되지 않고 사이드바가
      //  화면 밖(-100%)에 그대로 남은 채 배경만 어두워지는 문제가 있었다.
      //  offsetWidth를 읽으면 그 시점에 스타일이 즉시 반영되므로 rAF 타이밍에
      //  기댈 필요가 없다.)
      void sidebar.offsetWidth;

      sidebar.style.transition = '';
      sidebar.style.transform = 'translateX(0)';
      sidebarBackdrop.style.transition = '';
      sidebarBackdrop.style.opacity = '1';
    }

    function closeMobileSidebar() {
      sidebar.style.transition = '';
      sidebar.style.transform = 'translateX(-100%)';
      sidebarBackdrop.style.transition = '';
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

    function endSidebarSwipe() {
      if (!isSwiping) return;
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
    }

    sidebar.addEventListener('touchend', function(e) {
      if (!isMobile()) return;
      endSidebarSwipe();
    }, { passive: true });

    // 스와이프 도중 시스템 알림/전화 등으로 제스처가 중간에 끊기면 touchend가 아예
    // 안 올 수 있다. 그러면 isSwiping이 계속 true로 남고 transition이 'none'인 채
    // 멈춰서, 다음에 사이드바를 열어도 배경만 어두워지고 패널은 안 움직이는 것처럼
    // 보일 수 있었다. touchcancel에서도 같은 마무리 처리를 해준다.
    sidebar.addEventListener('touchcancel', function(e) {
      if (!isMobile()) return;
      endSidebarSwipe();
    }, { passive: true });

    chatInput.addEventListener('input', function() {
      // 응답을 기다리는 중(정지 버튼 상태)에는 입력창을 만져도 버튼 모양을 바꾸지 않는다.
      if (!isSending) {
        setSendBtnState(this.value.trim().length > 0 ? 'ready' : 'hidden');
      }

      this.style.height = '24px';
      let nextHeight = this.scrollHeight;
      this.style.height = (this.value === '') ? '24px' : nextHeight + 'px';
    });

    sendBtn.addEventListener('click', () => {
      if (isSending) { stopGeneration(); return; }
      sendMessage();
    });

    // 모바일(가상 키보드)에서는 Enter가 항상 줄바꿈이고, 전송은 버튼으로만 한다.
    // 데스크탑은 기존과 동일하게 Enter로 전송, Shift+Enter로 줄바꿈한다.
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isMobile() || e.isComposing) return;
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
