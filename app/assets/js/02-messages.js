if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html ??this module cannot run alone.");
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

    function createTypingDotsElement(label) {
      const dotsEl = document.createElement('div');
      dotsEl.className = 'typing-dots';
      if (label) dotsEl.setAttribute('aria-label', label);
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.style.transform = 'translate(' + SLOT_X[i] + 'px, 0px)';
        dotsEl.appendChild(dot);
      }
      return dotsEl;
    }

    function startSwapLoadingAnimation(container, state) {
      const dots = [];
      for (let i = 0; i < container.children.length; i++) {
        const dot = container.children[i];
        if (dot && dot.tagName === 'SPAN') dots.push(dot);
      }
      if (dots.length < 3) return function() {};

      const xPos = [SLOT_X[0], SLOT_X[1], SLOT_X[2]];
      const pairs = [[0, 1], [1, 2], [0, 2]];
      const BOUNCE_MS = 1100;
      const MOVE_MS = 520;
      const CYCLE_MS = BOUNCE_MS + MOVE_MS;
      state.t0 = performance.now();
      state.lastTick = state.t0;
      state.hiddenAt = 0;
      let committedCycle = -1;

      function arcY(t, sign) {
        return sign * 7 * 4 * t * (1 - t);
      }

      function easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      }

      dots.forEach((d, i) => {
        d.style.transform = 'translate(' + xPos[i] + 'px, 0px)';
      });

      function tick(now) {
        if (!state.alive) return;
        if (!container.isConnected) {
          state.alive = false;
          typingAnimStates.delete(state);
          return;
        }

        if (state.hiddenAt) {
          state.t0 += now - state.hiddenAt;
          state.hiddenAt = 0;
        }

        state.lastTick = now;
        const elapsed = now - state.t0;
        const cycleNum = Math.floor(elapsed / CYCLE_MS);
        const local = elapsed - cycleNum * CYCLE_MS;
        const pair = pairs[cycleNum % pairs.length];
        const a = pair[0];
        const b = pair[1];

        if (local < BOUNCE_MS) {
          const bounceT = local / 1000;
          dots.forEach((d, i) => {
            const y = Math.sin(bounceT * 4.2 + i * 0.85) * 4;
            d.style.transform = 'translate(' + xPos[i] + 'px, ' + y + 'px)';
          });
        } else {
          const st = Math.min(1, (local - BOUNCE_MS) / MOVE_MS);
          const e = easeInOut(st);
          const fromA = xPos[a];
          const fromB = xPos[b];
          const xA = fromA + (fromB - fromA) * e;
          const xB = fromB + (fromA - fromB) * e;

          dots.forEach((d, i) => {
            let x = xPos[i];
            let y = 0;
            if (i === a) {
              x = xA;
              y = arcY(e, -1);
            } else if (i === b) {
              x = xB;
              y = arcY(e, 1);
            }
            d.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
          });

          if (st >= 1 && committedCycle !== cycleNum) {
            const tmp = xPos[a];
            xPos[a] = xPos[b];
            xPos[b] = tmp;
            committedCycle = cycleNum;
          }
        }

        state.rafId = requestAnimationFrame(tick);
      }

      function stopInner() {
        state.alive = false;
        if (state.rafId) {
          cancelAnimationFrame(state.rafId);
          state.rafId = null;
        }
        typingAnimStates.delete(state);
      }

      state.rafId = requestAnimationFrame(tick);
      typingAnimStates.add(state);
      return stopInner;
    }

    function bootTypingAnimation(container) {
      const state = {
        alive: true,
        container: container,
        rafId: null,
        bootIds: [],
        stopInner: null,
        t0: 0,
        lastTick: 0,
        hiddenAt: 0
      };

      const arm = () => {
        if (!state.alive || !container.isConnected) return;
        if (state.stopInner) state.stopInner();
        state.stopInner = startSwapLoadingAnimation(container, state);
      };

      const id1 = requestAnimationFrame(() => {
        if (!state.alive) return;
        const id2 = requestAnimationFrame(arm);
        state.bootIds.push(id2);
      });
      state.bootIds.push(id1);

      return function stop() {
        state.alive = false;
        state.bootIds.forEach((id) => cancelAnimationFrame(id));
        state.bootIds = [];
        if (state.stopInner) state.stopInner();
        typingAnimStates.delete(state);
      };
    }

    document.addEventListener('visibilitychange', () => {
      const now = performance.now();
      if (document.hidden) {
        typingAnimStates.forEach((s) => {
          if (s.alive && !s.hiddenAt) s.hiddenAt = now;
        });
        return;
      }
      typingAnimStates.forEach((s) => {
        if (!s.alive) return;
        if (s.hiddenAt) {
          s.t0 += now - s.hiddenAt;
          s.hiddenAt = 0;
        }
        if (!s.rafId && s.container && s.container.isConnected) {
          s.stopInner = startSwapLoadingAnimation(s.container, s);
        }
      });
    });

    setInterval(() => {
      const now = performance.now();
      typingAnimStates.forEach((s) => {
        if (!s.alive || !s.container || !s.container.isConnected) return;
        if (now - s.lastTick > 1400) {
          if (s.stopInner) s.stopInner();
          s.stopInner = startSwapLoadingAnimation(s.container, s);
        }
      });
    }, 700);

    function mountTypingLoader(parent) {
      parent.innerHTML = '';
      parent.classList.add('is-loading');
      const dotsEl = createTypingDotsElement('생각 중');
      parent.appendChild(dotsEl);
      const stop = bootTypingAnimation(dotsEl);
      return function stopAll() {
        stop();
        parent.classList.remove('is-loading');
      };
    }

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
      wrap.classList.remove('actions-ready');
      wrap.classList.add('actions-pending');

      const stopDots = mountTypingLoader(bubble);

      try {
        const res = await fetch(API_BASE + '/api/ai/chat', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({
            message: userText,
            messages: historyForApi(idx),
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

        stopDots();

        const norm = normalizeAssistantMessage(entry);
        norm.versions.push(reply);
        norm.versionIndex = norm.versions.length - 1;
        chatHistory[idx] = norm;

        await streamAssistantReply(bubble, reply);
        triggerGradientWave();
        updateVersionNav(wrap, wrap.querySelector('.assistant-actions'));
        persistCurrentSession();
      } catch (err) {
        stopDots();
        const norm = normalizeAssistantMessage(entry);
        setAssistantHtml(bubble, assistantActiveContent(norm));
        wrap.classList.remove('actions-pending');
        wrap.classList.add('actions-ready');
        showError(err.message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        console.error('[MinsuGPT]', err);
      } finally {
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
