if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html ??this module cannot run alone.");
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
      renderRoundedIcons(actions);
      updateUserActionVisibility();
    }

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

    function mountTypingLoader(parent) {
      parent.innerHTML = '';
      parent.classList.add('is-loading');
      const dotsEl = document.createElement('div');
      dotsEl.className = 'typing-dots';
      dotsEl.setAttribute('aria-label', '생각 중');
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.style.transform = 'translate(' + SLOT_X[i] + 'px, 0px)';
        dotsEl.appendChild(dot);
      }
      parent.appendChild(dotsEl);
      let stopAnim = function() {};
      let rafA = null;
      let rafB = null;
      rafA = requestAnimationFrame(() => {
        rafB = requestAnimationFrame(() => {
          stopAnim = startSwapLoadingAnimation(dotsEl);
        });
      });
      return function stop() {
        if (rafA) cancelAnimationFrame(rafA);
        if (rafB) cancelAnimationFrame(rafB);
        stopAnim();
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
          headers: { 'Content-Type': 'application/json' },
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
        chatMessages.scrollTop = chatMessages.scrollHeight;
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
      const dots = document.createElement('div');
      dots.className = 'typing-dots';
      dots.setAttribute('aria-label', '표 생성 중');
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.style.transform = 'translate(' + SLOT_X[i] + 'px, 0px)';
        dots.appendChild(dot);
      }
      const label = document.createElement('span');
      label.textContent = '표를 생성하는 중';
      card.appendChild(dots);
      card.appendChild(label);
      slot.appendChild(card);
      body.insertBefore(slot, tail);
      slot._stopAnim = startSwapLoadingAnimation(dots);
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
