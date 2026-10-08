// AptiQuiz Vanilla JS Client Application Router & Socket Manager

class AptiApp {
  constructor() {
    this.user = null;
    this.socket = null;
    this.currentRoom = null;
    this.soundEnabled = true;
    this.largeTextEnabled = false;
    this.rttMs = 0;
    this.customQuestionsList = [];
    this.pendingAiQuestions = [];
    this.instructionsSeen = false;
    this.pendingQuestionData = null;
    this.instructionsCountdownInterval = null;

    this.shapes = {
      A: { label: 'A', symbol: '■', class: 'shape-sq' },
      B: { label: 'B', symbol: '●', class: 'shape-ci' },
      C: { label: 'C', symbol: '▲', class: 'shape-tr' },
      D: { label: 'D', symbol: '◆', class: 'shape-di' },
    };

    this.init();
  }

  async init() {
    await this.checkAuth();
    this.initSocket();
    this.routeUrl();
  }

  routeUrl() {
    const hash = window.location.hash.replace('#', '');
    const path = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);
    const pinQuery = urlParams.get('pin');

    if (path.startsWith('/j/') || path.startsWith('/join/')) {
      const token = path.replace(/^\/(j|join)\//, '').trim();
      if (token) {
        this.pendingToken = token;
      }
    } else if (pinQuery) {
      this.pendingToken = pinQuery.trim();
    }

    if (this.pendingToken) {
      const input1 = document.getElementById('input-pin');
      const input2 = document.getElementById('join-pin');
      if (input1) input1.value = this.pendingToken;
      if (input2) input2.value = this.pendingToken;
      if (this.user) {
        this.handleInviteLink(this.pendingToken);
      } else {
        this.showScreen('signin');
      }
      return;
    }

    if (hash.startsWith('spectator')) {
      const pin = hash.split(':')[1];
      this.openSpectatorMode(pin);
      return;
    }

    if (hash.startsWith('proctor')) {
      const parts = hash.split(':');
      const pin = parts[1]?.split('?')[0];
      const codeMatch = hash.match(/code=([^&]+)/);
      const code = codeMatch ? codeMatch[1] : '';
      this.openProctorMode(pin, code);
      return;
    }

    if (hash && document.getElementById(`screen-${hash}`)) {
      this.showScreen(hash);
    } else {
      this.showScreen(this.user ? 'join' : 'signin');
    }
  }

  async checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        this.user = data.user;
        this.updateUserBadge();
        if (this.pendingToken) {
          this.handleInviteLink(this.pendingToken);
        }
      }
    } catch (e) {}
  }

  updateUserBadge() {
    const badge = document.getElementById('user-badge');
    const logoutBtn = document.getElementById('btn-logout');
    if (this.user) {
      badge.innerText = `${this.user.displayName}`;
      badge.classList.remove('hidden');
      logoutBtn.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    }
  }

  async quickSignIn(role = 'player') {
    const nameInput = document.getElementById('quick-name').value.trim() || (role === 'host' ? 'Host User' : 'Student');
    const res = await fetch('/api/auth/test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: nameInput, role }),
    });

    if (res.ok) {
      const data = await res.json();
      this.user = data.user;
      this.updateUserBadge();
      this.initSocket();
      if (this.pendingToken) {
        this.handleInviteLink(this.pendingToken);
      } else {
        this.showScreen('join');
      }
    }
  }

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    this.user = null;
    this.updateUserBadge();
    this.showScreen('signin');
  }

  goToDashboard() {
    if (this.user) {
      this.showScreen('join');
    } else {
      this.showScreen('signin');
    }
  }

  adjustCount(inputId, delta) {
    const input = document.getElementById(inputId);
    if (!input) return;
    let val = parseInt(input.value, 10) || 5;
    val = Math.max(1, Math.min(10, val + delta));
    input.value = val;
  }

  initSocket() {
    if (this.socket) this.socket.disconnect();

    this.socket = io({
      auth: { user: this.user },
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      document.getElementById('offline-banner').classList.add('hidden');
      this.startPingLoop();
    });

    this.socket.on('disconnect', () => {
      document.getElementById('offline-banner').classList.remove('hidden');
    });

    // Handle Socket events
    this.socket.on('room:state', (snapshot) => this.renderRoomState(snapshot));
    this.socket.on('room:player_joined', () => this.refreshLobby());
    this.socket.on('game:question_start', (data) => this.renderQuestion(data));
    this.socket.on('game:answer_acknowledged', () => {
      document.getElementById('answer-locked-notice').classList.remove('hidden');
    });
    this.socket.on('game:reveal', (data) => this.renderReveal(data));
    this.socket.on('game:leaderboard', (data) => this.renderLeaderboard(data));
    this.socket.on('game:finished', (data) => this.renderFinished(data));
    this.socket.on('player:warning', (data) => this.showWarningNotice(data));
    this.socket.on('player:disqualified', (data) => this.showDisqualifiedNotice(data));
    this.socket.on('error:notice', (err) => this.showError(err.message));
  }

  startPingLoop() {
    setInterval(() => {
      if (this.socket && this.socket.connected) {
        const start = Date.now();
        this.socket.emit('ping', start, (clientTime) => {
          this.rttMs = Date.now() - clientTime;
        });
      }
    }, 5000);
  }

  showScreen(screenId) {
    document.querySelectorAll('main section').forEach((sec) => sec.classList.add('hidden'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.remove('hidden');
      window.location.hash = screenId;
    }
  }

  // --- HOST ROOM CREATION & AUTHORING ---
  async createNewRoom() {
    this.customQuestionsList = [];
    this.renderEditorQuestions();
    this.showScreen('editor');
  }

  addCustomQuestion() {
    const text = document.getElementById('new-q-text').value.trim();
    const optA = document.getElementById('new-opt-a').value.trim();
    const optB = document.getElementById('new-opt-b').value.trim();
    const optC = document.getElementById('new-opt-c').value.trim();
    const optD = document.getElementById('new-opt-d').value.trim();
    const correct = document.getElementById('new-correct-opt').value;
    const explanation = document.getElementById('new-explanation').value.trim();
    const topic = document.getElementById('set-topic').value;
    const difficulty = document.getElementById('set-difficulty').value;

    if (!text || text.length < 5) {
      this.showError('Enter a valid question text of at least 5 characters.');
      return;
    }

    if (!optA || !optB) {
      this.showError('Provide at least Option A and Option B.');
      return;
    }

    const options = [
      { id: 'A', text: optA },
      { id: 'B', text: optB },
    ];
    if (optC) options.push({ id: 'C', text: optC });
    if (optD) options.push({ id: 'D', text: optD });

    const newQuestion = {
      id: this.customQuestionsList.length + 1,
      text,
      options,
      correct_option_id: correct,
      topic,
      difficulty,
      explanation,
    };

    this.customQuestionsList.push(newQuestion);

    // Clear input fields
    document.getElementById('new-q-text').value = '';
    document.getElementById('new-opt-a').value = '';
    document.getElementById('new-opt-b').value = '';
    document.getElementById('new-opt-c').value = '';
    document.getElementById('new-opt-d').value = '';
    document.getElementById('new-explanation').value = '';

    this.renderEditorQuestions();
  }

  renderEditorQuestions() {
    const container = document.getElementById('editor-questions-list');
    const countSpan = document.getElementById('set-q-count');

    if (countSpan) countSpan.innerText = this.customQuestionsList.length;
    if (!container) return;

    if (this.customQuestionsList.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-500 italic p-3 text-center border border-dashed rounded">No questions added yet. Type questions above, generate with AI, or upload a CSV file.</p>`;
      return;
    }

    container.innerHTML = this.customQuestionsList
      .map(
        (q, index) => `
      <div class="p-3 border border-slate-300 rounded bg-white space-y-2 text-xs">
        <div class="flex justify-between items-start">
          <p class="font-bold text-slate-900">${index + 1}. ${q.text}</p>
          <div class="space-x-1 flex text-xs">
            <button onclick="app.moveCustomQuestion(${index}, -1)" class="px-2 py-0.5 border rounded hover:bg-slate-100">▲</button>
            <button onclick="app.moveCustomQuestion(${index}, 1)" class="px-2 py-0.5 border rounded hover:bg-slate-100">▼</button>
            <button onclick="app.deleteCustomQuestion(${index})" class="px-2 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50">Delete</button>
          </div>
        </div>
        <p class="text-slate-600 font-mono">Options: ${q.options.map((o) => `${o.id}: ${o.text}`).join(' | ')}</p>
        <p class="text-slate-500">Correct: <span class="font-bold text-slate-800">Option ${q.correct_option_id}</span> ${q.explanation ? `| Explanation: ${q.explanation}` : ''}</p>
      </div>
    `
      )
      .join('');
  }

  moveCustomQuestion(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= this.customQuestionsList.length) return;
    const temp = this.customQuestionsList[index];
    this.customQuestionsList[index] = this.customQuestionsList[target];
    this.customQuestionsList[target] = temp;
    this.renderEditorQuestions();
  }

  deleteCustomQuestion(index) {
    this.customQuestionsList.splice(index, 1);
    this.renderEditorQuestions();
  }

  async launchRoomWithCustomSet() {
    const title = document.getElementById('set-title').value.trim() || 'Aptitude Quiz';
    const durationMs = parseInt(document.getElementById('set-duration').value, 10) || 15000;

    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: this.customQuestionsList,
        questionDurationMs: durationMs,
        settings: { title, durationMs },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      this.currentRoom = data.room;
      this.socket.emit('room:join', { pin: data.room.pin });
      this.renderLobby(data.room);
    } else {
      this.showError('Failed to create room.');
    }
  }

  joinByPin() {
    const pinInput = document.getElementById('input-pin') || document.getElementById('join-pin');
    const pin = pinInput ? pinInput.value.trim() : '';
    if (!pin || pin.length !== 6) {
      this.showError('Enter a valid 6-digit PIN.');
      return;
    }

    if (!this.socket) this.initSocket();

    this.socket.emit('room:join', { pin }, (response) => {
      if (response && response.success) {
        this.currentRoom = response.snapshot;
        if (response.snapshot.status === 'LOBBY') {
          this.renderLobby(response.snapshot);
        } else {
          this.showScreen('question');
        }
      } else {
        this.showError(response?.error?.message || 'Failed to join room. Check the 6-digit PIN.');
      }
    });
  }

  joinRoom() {
    return this.joinByPin();
  }

  handleInviteLink(token) {
    if (!token) return;
    this.showScreen('join');

    const isSixDigit = /^\d{6}$/.test(token);
    const payload = isSixDigit ? { pin: token } : { inviteToken: token };

    if (!this.socket) this.initSocket();

    this.socket.emit('room:join', payload, (response) => {
      if (response && response.success) {
        this.currentRoom = response.snapshot;
        this.pendingToken = null;
        if (response.snapshot.status === 'LOBBY') {
          this.renderLobby(response.snapshot);
        } else {
          this.showScreen('question');
        }
      } else {
        this.showError(response?.error?.message || 'Invalid or expired room link.');
      }
    });
  }

  renderLobby(snapshot) {
    this.instructionsSeen = false;
    this.showScreen('lobby');
    document.getElementById('lobby-pin').innerText = snapshot.pin;

    const hostControls = document.getElementById('host-controls');
    const isHost = this.user && (Number(snapshot.hostId) === Number(this.user.id) || this.user.role === 'host');
    if (isHost) {
      hostControls.classList.remove('hidden');
    } else {
      hostControls.classList.add('hidden');
    }

    const durationSelect = document.getElementById('lobby-question-duration');
    if (durationSelect && snapshot.questionDurationMs) {
      durationSelect.value = String(snapshot.questionDurationMs);
    }

    const playerList = document.getElementById('lobby-player-list');
    document.getElementById('lobby-count').innerText = snapshot.players.length;

    playerList.innerHTML = snapshot.players
      .map((p) => `<li class="py-1 text-sm font-medium text-slate-800 flex justify-between items-center"><span>${p.displayName}</span> ${p.status === 'disconnected' ? '<span class="text-xs text-amber-600">(Away)</span>' : ''}</li>`)
      .join('');
  }

  renderRoomState(snapshot) {
    this.currentRoom = snapshot;
    if (snapshot.status === 'LOBBY') {
      this.renderLobby(snapshot);
    }
  }

  refreshLobby() {
    if (this.currentRoom) {
      this.socket.emit('room:rejoin', { roomId: this.currentRoom.roomId });
    }
  }

  hostStartGame() {
    this.socket.emit('host:start_game');
  }

  // --- SEPARATE DASHBOARD COPY & SHARE URLS ---
  copyLink() {
    const url = `${window.location.origin}/j/${this.currentRoom?.inviteToken || this.currentRoom?.pin}`;
    navigator.clipboard.writeText(url);
    alert('Player Join Link copied to clipboard:\n' + url);
  }

  copySpectatorUrl() {
    const url = `${window.location.origin}/#spectator:${this.currentRoom?.pin}`;
    navigator.clipboard.writeText(url);
    alert('Spectator / Projector View URL copied:\n' + url);
  }

  copyProctorUrl() {
    const code = this.currentRoom?.proctorCode || 'PROCTOR';
    const url = `${window.location.origin}/#proctor:${this.currentRoom?.pin}?code=${code}`;
    navigator.clipboard.writeText(url);
    alert('Proctor / Referee Panel URL copied:\n' + url);
  }

  toggleLockRoom() {
    if (this.currentRoom) {
      const isLocked = !this.currentRoom.settings.locked;
      this.socket.emit('host:update_settings', { locked: isLocked });
      alert(`Room is now ${isLocked ? 'LOCKED' : 'UNLOCKED'}.`);
    }
  }

  updateQuestionDuration(valMs) {
    if (this.currentRoom) {
      const ms = Number(valMs);
      this.socket.emit('host:update_settings', { questionDurationMs: ms });
      alert(`Question duration set to ${ms / 1000} seconds per question.`);
    }
  }

  // --- SPECTATOR / PROJECTOR MODE DASHBOARD ---
  openSpectatorMode(pin) {
    this.showScreen('spectator');
    document.getElementById('spec-pin').innerText = pin || '------';
    document.getElementById('spec-link').innerText = `${window.location.origin}/j/${pin}`;

    if (window.QRCode && pin) {
      QRCode.render(document.getElementById('spec-qrcode'), `${window.location.origin}/j/${pin}`);
    }

    if (pin && this.socket) {
      this.socket.emit('room:join', { pin });
    }
  }

  // --- PROCTOR / REFEREE DASHBOARD ---
  openProctorMode(pin, code) {
    this.showScreen('proctor');
    document.getElementById('proctor-code-disp').innerText = code || 'PROCTOR';

    if (pin && this.socket) {
      this.socket.emit('room:join', { pin });
      if (code) {
        this.socket.emit('proctor:auth', { proctorCode: code });
      }
    }
  }

  renderQuestion(q) {
    if (!this.instructionsSeen) {
      this.instructionsSeen = true;
      this.pendingQuestionData = q;
      this.renderInstructions(q);
      return;
    }
    this.proceedToRenderQuestion(q);
  }

  renderInstructions(q) {
    this.showScreen('instructions');
    const countEl = document.getElementById('inst-q-count');
    const durEl = document.getElementById('inst-duration');
    const timerEl = document.getElementById('instructions-timer');

    if (countEl) countEl.innerText = q.totalQuestions || 10;
    if (durEl) durEl.innerText = `${(q.durationMs || 15000) / 1000}s`;

    let countdown = 5;
    if (timerEl) timerEl.innerText = countdown;

    if (this.instructionsCountdownInterval) {
      clearInterval(this.instructionsCountdownInterval);
    }

    this.instructionsCountdownInterval = setInterval(() => {
      countdown -= 1;
      if (timerEl) timerEl.innerText = Math.max(0, countdown);
      if (countdown <= 0) {
        clearInterval(this.instructionsCountdownInterval);
        this.instructionsCountdownInterval = null;
        this.startQuestionNow();
      }
    }, 1000);
  }

  startQuestionNow() {
    if (this.instructionsCountdownInterval) {
      clearInterval(this.instructionsCountdownInterval);
      this.instructionsCountdownInterval = null;
    }
    if (this.pendingQuestionData) {
      const q = this.pendingQuestionData;
      this.pendingQuestionData = null;
      this.proceedToRenderQuestion(q);
    }
  }

  proceedToRenderQuestion(q) {
    this.showScreen('question');
    document.getElementById('answer-locked-notice').classList.add('hidden');
    const inlineReveal = document.getElementById('inline-reveal-container');
    if (inlineReveal) inlineReveal.classList.add('hidden');
    
    document.querySelectorAll('#q-num').forEach(el => el.innerText = q.currentQuestionIndex || 1);
    document.querySelectorAll('#q-total').forEach(el => el.innerText = q.totalQuestions || 10);
    document.getElementById('q-text').innerText = q.text;

    const scoreBox = document.getElementById('player-score-box');
    if (scoreBox) scoreBox.innerText = `${this.userScore || 0} pts`;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    q.options.forEach((opt, idx) => {
      const letter = ['A', 'B', 'C', 'D'][idx] || 'A';
      const shapeInfo = this.shapes[letter] || this.shapes['A'];

      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.onclick = () => this.submitAnswer(q.questionId, opt.id, btn);

      btn.innerHTML = `
        <span class="option-shape ${shapeInfo.class}"><span>${shapeInfo.symbol}</span></span>
        <span>${opt.text}</span>
      `;
      optionsContainer.appendChild(btn);
    });

    this.startCountdown(q.durationMs || 15000);
  }

  startCountdown(durationMs) {
    const bar = document.getElementById('timer-bar');
    const text = document.getElementById('timer-text');
    const start = performance.now();

    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const elapsed = performance.now() - start;
      const remainingMs = Math.max(0, durationMs - elapsed);
      const remainingSec = (remainingMs / 1000).toFixed(1);

      if (text) text.innerText = `${remainingSec}s`;
      if (bar) bar.style.width = `${(remainingMs / durationMs) * 100}%`;

      if (remainingMs <= 0) {
        clearInterval(this.timerInterval);
      }
    }, 100);
  }

  submitAnswer(questionId, selectedOption, btnElement) {
    document.querySelectorAll('.option-btn').forEach((b) => b.classList.remove('selected'));
    btnElement.classList.add('selected');

    this.socket.emit('player:submit_answer', {
      questionId,
      selectedOption,
      clientSendTime: Date.now(),
    });
  }

  renderReveal(data) {
    // Show reveal inline on question screen WITHOUT full-screen transition!
    if (typeof data.newTotalScore === 'number') {
      this.userScore = data.newTotalScore;
    } else if (data.isCorrect) {
      this.userScore = (this.userScore || 0) + (data.pointsEarned || 0);
    }

    const inlineContainer = document.getElementById('inline-reveal-container');
    const inlineText = document.getElementById('inline-reveal-text');
    const inlineExp = document.getElementById('inline-reveal-explanation');

    if (inlineContainer && inlineText) {
      if (data.isCorrect) {
        inlineContainer.className = 'p-4 rounded-lg border bg-emerald-50 border-emerald-300 text-emerald-950 my-3 text-left';
        inlineText.innerText = `✓ Correct! +${data.pointsEarned || 0} points. Answered in ${((data.adjustedTimeMs || 0) / 1000).toFixed(1)} seconds.`;
      } else {
        inlineContainer.className = 'p-4 rounded-lg border bg-rose-50 border-rose-300 text-rose-950 my-3 text-left';
        inlineText.innerText = `✗ Incorrect or time expired. Correct answer: Option ${data.correctOptionId}`;
      }

      const scoreBox = document.getElementById('player-score-box');
      if (scoreBox) scoreBox.innerText = `${this.userScore || 0} pts`;

      if (inlineExp) inlineExp.innerText = data.explanation || '';
      inlineContainer.classList.remove('hidden');
    }
  }

  renderSideLeaderboard(top10, myRank) {
    const desktopContainer = document.getElementById('live-side-leaderboard');
    const mobileContainer = document.getElementById('mobile-leaderboard-list');

    if (!top10 || !Array.isArray(top10)) return;

    const renderListHTML = (list) => {
      let html = list
        .slice(0, 10)
        .map((p) => {
          let movement = '─';
          let movementClass = 'text-slate-400';
          if (p.delta === 'climbed') {
            movement = '▲';
            movementClass = 'text-emerald-600 font-bold';
          } else if (p.delta === 'dropped') {
            movement = '▼';
            movementClass = 'text-rose-600 font-bold';
          }

          const isMe = this.user && p.userId === this.user.id;

          return `
            <div class="p-2 flex justify-between items-center text-xs ${isMe ? 'bg-amber-50 font-bold border-l-2 border-amber-500' : ''}">
              <div class="flex items-center space-x-2 truncate">
                <span class="font-mono text-slate-500 font-semibold w-5 text-right">${p.rank}</span>
                <span class="truncate max-w-[120px] text-slate-800 font-medium">${p.displayName}${isMe ? ' (You)' : ''}</span>
                <span class="${movementClass} text-[10px]">${movement}</span>
              </div>
              <span class="font-mono font-bold text-slate-900">${p.score} pts</span>
            </div>
          `;
        })
        .join('');

      // If current player is outside top 10, pin player's own rank at bottom
      if (myRank && myRank.rank > 10 && this.user) {
        let m = '─';
        let mc = 'text-slate-400';
        if (myRank.delta === 'climbed') { m = '▲'; mc = 'text-emerald-600 font-bold'; }
        else if (myRank.delta === 'dropped') { m = '▼'; mc = 'text-rose-600 font-bold'; }

        html += `
          <div class="p-2 flex justify-between items-center text-xs bg-amber-100/80 font-bold border-t-2 border-amber-400 text-slate-900">
            <div class="flex items-center space-x-2 truncate">
              <span class="font-mono text-amber-900 w-5 text-right">#${myRank.rank}</span>
              <span class="truncate max-w-[120px] text-amber-950 font-bold">${this.user.displayName || 'You'} (You)</span>
              <span class="${mc} text-[10px]">${m}</span>
            </div>
            <span class="font-mono font-bold text-amber-950">${myRank.score} pts</span>
          </div>
        `;
      }

      return html;
    };

    const formattedHTML = renderListHTML(top10);
    if (desktopContainer) desktopContainer.innerHTML = formattedHTML;
    if (mobileContainer) mobileContainer.innerHTML = formattedHTML;
  }

  renderLeaderboard(data) {
    if (data.myRank && typeof data.myRank.score === 'number') {
      this.userScore = data.myRank.score;
      const scoreBox = document.getElementById('player-score-box');
      if (scoreBox) scoreBox.innerText = `${this.userScore || 0} pts`;
    }
    if (data.top10) {
      this.renderSideLeaderboard(data.top10, data.myRank);
    }
  }

  openMobileLeaderboard() {
    const backdrop = document.getElementById('backdrop-mobile-leaderboard');
    const sheet = document.getElementById('bottom-sheet-leaderboard');
    if (backdrop) backdrop.classList.remove('hidden');
    if (sheet) sheet.classList.remove('hidden');
  }

  closeMobileLeaderboard() {
    const backdrop = document.getElementById('backdrop-mobile-leaderboard');
    const sheet = document.getElementById('bottom-sheet-leaderboard');
    if (backdrop) backdrop.classList.add('hidden');
    if (sheet) sheet.classList.add('hidden');
  }

  renderFinished(data) {
    this.showScreen('results');
    const summary = data?.summary;
    if (!summary) return;

    // Render my performance stats
    if (summary.myStats) {
      const s = summary.myStats;
      const accVal = document.getElementById('res-accuracy-val');
      const accDetail = document.getElementById('res-correct-detail');
      const speedVal = document.getElementById('res-speed-val');

      if (accVal) accVal.innerText = `${s.accuracyPct}%`;
      if (accDetail) accDetail.innerText = `${s.correctCount} / ${s.totalQuestions} Correct`;
      if (speedVal) speedVal.innerText = `${s.avgSpeedSec}s`;

      // Topic strengths progress bars
      const topicContainer = document.getElementById('results-topic-bars');
      if (topicContainer && s.topicStrengths) {
        topicContainer.innerHTML = Object.entries(s.topicStrengths)
          .map(([tName, tData]) => `
            <div class="space-y-1">
              <div class="flex justify-between font-semibold text-slate-700 capitalize">
                <span>${tName.replace('_', ' ')}</span>
                <span>${tData.correct}/${tData.total} (${tData.pct}%)</span>
              </div>
              <div class="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                <div class="bg-blue-900 h-full rounded-full" style="width: ${tData.pct}%"></div>
              </div>
            </div>
          `)
          .join('');
      }
    }

    // Render final rankings table
    if (summary.fullRankings) {
      const body = document.getElementById('results-body');
      if (body) {
        body.innerHTML = summary.fullRankings
          .map((p, idx) => {
            const isMe = this.user && p.userId === this.user.id;
            return `
              <tr class="${isMe ? 'bg-amber-50 font-bold' : ''}">
                <td class="p-2 font-bold">${idx + 1}</td>
                <td class="p-2">${p.displayName} ${isMe ? '<span class="text-xs bg-amber-200 text-amber-900 px-1 rounded">(You)</span>' : ''}</td>
                <td class="p-2 text-right font-mono font-bold">${p.score} pts</td>
              </tr>
            `;
          })
          .join('');
      }
    }
  }

  showWarningNotice(data) {
    alert(`Warning ${data.warningCount} of ${data.maxWarnings}: ${data.reason}. At 3 warnings you will be disqualified.`);
  }

  showDisqualifiedNotice(data) {
    alert(`You have been disqualified: ${data.reason}`);
    this.showScreen('signin');
  }

  showError(msg) {
    const container = document.getElementById('error-container');
    if (!container) return;
    container.innerHTML = `<div class="error-banner">${msg}</div>`;
    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  }

  toggleLargeText() {
    this.largeTextEnabled = !this.largeTextEnabled;
    document.body.classList.toggle('large-text', this.largeTextEnabled);
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    document.getElementById('btn-sound-toggle').innerText = `Sound: ${this.soundEnabled ? 'ON' : 'OFF'}`;
  }

  async requestAiQuestionsFromEditor() {
    const customTopic = document.getElementById('editor-ai-custom-topic')?.value.trim();
    const category = document.getElementById('editor-ai-topic').value;
    const topic = customTopic || category || 'General Aptitude';
    const difficulty = document.getElementById('editor-ai-difficulty').value;
    const count = parseInt(document.getElementById('editor-ai-count').value, 10) || 5;
    const statusDiv = document.getElementById('ai-gen-status');
    const btn = document.getElementById('btn-generate-ai');

    if (statusDiv) statusDiv.classList.remove('hidden');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/questions/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, category, difficulty, count }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.questions && data.questions.length > 0) {
        this.pendingAiQuestions = data.questions.map((q) => ({
          ...q,
          isEditing: false,
        }));
        this.renderAiReview();
      } else {
        const errorMsg = data.message || 'AI generation failed. Please try again or type questions manually.';
        this.showError(errorMsg);
      }
    } catch (err) {
      this.showError('Error connecting to AI service. Please check your network connection.');
    } finally {
      if (statusDiv) statusDiv.classList.add('hidden');
      if (btn) btn.disabled = false;
    }
  }

  async requestAiQuestions() {
    const topic = document.getElementById('ai-topic')?.value.trim() || 'General Aptitude';
    const category = document.getElementById('ai-category')?.value || 'quantitative';
    const difficulty = document.getElementById('ai-difficulty')?.value || 'medium';
    const count = parseInt(document.getElementById('ai-count')?.value, 10) || 5;

    try {
      const res = await fetch('/api/questions/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, category, difficulty, count }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.questions && data.questions.length > 0) {
        this.pendingAiQuestions = data.questions.map((q) => ({
          ...q,
          isEditing: false,
        }));
        this.renderAiReview();
      } else {
        const errorMsg = data.message || 'AI generation failed. Please try again or type questions manually.';
        this.showError(errorMsg);
      }
    } catch (err) {
      this.showError('Error connecting to AI service.');
    }
  }

  renderAiReview() {
    this.showScreen('ai-review');
    const list = document.getElementById('ai-pending-list');
    if (!list) return;

    if (!this.pendingAiQuestions || this.pendingAiQuestions.length === 0) {
      list.innerHTML = `<p class="text-sm text-slate-500 italic p-4 text-center border rounded">All pending AI questions have been reviewed.</p>`;
      setTimeout(() => this.showScreen('editor'), 1000);
      return;
    }

    list.innerHTML = this.pendingAiQuestions
      .map((q, idx) => {
        if (q.isEditing) {
          return `
            <div class="p-4 border border-blue-300 rounded bg-blue-50/50 space-y-3 text-xs">
              <p class="font-bold text-slate-800">Editing Question #${idx + 1}</p>
              <textarea id="edit-ai-text-${idx}" rows="2" class="w-full border p-2 rounded text-xs bg-white">${q.text}</textarea>
              <div class="grid grid-cols-2 gap-2">
                ${q.options
                  .map(
                    (opt) => `
                  <div>
                    <label class="font-semibold text-slate-600">Option ${opt.id}:</label>
                    <input id="edit-ai-opt-${idx}-${opt.id}" type="text" value="${opt.text}" class="w-full border p-1 rounded text-xs bg-white">
                  </div>
                `
                  )
                  .join('')}
              </div>
              <div class="flex items-center space-x-2">
                <label class="font-semibold text-slate-700">Correct Option:</label>
                <select id="edit-ai-correct-${idx}" class="border p-1 rounded text-xs bg-white">
                  <option value="A" ${q.correct_option_id === 'A' ? 'selected' : ''}>Option A</option>
                  <option value="B" ${q.correct_option_id === 'B' ? 'selected' : ''}>Option B</option>
                  <option value="C" ${q.correct_option_id === 'C' ? 'selected' : ''}>Option C</option>
                  <option value="D" ${q.correct_option_id === 'D' ? 'selected' : ''}>Option D</option>
                </select>
              </div>
              <textarea id="edit-ai-exp-${idx}" rows="1" placeholder="Explanation" class="w-full border p-1 rounded text-xs bg-white">${q.explanation || ''}</textarea>
              <div class="flex space-x-2">
                <button onclick="app.saveEditAiQuestion(${idx})" class="btn-navy py-1 px-3">Save Changes</button>
                <button onclick="app.cancelEditAiQuestion(${idx})" class="btn-outline py-1 px-3">Cancel</button>
              </div>
            </div>
          `;
        }

        return `
          <div class="p-4 border border-slate-300 rounded bg-slate-50 space-y-2 text-xs">
            <p class="font-bold text-slate-900 text-sm">${idx + 1}. ${q.text}</p>
            <div class="space-y-1 text-slate-700">
              ${q.options.map((o) => `<p><span class="font-bold font-mono">${o.id}:</span> ${o.text}</p>`).join('')}
            </div>
            <p class="text-slate-600 border-t pt-2">Correct: <span class="font-bold text-slate-900">Option ${q.correct_option_id}</span> | Explanation: ${q.explanation || 'None'}</p>
            <div class="flex space-x-2 pt-2">
              <button onclick="app.confirmAiQuestion(${idx})" class="btn-navy py-1 px-3">✓ Confirm & Add</button>
              <button onclick="app.toggleEditAiQuestion(${idx})" class="btn-outline py-1 px-3 text-slate-700">✏️ Edit</button>
              <button onclick="app.declineAiQuestion(${idx})" class="btn-outline py-1 px-3 text-red-600 border-red-200 hover:bg-red-50">✕ Decline</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  confirmAiQuestion(idx) {
    const q = this.pendingAiQuestions[idx];
    if (!q) return;
    q.id = this.customQuestionsList.length + 1;
    this.customQuestionsList.push(q);
    this.pendingAiQuestions.splice(idx, 1);
    this.renderEditorQuestions();
    this.renderAiReview();
  }

  declineAiQuestion(idx) {
    this.pendingAiQuestions.splice(idx, 1);
    this.renderAiReview();
  }

  toggleEditAiQuestion(idx) {
    if (this.pendingAiQuestions[idx]) {
      this.pendingAiQuestions[idx].isEditing = true;
      this.renderAiReview();
    }
  }

  cancelEditAiQuestion(idx) {
    if (this.pendingAiQuestions[idx]) {
      this.pendingAiQuestions[idx].isEditing = false;
      this.renderAiReview();
    }
  }

  saveEditAiQuestion(idx) {
    const q = this.pendingAiQuestions[idx];
    if (!q) return;

    const text = document.getElementById(`edit-ai-text-${idx}`)?.value.trim();
    const correct = document.getElementById(`edit-ai-correct-${idx}`)?.value;
    const exp = document.getElementById(`edit-ai-exp-${idx}`)?.value.trim();

    if (text) q.text = text;
    if (correct) q.correct_option_id = correct;
    if (exp !== undefined) q.explanation = exp;

    q.options.forEach((opt) => {
      const optVal = document.getElementById(`edit-ai-opt-${idx}-${opt.id}`)?.value.trim();
      if (optVal) opt.text = optVal;
    });

    q.isEditing = false;
    this.renderAiReview();
  }

  confirmAllAiQuestions() {
    if (!this.pendingAiQuestions || this.pendingAiQuestions.length === 0) {
      this.showScreen('editor');
      return;
    }
    this.pendingAiQuestions.forEach((q) => {
      q.id = this.customQuestionsList.length + 1;
      this.customQuestionsList.push(q);
    });
    this.pendingAiQuestions = [];
    this.renderEditorQuestions();
    this.showScreen('editor');
  }
}

window.app = new AptiApp();
