if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html — this module cannot run alone.");
}
let userMessageMenuTarget = null;
    const userMessageMenu = document.getElementById('user-message-menu');

    function closeUserMessageMenu() {
      if (!userMessageMenu) return;
      userMessageMenu.classList.remove('show');
      userMessageMenuTarget = null;
    }

    function openUserMessageMenu(wrap, bubble, x, y) {
      if (!userMessageMenu) return;
      userMessageMenuTarget = { wrap, bubble };
      const editBtn = userMessageMenu.querySelector('[data-action="edit"]');
      if (editBtn) {
        editBtn.style.display = wrap.classList.contains('latest-user') ? 'flex' : 'none';
      }
      const pad = 8;
      const rect = menuRect(userMessageMenu);
      const left = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
      const top = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
      userMessageMenu.style.left = left + 'px';
      userMessageMenu.style.top = top + 'px';
      userMessageMenu.classList.add('show');
      renderRoundedIcons(userMessageMenu);
    }

    function menuRect(el) {
      const prevShow = el.classList.contains('show');
      if (!prevShow) {
        el.style.visibility = 'hidden';
        el.classList.add('show');
      }
      const r = el.getBoundingClientRect();
      if (!prevShow) {
        el.classList.remove('show');
        el.style.visibility = '';
      }
      return { width: r.width || 132, height: r.height || 120 };
    }

    function deleteUserMessageAt(wrap) {
      const idx = wrap._historyIndex;
      if (typeof idx !== 'number') return;
      chatHistory = chatHistory.slice(0, idx);
      reRenderChatFromHistory();
      persistCurrentSession();
      if (!chatHistory.length) showWelcomeLayout();
    }

    function attachUserLongPress(wrap, bubble) {
      let pressTimer = null;
      let startX = 0;
      let startY = 0;

      const clearPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        bubble.classList.remove('is-press-target');
      };

      bubble.addEventListener('touchstart', (e) => {
        if (!isMobile() || wrap.classList.contains('is-editing')) return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        bubble.classList.add('is-press-target');
        pressTimer = setTimeout(() => {
          if (navigator.vibrate) navigator.vibrate(8);
          openUserMessageMenu(wrap, bubble, startX, startY - 8);
        }, 500);
      }, { passive: true });

      bubble.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - startX) > 14 || Math.abs(t.clientY - startY) > 14) clearPress();
      }, { passive: true });

      bubble.addEventListener('touchend', clearPress);
      bubble.addEventListener('touchcancel', clearPress);
    }

    function attachUserActions(wrap, bubble) {
      const actions = document.createElement('div');
      actions.className = 'user-actions';
      actions.innerHTML = `
        <button type="button" class="user-action-btn user-action-edit ripple-btn" data-action="edit"><i data-lucide="square-pen" class="w-3.5 h-3.5"></i></button>
        <button type="button" class="user-action-btn ripple-btn" data-action="copy"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
      `;
      wrap.appendChild(actions);
      actions.querySelectorAll('.user-action-btn').forEach((btn) => {
        attachRipple(btn);
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const text = (bubble.textContent || '').trim();
          if (action === 'copy') {
            const ok = await copyTextToClipboard(text);
            if (ok) flashCheckIcon(btn, 1000);
            else {
              showError('복사 실패');
              setTimeout(hideError, 900);
            }
            return;
          }
          if (action === 'edit') {
            startUserInlineEdit(wrap, bubble);
          }
        });
      });
      attachUserLongPress(wrap, bubble);
      renderRoundedIcons(actions);
      updateUserActionVisibility();
    }

    if (userMessageMenu) {
      userMessageMenu.querySelectorAll('.user-message-menu-btn').forEach((btn) => {
        attachRipple(btn);
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!userMessageMenuTarget) return;
          const { wrap, bubble } = userMessageMenuTarget;
          const action = btn.dataset.action;
          const text = (bubble.textContent || '').trim();
          closeUserMessageMenu();
          if (action === 'edit') {
            if (wrap.classList.contains('latest-user')) startUserInlineEdit(wrap, bubble);
            return;
          }
          if (action === 'duplicate') {
            if (!text) return;
            chatInput.value = text;
            chatInput.dispatchEvent(new Event('input'));
            chatInput.focus();
            return;
          }
          if (action === 'delete') {
            deleteUserMessageAt(wrap);
          }
        });
      });
    }

    document.addEventListener('click', (e) => {
      if (!userMessageMenu || !userMessageMenu.classList.contains('show')) return;
      if (e.target.closest('#user-message-menu') || e.target.closest('.msg-user')) return;
      closeUserMessageMenu();
    });

    function applyCopyCheckForAssistant(btn) {
      flashCheckIcon(btn, 1000);
    }

    async function copyTextWithFeedback(btn, text) {
      const ok = await copyTextToClipboard(text);
      if (ok) {
        applyCopyCheckForAssistant(btn);
      } else {
        showError('복사 실패');
        setTimeout(hideError, 900);
      }
    }

    function findPreviousUserText(wrap) {
      let node = wrap.previousElementSibling;
      while (node) {
        const user = node.querySelector('.msg-user');
        if (user) return user.textContent || '';
        node = node.previousElementSibling;
      }
      return '';
    }

    function updateAssistantActionVisibility() {
      const wraps = Array.from(chatMessages.querySelectorAll('.assistant-msg-wrap'));
      wraps.forEach((w) => {
        w.classList.remove('always-show', 'latest-assistant');
        const regenBtn = w.querySelector('[data-action="regen"]');
        if (regenBtn) {
          regenBtn.classList.remove('is-busy');
          regenBtn.style.display = 'none';
        }
      });
      if (wraps.length) {
        const last = wraps[wraps.length - 1];
        last.classList.add('always-show', 'latest-assistant');
        const regenBtn = last.querySelector('[data-action="regen"]');
        if (regenBtn) regenBtn.style.display = '';
      }
      syncRegenButtonsBusy();
    }

    function syncRegenButtonsBusy() {
      const busy = isSending || isRegenerating;
      document.querySelectorAll('.assistant-msg-wrap.latest-assistant [data-action="regen"]').forEach((btn) => {
        btn.classList.toggle('is-busy', busy);
      });
    }

    function updateVersionNav(wrap, actionsEl) {
      if (!actionsEl) return;
      const nav = actionsEl.querySelector('.assistant-version-nav');
      if (!nav) return;
      const idx = wrap._historyIndex;
      const m = typeof idx === 'number' ? chatHistory[idx] : null;
      if (!m || m.role !== 'assistant') return;
      const norm = normalizeAssistantMessage(m);
      const total = norm.versions.length;
      const cur = (norm.versionIndex ?? total - 1) + 1;
      nav.querySelector('.ver-label').textContent = cur + ' / ' + total;
      const prevBtn = nav.querySelector('[data-action="ver-prev"]');
      const nextBtn = nav.querySelector('[data-action="ver-next"]');
      if (prevBtn) prevBtn.disabled = cur <= 1;
      if (nextBtn) nextBtn.disabled = cur >= total;
    }

    function showAssistantVersion(wrap, bubble, delta) {
      const idx = wrap._historyIndex;
      if (typeof idx !== 'number') return;
      const m = normalizeAssistantMessage(chatHistory[idx]);
      const nextIdx = (m.versionIndex ?? m.versions.length - 1) + delta;
      if (nextIdx < 0 || nextIdx >= m.versions.length) return;
      chatHistory[idx] = { role: 'assistant', versions: m.versions, versionIndex: nextIdx };
      setAssistantHtml(bubble, m.versions[nextIdx]);
      updateVersionNav(wrap, wrap.querySelector('.assistant-actions'));
      persistCurrentSession();
    }

    // 점 3개 로딩 애니메이션은 순수 CSS @keyframes(typing-dot-bounce)로 돈다.
    // (이전에는 requestAnimationFrame으로 매 프레임 좌표를 계산했는데, 메인 스레드가
    // 잠깐 바쁘거나 tick 루프가 한 번이라도 끊기면 그 자리에서 멈춰버리는 문제가 있었다.
    // CSS 애니메이션은 컴포지터가 돌리므로 JS가 멈춰도 끊기지 않고, 탭이 백그라운드로
    // 가도 브라우저가 알아서 처리해 별도 visibilitychange/워치독 로직이 필요 없다.)
    function createTypingDotsElement(label) {
      const dotsEl = document.createElement('div');
      dotsEl.className = 'typing-dots';
      if (label) dotsEl.setAttribute('aria-label', label);
      for (let i = 0; i < 3; i++) {
        dotsEl.appendChild(document.createElement('span'));
      }
      return dotsEl;
    }

    // 예전 rAF 엔진을 쓰던 코드들과의 호환을 위해 이름은 유지하되, 실제로는
    // CSS 애니메이션이 이미 돌고 있으므로 할 일이 없다(정지 함수만 돌려준다).
    function bootTypingAnimation(container) {
      return function stop() {};
    }

    function mountTypingLoader(parent) {
      parent.innerHTML = '';
      parent.classList.add('is-loading');
      const dotsEl = createTypingDotsElement('생각 중');
      parent.appendChild(dotsEl);
      return function stopAll() {
        parent.classList.remove('is-loading');
      };
    }

    // ══════════════════════════════════════════════════════════════
    // 작업 내역(도구 사용 로그) - SSE "tool" 이벤트를 실시간으로 보여주고,
    // 채팅 기록에 함께 저장해서 새로고침해도 남아있게 한다.
    // ══════════════════════════════════════════════════════════════
    const TOOL_PAST_LABELS = {
      execute_python: '코드를 실행했습니다',
      web_search: '웹을 검색했습니다',
      fetch_page: '페이지를 가져왔습니다',
      read_file: '파일을 읽었습니다',
      edit_file: '파일을 수정했습니다',
      get_file_content: '파일 내용을 가져왔습니다'
    };
    const TOOL_ICON_KEYS = {
      execute_python: 'code-tool',
      web_search: 'web-tool',
      fetch_page: 'link-tool',
      read_file: 'read-tool',
      edit_file: 'edit-tool',
      get_file_content: 'get-tool'
    };

    function toolPastLabel(evt) {
      return TOOL_PAST_LABELS[evt.tool] || (evt.detail || '작업을 완료했습니다');
    }

    // detail 문구("파일 읽는 중: calc.py (12~40줄)")에서 파일명만 뽑아낸다.
    function extractFilenameFromDetail(detail) {
      if (!detail) return null;
      const m = String(detail).match(/:\s*([^\s():,]+)/);
      return m ? m[1] : null;
    }

    function collectEditedFiles(log) {
      const map = new Map();
      (log || []).forEach((evt) => {
        if (evt.tool === 'edit_file' && evt.file_id) {
          map.set(evt.file_id, { file_id: evt.file_id, filename: extractFilenameFromDetail(evt.detail) || evt.file_id });
        }
      });
      return Array.from(map.values());
    }

    function setToolLogButtonLive(btn, live, detailText) {
      if (!btn) return;
      const text = btn.querySelector('.tool-log-btn-text');
      btn.classList.toggle('is-live', !!live);
      if (!text) return;
      if (live && detailText) {
        if (text.textContent !== detailText) {
          text.textContent = detailText;
          text.classList.remove('swap');
          void text.offsetWidth; // 강제 리플로우 - 애니메이션이 처음부터 다시 재생되게
          text.classList.add('swap');
        }
      } else if (!live) {
        text.textContent = '작업 내역';
        text.classList.remove('swap');
      }
    }

    function createToolLogButton(log) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-log-btn';
      btn._toolLog = log;
      const icon = document.createElement('iconify-icon');
      icon.setAttribute('icon', iconNameMap('list-check'));
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'tool-log-btn-text';
      text.textContent = '작업 내역';
      btn.appendChild(icon);
      btn.appendChild(text);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolLogModal(btn._toolLog);
      });
      return btn;
    }

    // 응답 하나를 생성하는 동안 들어오는 tool 이벤트를 모아서, 말풍선 위 버튼에
    // 실시간으로 반영한다. 첫 토큰이 오면(markStreaming) 실시간 갱신은 멈추고
    // 평범한 '작업 내역' 버튼으로 바뀐다.
    function createLiveToolTracker(wrapEl) {
      const log = [];
      let btnEl = null;
      let live = true;
      function ensureBtn() {
        if (!btnEl) {
          btnEl = createToolLogButton(log);
          wrapEl.insertBefore(btnEl, wrapEl.firstChild);
        }
        return btnEl;
      }
      return {
        addEvent(evt) {
          log.push(evt);
          const btn = ensureBtn();
          if (live) setToolLogButtonLive(btn, true, evt.detail || toolPastLabel(evt));
        },
        markStreaming() {
          live = false;
          if (btnEl) setToolLogButtonLive(btnEl, false);
        },
        getLog() { return log; },
        getEditedFiles() { return collectEditedFiles(log); }
      };
    }

    function openToolLogModal(log) {
      if (!toolLogModal || !toolLogList) return;
      toolLogList.innerHTML = '';
      if (!log || !log.length) {
        const empty = document.createElement('p');
        empty.className = 'text-[12px] text-gray-400';
        empty.textContent = '기록된 작업이 없습니다.';
        toolLogList.appendChild(empty);
      } else {
        log.forEach((evt) => {
          const item = document.createElement('div');
          item.className = 'tool-log-item';
          const iconWrap = document.createElement('div');
          iconWrap.className = 'tool-log-item-icon';
          const icon = document.createElement('iconify-icon');
          icon.setAttribute('icon', iconNameMap(TOOL_ICON_KEYS[evt.tool] || 'list-check'));
          iconWrap.appendChild(icon);
          const body = document.createElement('div');
          body.className = 'tool-log-item-body';
          const p1 = document.createElement('p');
          p1.textContent = toolPastLabel(evt); // 완료된 작업은 항상 과거형으로 표시
          const p2 = document.createElement('p');
          p2.textContent = evt.detail || '';
          body.appendChild(p1);
          body.appendChild(p2);
          item.appendChild(iconWrap);
          item.appendChild(body);
          toolLogList.appendChild(item);
        });
      }
      toolLogModal.classList.add('show');
    }

    function closeToolLogModal() {
      if (toolLogModal) toolLogModal.classList.remove('show');
    }

    if (toolLogClose) toolLogClose.addEventListener('click', closeToolLogModal);
    if (toolLogModal) {
      toolLogModal.addEventListener('click', (e) => {
        if (e.target === toolLogModal) closeToolLogModal();
      });
    }

    // 보낸 메시지 말풍선 위에 붙는, 그때 첨부했던 파일들의 미리보기(읽기 전용).
    function createMessageFilesRow(files) {
      const row = document.createElement('div');
      row.className = 'msg-attach-row';
      (files || []).forEach((f) => {
        if (f.kind === 'image') {
          const box = document.createElement('div');
          box.className = 'msg-attach-image';
          if (f.previewUrl) {
            const img = document.createElement('img');
            img.src = f.previewUrl;
            img.alt = f.filename || '';
            box.appendChild(img);
          } else {
            // previewUrl은 blob: URL이라 새로고침 후에는 없다 - 아이콘으로 대체
            const fallback = document.createElement('div');
            fallback.className = 'msg-attach-fallback';
            const icon = document.createElement('iconify-icon');
            icon.setAttribute('icon', iconNameMap('image'));
            fallback.appendChild(icon);
            box.appendChild(fallback);
          }
          row.appendChild(box);
        } else {
          const chip = document.createElement('div');
          chip.className = 'msg-attach-file';
          const icon = document.createElement('iconify-icon');
          icon.setAttribute('icon', iconNameMap('file'));
          const span = document.createElement('span');
          span.textContent = f.filename || '파일';
          chip.appendChild(icon);
          chip.appendChild(span);
          row.appendChild(chip);
        }
      });
      return row;
    }

    function createToolFileResultsRow(editedFiles) {
      const row = document.createElement('div');
      row.className = 'tool-file-results';
      (editedFiles || []).forEach((f) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tool-file-btn';
        const icon = document.createElement('iconify-icon');
        icon.setAttribute('icon', iconNameMap('download'));
        const label = document.createElement('span');
        label.textContent = f.filename + ' 다운로드';
        btn.appendChild(icon);
        btn.appendChild(label);
        btn.addEventListener('click', () => downloadEditedFile(f.file_id, f.filename));
        row.appendChild(btn);
      });
      return row;
    }

    async function downloadEditedFile(fileId, filename) {
      try {
        const res = await fetch(API_BASE + '/api/file/' + encodeURIComponent(fileId), { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || ('파일을 가져오지 못했습니다 (HTTP ' + res.status + ')'));
        }
        const blob = new Blob([data.content || ''], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename || filename || 'download.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (err) {
        console.error('[MinsuGPT][fileDownload]', err);
        showError('파일을 다운로드하지 못했습니다: ' + (err.message || ''));
        setTimeout(hideError, 2500);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // 파일/이미지 첨부 업로드
    // ══════════════════════════════════════════════════════════════
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const raw = String(reader.result || '');
          const idx = raw.indexOf(',');
          resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
        };
        reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
    }

    function renderAttachChips() {
      if (!attachChipRow) return;
      attachChipRow.innerHTML = '';
      if (!attachedFiles.length) {
        attachChipRow.classList.add('hidden');
        return;
      }
      attachChipRow.classList.remove('hidden');
      attachedFiles.forEach((f) => {
        if (f.kind === 'image') {
          const chip = document.createElement('div');
          chip.className = 'attach-chip-image';
          if (f.previewUrl) {
            const img = document.createElement('img');
            img.src = f.previewUrl;
            img.alt = f.filename;
            chip.appendChild(img);
          }
          const remove = document.createElement('div');
          remove.className = 'attach-chip-remove';
          const icon = document.createElement('iconify-icon');
          icon.setAttribute('icon', iconNameMap('x'));
          remove.appendChild(icon);
          remove.addEventListener('click', () => removeAttachedFile(f.file_id));
          chip.appendChild(remove);
          attachChipRow.appendChild(chip);
        } else {
          const chip = document.createElement('div');
          chip.className = 'attach-chip-file';
          const icon = document.createElement('iconify-icon');
          icon.setAttribute('icon', iconNameMap('file'));
          const span = document.createElement('span');
          span.textContent = f.filename;
          const remove = document.createElement('div');
          remove.className = 'attach-chip-remove';
          const removeIcon = document.createElement('iconify-icon');
          removeIcon.setAttribute('icon', iconNameMap('x'));
          remove.appendChild(removeIcon);
          remove.addEventListener('click', () => removeAttachedFile(f.file_id));
          chip.appendChild(icon);
          chip.appendChild(span);
          chip.appendChild(remove);
          attachChipRow.appendChild(chip);
        }
      });
    }

    function removeAttachedFile(fileId) {
      const target = attachedFiles.find((f) => f.file_id === fileId);
      if (target && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      attachedFiles = attachedFiles.filter((f) => f.file_id !== fileId);
      renderAttachChips();
    }

    function clearAttachedFiles() {
      // previewUrl(blob:)은 여기서 해제하지 않는다 - 메시지를 보내는 흐름에서는
      // 그 미리보기를 보낸 말풍선이 그대로 이어받아 계속 보여줘야 하기 때문이다.
      // (직접 X를 눌러 하나씩 지울 때는 removeAttachedFile이 그때 바로 해제한다.)
      attachedFiles = [];
      renderAttachChips();
    }

    async function uploadPickedFile(file) {
      if (!file) return;
      if (!currentSessionId || !getSession(currentSessionId)) ensureSession('');
      let base64;
      try {
        base64 = await fileToBase64(file);
      } catch (err) {
        showError('파일을 읽지 못했습니다: ' + (err.message || ''));
        setTimeout(hideError, 2500);
        return;
      }
      const url = API_BASE + '/api/upload';
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({
            filename: file.name,
            mime_type: file.type || 'application/octet-stream',
            content_base64: base64,
            session_id: currentSessionId
          })
        });
      } catch (err) {
        showError(describeNetworkError('파일 업로드에 실패했습니다', 'POST', url, err));
        setTimeout(hideError, 3000);
        return;
      }
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || !data.success) {
        showError(data.error || ('파일 업로드에 실패했습니다 (HTTP ' + res.status + ')'));
        setTimeout(hideError, 3000);
        return;
      }
      const entry = {
        file_id: data.file_id,
        filename: data.filename || file.name,
        kind: data.kind || (file.type && file.type.startsWith('image/') ? 'image' : 'text'),
        size_bytes: data.size_bytes || file.size,
        previewUrl: null
      };
      if (entry.kind === 'image') {
        try { entry.previewUrl = URL.createObjectURL(file); } catch { /* 무시 */ }
      }
      attachedFiles.push(entry);
      renderAttachChips();
    }

    async function handleFilePickInput(inputEl) {
      const files = Array.from(inputEl.files || []);
      inputEl.value = ''; // 같은 파일을 다시 선택해도 change 이벤트가 뜨도록
      for (const file of files) {
        await uploadPickedFile(file);
      }
    }

    if (attachFilePhoto) attachFilePhoto.addEventListener('change', () => handleFilePickInput(attachFilePhoto));
    if (attachFileGeneric) attachFileGeneric.addEventListener('change', () => handleFilePickInput(attachFileGeneric));
    if (attachFileCamera) attachFileCamera.addEventListener('change', () => handleFilePickInput(attachFileCamera));

    // ══════════════════════════════════════════════════════════════
    // 첨부 패널(+ 버튼) / 생각 더 하기 / 검색 토글
    // ══════════════════════════════════════════════════════════════
    function isAttachPanelOpen() {
      return !!(attachPanel && !attachPanel.classList.contains('hidden'));
    }

    function openAttachPanel() {
      if (attachPanel) attachPanel.classList.remove('hidden');
    }

    function closeAttachPanel() {
      if (attachPanel) attachPanel.classList.add('hidden');
    }

    function renderActiveToggleIcons() {
      if (!activeToggleIcons) return;
      activeToggleIcons.innerHTML = '';
      const active = [];
      if (reasoningEffortOn) active.push({ cls: 'reasoning', icon: iconNameMap('brain') });
      if (searchOn) active.push({ cls: 'search', icon: iconNameMap('search') });
      if (!active.length) {
        activeToggleIcons.classList.add('hidden');
        return;
      }
      activeToggleIcons.classList.remove('hidden');
      active.forEach((a) => {
        const span = document.createElement('span');
        span.className = 'active-toggle-icon ' + a.cls;
        const icon = document.createElement('iconify-icon');
        icon.setAttribute('icon', a.icon);
        span.appendChild(icon);
        activeToggleIcons.appendChild(span);
      });
    }

    function setReasoningEffort(on) {
      reasoningEffortOn = !!on;
      if (toggleReasoningBtn) toggleReasoningBtn.classList.toggle('active', reasoningEffortOn);
      renderActiveToggleIcons();
    }

    function setSearchOn(on) {
      searchOn = !!on;
      if (toggleSearchBtn) toggleSearchBtn.classList.toggle('active', searchOn);
      renderActiveToggleIcons();
    }

    if (attachBtn) {
      attachBtn.addEventListener('click', () => {
        if (isAttachPanelOpen()) closeAttachPanel();
        else openAttachPanel();
      });
    }
    if (attachPanelClose) attachPanelClose.addEventListener('click', closeAttachPanel);
    if (attachPickPhoto) attachPickPhoto.addEventListener('click', () => attachFilePhoto && attachFilePhoto.click());
    if (attachPickFile) attachPickFile.addEventListener('click', () => attachFileGeneric && attachFileGeneric.click());
    if (attachPickCamera) attachPickCamera.addEventListener('click', () => attachFileCamera && attachFileCamera.click());
    if (toggleReasoningBtn) toggleReasoningBtn.addEventListener('click', () => setReasoningEffort(!reasoningEffortOn));
    if (toggleSearchBtn) toggleSearchBtn.addEventListener('click', () => setSearchOn(!searchOn));

    async function regenerateAssistantAtWrap(wrap, bubble) {
      if (isSending || isRegenerating) return;
      if (!wrap.classList.contains('latest-assistant')) return;
      const idx = wrap._historyIndex;
      if (typeof idx !== 'number') return;
      const entry = chatHistory[idx];
      if (!entry || entry.role !== 'assistant') return;
      const userMsg = chatHistory[idx - 1];
      if (!userMsg || userMsg.role !== 'user') return;
      const userText = userMsg.content || '';

      hideError();
      isRegenerating = true;
      syncRegenButtonsBusy();
      setSendLoading(true);
      const controller = new AbortController();
      activeAbortController = controller;
      wrap.classList.remove('actions-ready');
      wrap.classList.add('actions-pending');
      // 이전 버전의 작업 내역/파일 버튼이 남아있으면 지운다 - 재생성마다 새로 쌓는다.
      wrap.querySelectorAll('.tool-log-btn, .tool-file-results').forEach((el) => el.remove());

      const stopDots = mountTypingLoader(bubble);
      const toolTracker = createLiveToolTracker(wrap);
      const sessionIdForRequest = currentSessionId;
      let accumulated = '';
      let gotFirstToken = false;

      try {
        await requestAiChatStream(
          {
            message: userText,
            messages: historyForApi(idx),
            session_id: sessionIdForRequest,
            system_prompt: AI_SYSTEM_PROMPT
          },
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
                const norm = normalizeAssistantMessage(entry);
                norm.versions.push(finalText);
                norm.versionIndex = norm.versions.length - 1;
                norm.toolLog = toolTracker.getLog();
                norm.editedFiles = toolTracker.getEditedFiles();
                chatHistory[idx] = norm;

                setAssistantHtml(bubble, finalText);
                if (norm.editedFiles.length) {
                  wrap.appendChild(createToolFileResultsRow(norm.editedFiles));
                }
                triggerGradientWave();
                finalizeAssistantWrap(wrap);
                persistCurrentSession();
              } else {
                appendAssistantReplyToStoredSession(sessionIdForRequest, finalText);
              }
            },
            // 정지 버튼으로 직접 중단한 경우 - 그때까지 받은 내용을 그대로 새 버전으로 확정한다.
            onAbort: () => {
              if (!gotFirstToken) stopDots();
              if (currentSessionId === sessionIdForRequest) {
                const finalText = accumulated.trim();
                const norm = normalizeAssistantMessage(entry);
                if (finalText) {
                  norm.versions.push(finalText);
                  norm.versionIndex = norm.versions.length - 1;
                  norm.toolLog = toolTracker.getLog();
                  norm.editedFiles = toolTracker.getEditedFiles();
                  chatHistory[idx] = norm;
                  setAssistantHtml(bubble, finalText);
                  if (norm.editedFiles.length) {
                    wrap.appendChild(createToolFileResultsRow(norm.editedFiles));
                  }
                  finalizeAssistantWrap(wrap);
                  persistCurrentSession();
                } else {
                  setAssistantHtml(bubble, assistantActiveContent(norm));
                  wrap.classList.remove('actions-pending');
                  wrap.classList.add('actions-ready');
                }
              }
            },
            onError: (message) => {
              if (!gotFirstToken) stopDots();
              if (currentSessionId === sessionIdForRequest) {
                const norm = normalizeAssistantMessage(entry);
                setAssistantHtml(bubble, assistantActiveContent(norm));
                wrap.classList.remove('actions-pending');
                wrap.classList.add('actions-ready');
                streamAssistantErrorMessage(message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
              }
              console.error('[MinsuGPT]', message);
            }
          },
          controller.signal
        );
      } catch (err) {
        if (!gotFirstToken) stopDots();
        if (currentSessionId === sessionIdForRequest) {
          const norm = normalizeAssistantMessage(entry);
          setAssistantHtml(bubble, assistantActiveContent(norm));
          wrap.classList.remove('actions-pending');
          wrap.classList.add('actions-ready');
          await streamAssistantErrorMessage(err.message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
        console.error('[MinsuGPT]', err);
      } finally {
        if (activeAbortController === controller) activeAbortController = null;
        isRegenerating = false;
        syncRegenButtonsBusy();
        setSendLoading(false);
        scrollChatToBottom();
      }
    }

    function attachAssistantActions(wrap, bubble, sourceUserText) {
      const actions = document.createElement('div');
      actions.className = 'assistant-actions';
      actions.innerHTML = `
        <button type="button" class="assistant-action-btn ripple-btn" data-action="like"><i data-lucide="thumb-up" class="w-3.5 h-3.5"></i></button>
        <button type="button" class="assistant-action-btn ripple-btn" data-action="dislike"><i data-lucide="thumb-down" class="w-3.5 h-3.5"></i></button>
        <button type="button" class="assistant-action-btn ripple-btn" data-action="regen"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i></button>
        <button type="button" class="assistant-action-btn ripple-btn" data-action="copy"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
        <button type="button" class="assistant-action-btn ripple-btn" data-action="more"><i data-lucide="ellipsis" class="w-3.5 h-3.5"></i></button>
        <div class="assistant-version-nav">
          <button type="button" class="assistant-action-btn ripple-btn" data-action="ver-prev" aria-label="이전 답변"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
          <span class="ver-label">1 / 1</span>
          <button type="button" class="assistant-action-btn ripple-btn" data-action="ver-next" aria-label="다음 답변"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>
        </div>
      `;
      wrap.appendChild(actions);
      actions.querySelectorAll('.assistant-action-btn').forEach((btn) => {
        attachRipple(btn);
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'like') {
            btn.classList.toggle('active');
            actions.querySelector('[data-action="dislike"]').classList.remove('active');
            return;
          }
          if (action === 'dislike') {
            btn.classList.toggle('active');
            actions.querySelector('[data-action="like"]').classList.remove('active');
            return;
          }
          if (action === 'copy') {
            await copyTextWithFeedback(btn, (bubble.innerText || '').trim());
            return;
          }
          if (action === 'ver-prev') {
            showAssistantVersion(wrap, bubble, -1);
            return;
          }
          if (action === 'ver-next') {
            showAssistantVersion(wrap, bubble, 1);
            return;
          }
          if (action === 'regen') {
            if (!wrap.classList.contains('latest-assistant') || isSending || isRegenerating) return;
            await regenerateAssistantAtWrap(wrap, bubble);
            return;
          }
          if (action === 'more') {
            showError('추가 옵션 준비 중');
            setTimeout(hideError, 900);
          }
        });
      });
      renderRoundedIcons(actions);
      updateVersionNav(wrap, actions);
      updateAssistantActionVisibility();
    }

    function appendMarkdownBlock(container, mdText) {
      if (!mdText.trim()) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = typeof marked !== 'undefined'
        ? marked.parse(mdText)
        : mdText.replace(/</g, '&lt;').replace(/\n/g, '<br>');
      while (tmp.firstChild) container.appendChild(tmp.firstChild);
    }

    function parseContentSegments(text) {
      const segments = [];
      const tableRe = /(?:^|\n)(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)*)/g;
      let last = 0;
      let match;
      while ((match = tableRe.exec(text)) !== null) {
        if (match.index > last) {
          segments.push({ type: 'text', content: text.slice(last, match.index) });
        }
        segments.push({ type: 'table', content: match[1].trim() });
        last = match.index + match[0].length;
      }
      if (last < text.length) {
        segments.push({ type: 'text', content: text.slice(last) });
      }
      if (!segments.length) segments.push({ type: 'text', content: text });
      return segments;
    }

    function findFreezePoint(acc, from) {
      const rest = acc.slice(from);
      const para = rest.indexOf('\n\n');
      if (para >= 0) return from + para + 2;
      const line = rest.indexOf('\n');
      if (line >= 0) return from + line + 1;
      return from;
    }

    function ensureStreamTail(body) {
      let tail = body.querySelector('.md-stream-tail');
      if (!tail) {
        tail = document.createElement('div');
        tail.className = 'md-tail md-stream-tail';
        body.appendChild(tail);
      }
      return tail;
    }

    function freezeTailSegment(body, mdText) {
      if (!mdText || !mdText.trim()) return;
      const tail = body.querySelector('.md-stream-tail');
      const block = document.createElement('div');
      block.className = 'md-frozen-block';
      appendMarkdownBlock(block, mdText);
      if (tail) body.insertBefore(block, tail);
      else body.appendChild(block);
      if (tail) tail.innerHTML = '';
    }

    function freezePendingTail(body) {
      const tail = body.querySelector('.md-stream-tail');
      if (!tail) return;
      const pending = tail.textContent || '';
      tail.innerHTML = '';
      if (pending.trim()) freezeTailSegment(body, pending);
    }

    function createTablePlaceholder(body, tableMd) {
      freezePendingTail(body);
      const tail = ensureStreamTail(body);
      const slot = document.createElement('div');
      slot.className = 'md-table-slot';
      slot.dataset.tableMd = tableMd;

      const card = document.createElement('div');
      card.className = 'table-loading-card';
      const dots = createTypingDotsElement('표 생성 중');
      const label = document.createElement('span');
      label.textContent = '표를 생성하는 중';
      card.appendChild(dots);
      card.appendChild(label);
      slot.appendChild(card);
      body.insertBefore(slot, tail);
      slot._stopAnim = bootTypingAnimation(dots);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return slot;
    }

    async function streamTextWithFade(body, text) {
      if (!text) return;
      const tail = ensureStreamTail(body);
      const chunks = splitWordChunks(text);
      let acc = '';
      let frozenLen = 0;

      for (let i = 0; i < chunks.length; i++) {
        acc += chunks[i];
        const span = document.createElement('span');
        span.className = 'md-word-fade';
        span.textContent = chunks[i];
        tail.appendChild(span);

        let freezeAt = findFreezePoint(acc, frozenLen);
        while (freezeAt > frozenLen) {
          freezeTailSegment(body, acc.slice(frozenLen, freezeAt));
          frozenLen = freezeAt;
          const rest = acc.slice(frozenLen);
          tail.innerHTML = '';
          if (rest) {
            const restSpan = document.createElement('span');
            restSpan.className = 'md-word-fade';
            restSpan.textContent = rest;
            tail.appendChild(restSpan);
          }
          freezeAt = findFreezePoint(acc, frozenLen);
        }

        chatMessages.scrollTop = chatMessages.scrollHeight;
        await sleep(48);
      }

      if (acc.slice(frozenLen).trim()) {
        freezeTailSegment(body, acc.slice(frozenLen));
      }
    }

    function splitWordChunks(text) {
      const parts = text.match(/\S+|\s+/g) || [];
      const chunks = [];
      let buf = '';
      for (const p of parts) {
        buf += p;
        if (p.trim()) {
          chunks.push(buf);
          buf = '';
        }
      }
      if (buf) chunks.push(buf);
      return chunks;
    }
