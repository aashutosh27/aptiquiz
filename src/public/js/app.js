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
    window.addEventListener('hashchange', () => this.routeUrl());
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
    this.socket.on('room:player_joined', () => this.refreshProctorRoster());
    this.socket.on('room:player_left', () => this.refreshProctorRoster());
    this.socket.on('room:warning_issued', (data) => this.handleWarningIssued(data));
    this.socket.on('room:warning_revoked', () => this.refreshProctorRoster());
    this.socket.on('room:player_reinstated', () => this.refreshProctorRoster());
    this.socket.on('room:player_kicked', () => this.refreshProctorRoster());
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
    const cardWrapper = document.getElementById('main-card-wrapper');

    if (cardWrapper) {
      if (['proctor', 'host-live', 'editor', 'spectator', 'league', 'question', 'results'].includes(screenId)) {
        cardWrapper.className = 'w-full max-w-4xl bg-white border border-slate-200 rounded-lg p-4 sm:p-6 shadow-sm transition-all duration-150';
      } else {
        cardWrapper.className = 'w-full max-w-xl bg-white border border-slate-200 rounded-lg p-4 sm:p-6 shadow-sm transition-all duration-150';
      }
    }

    if (target) {
      target.classList.remove('hidden');
      const currentHash = window.location.hash.replace('#', '');
      if (!currentHash.startsWith('proctor:') && !currentHash.startsWith('spectator:')) {
        window.location.hash = screenId;
      }
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
    const qImage = document.getElementById('new-q-image')?.value.trim() || '';
    const optA = document.getElementById('new-opt-a').value.trim();
    const optAImg = document.getElementById('new-opt-a-img')?.value.trim() || '';
    const optB = document.getElementById('new-opt-b').value.trim();
    const optBImg = document.getElementById('new-opt-b-img')?.value.trim() || '';
    const optC = document.getElementById('new-opt-c').value.trim();
    const optCImg = document.getElementById('new-opt-c-img')?.value.trim() || '';
    const optD = document.getElementById('new-opt-d').value.trim();
    const optDImg = document.getElementById('new-opt-d-img')?.value.trim() || '';
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
      { id: 'A', text: optA, image_url: optAImg || undefined },
      { id: 'B', text: optB, image_url: optBImg || undefined },
    ];
    if (optC) options.push({ id: 'C', text: optC, image_url: optCImg || undefined });
    if (optD) options.push({ id: 'D', text: optD, image_url: optDImg || undefined });

    const newQuestion = {
      id: this.customQuestionsList.length + 1,
      text,
      image_url: qImage || undefined,
      options,
      correct_option_id: correct,
      topic,
      difficulty,
      explanation,
    };

    this.customQuestionsList.push(newQuestion);

    // Clear input fields
    document.getElementById('new-q-text').value = '';
    if (document.getElementById('new-q-image')) document.getElementById('new-q-image').value = '';
    document.getElementById('new-opt-a').value = '';
    if (document.getElementById('new-opt-a-img')) document.getElementById('new-opt-a-img').value = '';
    document.getElementById('new-opt-b').value = '';
    if (document.getElementById('new-opt-b-img')) document.getElementById('new-opt-b-img').value = '';
    document.getElementById('new-opt-c').value = '';
    if (document.getElementById('new-opt-c-img')) document.getElementById('new-opt-c-img').value = '';
    document.getElementById('new-opt-d').value = '';
    if (document.getElementById('new-opt-d-img')) document.getElementById('new-opt-d-img').value = '';
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
    const shareUrl = `${window.location.origin}/j/${snapshot.pin}`;
    const shareEl = document.getElementById('lobby-share-url');
    if (shareEl) shareEl.innerText = shareUrl;

    const qrBox = document.getElementById('lobby-qrcode');
    if (window.QRCode && snapshot.pin && qrBox) {
      qrBox.innerHTML = '';
      qrBox.classList.remove('hidden');
      QRCode.render(qrBox, shareUrl);
    } else if (qrBox) {
      qrBox.classList.add('hidden');
    }

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
      .map((p) => {
        const isSelf = Number(p.userId) === Number(this.user?.id);
        const hostBtn = (isHost && !isSelf) ? `
          <div class="space-x-1 flex text-xs">
            <button onclick="app.proctorWarn(${p.userId}, '${(p.displayName || '').replace(/'/g, "\\'")}')" class="px-1.5 py-0.5 border border-amber-300 text-amber-800 rounded hover:bg-amber-50">⚠️ Warn</button>
            <button onclick="app.proctorKick(${p.userId}, '${(p.displayName || '').replace(/'/g, "\\'")}')" class="px-1.5 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50">🚫 Kick</button>
          </div>
        ` : '';
        return `
          <li class="py-1.5 text-sm font-medium text-slate-800 flex justify-between items-center">
            <span>${p.displayName} ${p.status === 'disconnected' ? '<span class="text-xs text-amber-600">(Away)</span>' : ''} ${p.status === 'disqualified' ? '<span class="text-xs text-red-600 font-bold">(Disqualified)</span>' : ''}</span>
            ${hostBtn}
          </li>
        `;
      })
      .join('');
  }

  renderRoomState(snapshot) {
    this.currentRoom = snapshot;
    if (snapshot.status === 'LOBBY') {
      this.renderLobby(snapshot);
    }
    const proctorScreen = document.getElementById('screen-proctor');
    if (proctorScreen && !proctorScreen.classList.contains('hidden')) {
      this.renderProctorRoster();
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

    let targetPin = pin || (this.currentRoom ? this.currentRoom.pin : '');
    let targetCode = code || (this.currentRoom ? this.currentRoom.proctorCode : '');

    if (!targetPin) {
      targetPin = prompt('Enter 6-Digit Room PIN:');
      if (!targetPin) {
        this.showScreen('join');
        return;
      }
    }

    if (!targetCode) {
      targetCode = prompt('Enter Referee / Proctor Code:');
      if (!targetCode) {
        this.showScreen('join');
        return;
      }
    }

    document.getElementById('proctor-code-disp').innerText = targetCode.trim();

    if (!this.socket) this.initSocket();

    const executeAuthAndJoin = () => {
      this.socket.emit('room:join', { pin: targetPin.trim() }, (joinRes) => {
        if (joinRes && joinRes.success) {
          this.currentRoom = joinRes.snapshot;
          this.renderProctorRoster();

          this.socket.emit('proctor:auth', { proctorCode: targetCode.trim(), pin: targetPin.trim() }, (authRes) => {
            if (authRes && authRes.success) {
              console.log('Referee / Proctor authenticated successfully.');
            } else {
              this.showError(authRes?.error?.message || 'Invalid Proctor Code');
            }
          });
        } else {
          this.showError(joinRes?.error?.message || 'Failed to join room as Referee.');
        }
      });
    };

    if (this.socket.connected) {
      executeAuthAndJoin();
    } else {
      this.socket.once('connect', () => {
        executeAuthAndJoin();
      });
    }
  }

  renderProctorRoster() {
    const list = document.getElementById('proctor-player-list');
    const countEl = document.getElementById('proctor-player-count');
    if (!list) return;

    if (!this.currentRoom || !this.currentRoom.players) {
      list.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400 italic">No players connected to this room.</td></tr>`;
      if (countEl) countEl.innerText = '0';
      return;
    }

    const hostId = Number(this.currentRoom.hostId);
    const rawPlayers = Array.isArray(this.currentRoom.players)
      ? this.currentRoom.players
      : Array.from(this.currentRoom.players.values());

    const players = rawPlayers
      .filter((p) => Number(p.userId) !== hostId)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    if (countEl) countEl.innerText = players.length;

    if (players.length === 0) {
      list.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400 italic">No student players joined yet.</td></tr>`;
      return;
    }

    list.innerHTML = players
      .map((p, idx) => {
        const isDisqualified = p.status === 'disqualified';
        const warningCount = p.warningCount || 0;
        const rank = idx + 1;

        let warningBadge = '';
        if (isDisqualified) {
          warningBadge = `<span class="text-xs font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">🚫 Disqualified (3/3)</span>`;
        } else if (warningCount === 2) {
          warningBadge = `<span class="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">⚠️⚠️ 2 / 3 Warnings</span>`;
        } else if (warningCount === 1) {
          warningBadge = `<span class="text-xs font-semibold bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">⚠️ 1 / 3 Warning</span>`;
        } else {
          warningBadge = `<span class="text-xs font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">0 / 3 Clean</span>`;
        }

        const actionsHtml = isDisqualified
          ? `
          <button onclick="app.proctorReinstate(${p.userId})" class="btn-outline text-xs px-2.5 py-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 font-semibold">
            🔄 Reinstate Player
          </button>
        `
          : `
          <button onclick="app.proctorWarnCheating(${p.userId}, '${(p.displayName || '').replace(/'/g, "\\'")}')" class="btn-outline text-xs px-2.5 py-1 text-amber-900 bg-amber-50 border-amber-300 hover:bg-amber-100 font-bold shadow-sm">
            ⚠️ Warn for Cheating
          </button>
        `;

        return `
          <tr class="${isDisqualified ? 'bg-rose-50/50 opacity-75' : 'hover:bg-slate-50'} text-xs">
            <td class="p-2.5 font-mono font-bold text-center text-slate-600">#${rank}</td>
            <td class="p-2.5 font-medium text-slate-900">
              <div class="flex items-center space-x-1.5">
                <span>${p.displayName}</span>
                ${p.status === 'disconnected' ? '<span class="text-[10px] text-amber-600">(Away)</span>' : ''}
              </div>
            </td>
            <td class="p-2.5 text-right font-mono font-bold text-blue-950 text-sm">${p.score || 0} pts</td>
            <td class="p-2.5 text-center">${warningBadge}</td>
            <td class="p-2.5 text-right space-x-1">${actionsHtml}</td>
          </tr>
        `;
      })
      .join('');
  }

  proctorWarnCheating(targetUserId, displayName) {
    const reasons = [
      'Cheating / Tab switching detected',
      'Suspicious off-screen behavior',
      'Multiple devices / Unauthorized assistance',
      'Proctoring rule violation'
    ];
    const selected = prompt(`Issue Warning to ${displayName} for Cheating:\n\n1. ${reasons[0]}\n2. ${reasons[1]}\n3. ${reasons[2]}\n4. ${reasons[3]}\n\nEnter number (1-4) or type custom reason:`, '1');

    if (!selected) return;

    let reason = reasons[0];
    if (selected === '2') reason = reasons[1];
    else if (selected === '3') reason = reasons[2];
    else if (selected === '4') reason = reasons[3];
    else if (selected.length > 2) reason = selected;

    this.socket.emit('proctor:warn_player', { targetUserId, reason }, (res) => {
      if (res && res.success) {
        alert(`Warning issued to ${displayName}. (At 3 warnings player will be disqualified).`);
        this.refreshProctorRoster();
      } else if (res && res.error) {
        this.showError(res.error.message || 'Failed to issue warning.');
      }
    });
  }

  proctorWarn(targetUserId, displayName) {
    this.proctorWarnCheating(targetUserId, displayName);
  }

  proctorKick(targetUserId, displayName) {
    if (!confirm(`Are you sure you want to BAN / KICK ${displayName} from the room?`)) return;

    this.socket.emit('host:kick_player', { targetUserId });
    alert(`${displayName} has been kicked from the room.`);
    this.refreshProctorRoster();
  }

  proctorReinstate(targetUserId) {
    this.socket.emit('proctor:reinstate_player', { targetUserId }, (res) => {
      if (res && res.success) {
        alert('Player has been reinstated to active state with 2 warnings.');
        this.refreshProctorRoster();
      } else if (res && res.error) {
        this.showError(res.error.message || 'Failed to reinstate player.');
      }
    });
  }

  refreshProctorRoster() {
    this.refreshLobby();
    const proctorScreen = document.getElementById('screen-proctor');
    if (proctorScreen && !proctorScreen.classList.contains('hidden')) {
      this.renderProctorRoster();
    }
  }

  handleWarningIssued(data) {
    this.refreshProctorRoster();
  }

  renderQuestion(q) {
    const isHost = this.user && (
      (this.currentRoom && Number(this.currentRoom.hostId) === Number(this.user.id)) ||
      this.user.role === 'host'
    );

    if (isHost) {
      this.renderHostLiveDashboard(q);
      return;
    }

    if (!this.instructionsSeen) {
      this.instructionsSeen = true;
      this.pendingQuestionData = q;
      this.renderInstructions(q);
      return;
    }
    this.proceedToRenderQuestion(q);
  }

  renderHostLiveDashboard(q) {
    this.showScreen('host-live');
    this.hostLiveCurrentQ = q;

    const qNum = document.getElementById('host-live-q-num');
    const qTotal = document.getElementById('host-live-q-total');
    const qText = document.getElementById('host-live-q-text');
    const topicBadge = document.getElementById('host-live-topic-badge');

    if (qNum) qNum.innerText = q.currentQuestionIndex || 1;
    if (qTotal) qTotal.innerText = q.totalQuestions || 10;
    if (qText) qText.innerText = q.text || '';
    if (topicBadge) topicBadge.innerText = q.topic || 'Quantitative';

    const hostImgContainer = document.getElementById('host-live-q-image-container');
    const hostImg = document.getElementById('host-live-q-image');
    if (q.image_url && hostImgContainer && hostImg) {
      hostImg.src = q.image_url;
      hostImgContainer.classList.remove('hidden');
    } else if (hostImgContainer) {
      hostImgContainer.classList.add('hidden');
    }

    this.startHostCountdown(q.durationMs || 15000);
    this.updateHostLiveStats();
  }

  startHostCountdown(durationMs) {
    const timerText = document.getElementById('host-live-timer');
    const start = performance.now();

    if (this.hostTimerInterval) clearInterval(this.hostTimerInterval);

    this.hostTimerInterval = setInterval(() => {
      const elapsed = performance.now() - start;
      const remainingMs = Math.max(0, durationMs - elapsed);
      const remainingSec = (remainingMs / 1000).toFixed(1);

      if (timerText) timerText.innerText = `${remainingSec}s`;

      if (remainingMs <= 0) {
        clearInterval(this.hostTimerInterval);
      }
    }, 100);
  }

  updateHostLiveStats() {
    if (!this.currentRoom) return;

    const answeredCountEl = document.getElementById('host-live-answered-count');
    const totalPlayersEl = document.getElementById('host-live-total-players');
    const lbBody = document.getElementById('host-live-leaderboard-body');

    const playersList = Array.from(this.currentRoom.players ? this.currentRoom.players.values() : [])
      .filter((p) => Number(p.userId) !== Number(this.currentRoom.hostId) && p.status !== 'disqualified')
      .sort((a, b) => b.score - a.score);

    if (totalPlayersEl) totalPlayersEl.innerText = playersList.length;

    const answeredSize = this.lastLeaderboardData?.top10?.length || 0;
    if (answeredCountEl) answeredCountEl.innerText = Math.min(playersList.length, answeredSize);

    if (lbBody) {
      if (playersList.length === 0) {
        lbBody.innerHTML = `<tr><td colspan="3" class="p-3 text-center text-slate-400 text-xs italic">Waiting for student players to join room...</td></tr>`;
        return;
      }

      lbBody.innerHTML = playersList.map((p, index) => `
        <tr class="hover:bg-slate-50">
          <td class="p-2 font-mono font-bold text-slate-600">${index + 1}</td>
          <td class="p-2 font-medium text-slate-900 flex items-center space-x-1">
            <span>${p.displayName}</span>
            ${p.status === 'disconnected' ? '<span class="text-[10px] text-amber-600 font-normal">(Away)</span>' : ''}
          </td>
          <td class="p-2 text-right font-mono font-bold text-blue-950">${p.score} pts</td>
        </tr>
      `).join('');
    }
  }

  hostNextOrReveal() {
    if (this.currentRoom) {
      this.socket.emit('host:start_game');
    }
  }

  renderLeague() {
    this.showScreen('league');
    const container = document.getElementById('league-items-body');
    if (!container) return;

    if (this.currentRoom && this.currentRoom.players) {
      const activePlayers = Array.from(this.currentRoom.players.values())
        .filter((p) => Number(p.userId) !== Number(this.currentRoom.hostId) && p.status !== 'disqualified')
        .sort((a, b) => b.score - a.score);

      if (activePlayers.length > 0) {
        container.innerHTML = activePlayers.map((p, idx) => `
          <div class="p-3 flex justify-between items-center text-sm hover:bg-slate-50">
            <span class="font-medium text-slate-900">${idx + 1}. ${p.displayName}</span>
            <span class="font-bold font-mono text-blue-950">${p.score} pts</span>
          </div>
        `).join('');
        return;
      }
    }

    container.innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs italic">
        No active league standings recorded yet. Host or join a live room to compete on the standings leaderboard!
      </div>
    `;
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

    const qImgContainer = document.getElementById('q-image-container');
    const qImg = document.getElementById('q-image');
    if (q.image_url && qImgContainer && qImg) {
      qImg.src = q.image_url;
      qImgContainer.classList.remove('hidden');
    } else if (qImgContainer) {
      qImgContainer.classList.add('hidden');
    }

    const scoreBox = document.getElementById('player-score-box');
    if (scoreBox) scoreBox.innerText = `${this.userScore || 0} pts`;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    q.options.forEach((opt, idx) => {
      const letter = ['A', 'B', 'C', 'D'][idx] || 'A';
      const shapeInfo = this.shapes[letter] || this.shapes['A'];

      const btn = document.createElement('button');
      btn.className = 'option-btn flex-col items-start text-left';
      btn.onclick = () => this.submitAnswer(q.questionId, opt.id, btn);

      const optImgHtml = opt.image_url
        ? `<img src="${opt.image_url}" alt="Option Image" class="max-h-24 max-w-full rounded border mt-2 object-contain">`
        : '';

      btn.innerHTML = `
        <div class="flex items-center space-x-2">
          <span class="option-shape ${shapeInfo.class}"><span>${shapeInfo.symbol}</span></span>
          <span class="font-medium text-slate-900">${opt.text}</span>
        </div>
        ${optImgHtml}
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
