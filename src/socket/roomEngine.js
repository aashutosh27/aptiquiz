import { AppError } from '../utils/errorModule.js';
import { generatePin, generateInviteToken, generateProctorCode, hashToken } from '../utils/pinGenerator.js';
import { calculateAdjustedTime, calculateScore, isWithinGracePeriod, shuffleOptionsForPlayer, comparePlayerRanks } from '../utils/scoring.js';
import { logger } from '../utils/errorModule.js';
import { query } from '../../db/index.js';

class RoomQueue {
  constructor() {
    this.queue = Promise.resolve();
  }

  enqueue(action) {
    this.queue = this.queue.then(action).catch((err) => {
      logger.error({ err }, 'Error in room sequential queue execution');
    });
    return this.queue;
  }
}

export class Room {
  constructor(id, pin, inviteToken, hostId, questionSet, settings = {}) {
    this.id = id;
    this.pin = pin;
    this.inviteToken = inviteToken;
    this.inviteTokenHash = hashToken(inviteToken);
    this.hostId = Number(hostId);
    this.questionSet = (questionSet || []).map((q, idx) => ({
      ...q,
      id: q.id !== undefined && q.id !== null ? Number(q.id) : idx + 1,
    }));
    this.status = 'LOBBY';
    this.currentQuestionIndex = -1;
    this.questionStartTime = 0; // performance.now() timestamp
    this.timer = null;
    this.questionDurationMs = 15000;

    this.settings = {
      link_enabled: settings.link_enabled ?? true,
      locked: settings.locked ?? false,
      allow_late_join: settings.allow_late_join ?? false,
      require_google: settings.require_google ?? true,
    };

    const customCode = settings.proctorCode ? String(settings.proctorCode).trim().toUpperCase() : '';
    this.proctorCode = customCode && customCode.length >= 3 ? customCode : generateProctorCode();
    this.proctorCodeHash = hashToken(this.proctorCode);

    // Keyed by userId (number or string for guest)
    this.players = new Map();
    // Round answers for current question: userId -> { selectedOption, isCorrect, points, adjustedTime, serverReceivedAt }
    this.currentAnswers = new Map();
    // Historical answers across game: questionId -> Map(userId -> answerObj)
    this.answerHistory = new Map();
    // Audit logs for warnings: array of { warningId, userId, issuerRole, reason, questionNumber, revoked, createdAt }
    this.warningsLog = [];
    this.warningCounter = 0;

    this.queue = new RoomQueue();
    this.previousRanks = new Map(); // userId -> lastRank
  }

  getPlayer(userId) {
    if (userId === undefined || userId === null) return null;
    const numId = Number(userId);
    const strId = String(userId);
    return (
      this.players.get(userId) ||
      this.players.get(numId) ||
      this.players.get(strId) ||
      Array.from(this.players.values()).find((p) => Number(p.userId) === numId)
    );
  }

  // --- JOIN & REJOIN CHECKS ---
  checkCanJoin(user, isInviteLink = false) {
    // 1. PIN or Link valid (handled by room lookup)
    if (isInviteLink && !this.settings.link_enabled) {
      throw new AppError('ROOM_NOT_FOUND');
    }

    // 2. Room not locked
    if (this.settings.locked) {
      throw new AppError('ROOM_LOCKED');
    }

    // Check if user is disqualified in this room
    const existingPlayer = this.getPlayer(user.id);
    if (existingPlayer && (existingPlayer.status === 'disqualified' || existingPlayer.warningCount >= 3)) {
      throw new AppError('DISQUALIFIED');
    }

    // 3. Game not started unless late joining is on
    if (this.status !== 'LOBBY' && !this.settings.allow_late_join) {
      throw new AppError('GAME_ALREADY_STARTED');
    }

    // 4. Room not full at 50
    const regularPlayers = Array.from(this.players.values()).filter(p => Number(p.userId) !== Number(this.hostId));
    if (regularPlayers.length >= 50) {
      if (!existingPlayer) {
        throw new AppError('ROOM_FULL');
      }
    }

    return true;
  }

  addPlayer(user, socketId, isGuest = false) {
    // Exclude Host from student players contestant map
    if (user && (Number(user.id) === Number(this.hostId) || user.role === 'host')) {
      this.hostSocketId = socketId;
      return { player: null, isHost: true, takeover: false };
    }

    const existing = this.getPlayer(user.id);

    if (existing) {
      if (existing.status === 'disqualified' || existing.warningCount >= 3) {
        existing.status = 'disqualified';
        throw new AppError('DISQUALIFIED');
      }
      // Connection takeover
      existing.socketId = socketId;
      existing.status = 'active';
      existing.lastSeenAt = Date.now();
      return { player: existing, isHost: false, takeover: true };
    }

    const player = {
      userId: user.id,
      displayName: user.displayName || user.display_name || 'Player',
      email: user.email,
      isGuest,
      socketId,
      status: 'active',
      score: 0,
      warningCount: 0,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      rttMs: 0,
      lastAdjustedTime: Infinity,
    };

    this.players.set(user.id, player);
    return { player, isHost: false, takeover: false };
  }

  disconnectPlayer(socketId) {
    for (const [userId, p] of this.players.entries()) {
      if (p.socketId === socketId) {
        if (p.status !== 'disqualified') {
          p.status = 'disconnected';
        }
        p.lastSeenAt = Date.now();
        break;
      }
    }
  }

  getSnapshotForPlayer(userId) {
    const player = this.players.get(userId);
    const currentQ = this.currentQuestionIndex >= 0 ? this.questionSet[this.currentQuestionIndex] : null;

    let remainingTimeMs = 0;
    if (this.status === 'QUESTION' && this.questionStartTime) {
      const elapsed = performance.now() - this.questionStartTime;
      remainingTimeMs = Math.max(0, Math.round(this.questionDurationMs - elapsed));
    }

    const existingAnswer = currentQ ? this.currentAnswers.get(userId) : null;

    return {
      roomId: this.id,
      pin: this.pin,
      status: this.status,
      currentQuestionIndex: this.currentQuestionIndex,
      totalQuestions: this.questionSet.length,
      settings: this.settings,
      player: player
        ? {
            userId: player.userId,
            displayName: player.displayName,
            score: player.score,
            warningCount: player.warningCount,
            status: player.status,
          }
        : null,
      currentQuestion:
        this.status === 'QUESTION' && currentQ
          ? {
              id: currentQ.id,
              text: currentQ.text,
              options: shuffleOptionsForPlayer(currentQ.options, userId, currentQ.id),
              topic: currentQ.topic,
              difficulty: currentQ.difficulty,
              image_url: currentQ.image_url,
              table_data: currentQ.table_data,
              durationMs: this.questionDurationMs,
              remainingTimeMs,
              hasAnswered: !!existingAnswer,
              selectedOption: existingAnswer ? existingAnswer.selectedOption : null,
            }
          : null,
      players: Array.from(this.players.values()).map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        score: p.score,
        status: p.status,
      })),
    };
  }

  // --- GAME FLOW & QUESTION TIMING ---
  startNextQuestion() {
    this.currentQuestionIndex++;
    if (this.currentQuestionIndex >= this.questionSet.length) {
      this.status = 'FINISHED';
      return { finished: true };
    }

    this.status = 'QUESTION';
    this.currentAnswers.clear();
    this.questionStartTime = performance.now();

    const currentQ = this.questionSet[this.currentQuestionIndex];

    return {
      finished: false,
      question: currentQ,
      durationMs: this.questionDurationMs,
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.questionSet.length,
    };
  }

  submitAnswer(userId, questionId, selectedOption, clientSendTime) {
    const currentQ = this.questionSet[this.currentQuestionIndex];
    if (!currentQ || currentQ.id !== questionId || this.status !== 'QUESTION') {
      return { accepted: false, reason: 'No active question matching ID' };
    }

    const player = this.players.get(userId);
    if (!player || player.status === 'disqualified') {
      return { accepted: false, reason: 'Player not eligible' };
    }

    // Idempotency: Accept only first answer
    if (this.currentAnswers.has(userId)) {
      const prev = this.currentAnswers.get(userId);
      return { accepted: true, duplicate: true, answer: prev };
    }

    const now = performance.now();
    if (!isWithinGracePeriod(now, this.questionStartTime, this.questionDurationMs)) {
      return { accepted: false, reason: 'Time was up before your answer arrived.' };
    }

    const isCorrect = currentQ.correct_option_id === selectedOption;
    const adjustedTimeMs = calculateAdjustedTime(now, this.questionStartTime, player.rttMs || 0, this.questionDurationMs);
    const points = calculateScore(isCorrect, adjustedTimeMs, this.questionDurationMs);

    player.score += points;
    player.lastAdjustedTime = adjustedTimeMs;

    const answerRecord = {
      userId,
      questionId,
      selectedOption,
      isCorrect,
      points,
      adjustedTimeMs,
      serverReceivedAt: new Date(),
    };

    this.currentAnswers.set(userId, answerRecord);

    // Check if all connected, non-disqualified players have answered
    const activeConnectedCount = Array.from(this.players.values()).filter(
      (p) => p.status === 'active'
    ).length;

    const allAnswered = this.currentAnswers.size >= activeConnectedCount && activeConnectedCount > 0;

    return {
      accepted: true,
      duplicate: false,
      answer: answerRecord,
      allAnswered,
    };
  }

  // --- REVEAL & LEADERBOARD MATH ---
  endRound() {
    this.status = 'REVEAL';

    // Store history
    const currentQ = this.questionSet[this.currentQuestionIndex];
    if (currentQ) {
      this.answerHistory.set(currentQ.id, new Map(this.currentAnswers));
    }

    const correctOptionId = currentQ ? currentQ.correct_option_id : null;
    const explanation = currentQ ? currentQ.explanation : null;

    return {
      correctOptionId,
      explanation,
    };
  }

  calculateLeaderboard() {
    this.status = 'LEADERBOARD';

    // Filter out disqualified players
    const activePlayers = Array.from(this.players.values()).filter(
      (p) => p.status !== 'disqualified'
    );

    // Sort by score desc, then by lastAdjustedTime asc, then by userId
    activePlayers.sort(comparePlayerRanks);

    const fullRankings = activePlayers.map((p, index) => {
      const rank = index + 1;
      const prevRank = this.previousRanks.get(p.userId);
      let delta = 'unchanged';
      if (prevRank !== undefined) {
        if (rank < prevRank) delta = 'climbed';
        else if (rank > prevRank) delta = 'dropped';
      }
      this.previousRanks.set(p.userId, rank);

      return {
        userId: p.userId,
        displayName: p.displayName,
        score: p.score,
        rank,
        delta,
      };
    });

    const top10 = fullRankings.slice(0, 10);

    return {
      top10,
      fullRankings,
    };
  }

  calculateFinalSummary() {
    const leaderboard = this.calculateLeaderboard();
    const totalQuestions = this.questionSet.length;
    const playerStatsMap = new Map();

    for (const player of this.players.values()) {
      if (player.status === 'disqualified') continue;

      let correctCount = 0;
      let totalTimeMs = 0;
      let answeredCount = 0;
      const topicStats = {};

      for (const q of this.questionSet) {
        const topicKey = (q.topic || 'quantitative').toLowerCase();
        if (!topicStats[topicKey]) {
          topicStats[topicKey] = { total: 0, correct: 0 };
        }
        topicStats[topicKey].total += 1;

        const roundAnswers = this.answerHistory.get(q.id);
        if (roundAnswers && roundAnswers.has(player.userId)) {
          const ans = roundAnswers.get(player.userId);
          answeredCount += 1;
          totalTimeMs += ans.adjustedTimeMs || 0;
          if (ans.isCorrect) {
            correctCount += 1;
            topicStats[topicKey].correct += 1;
          }
        }
      }

      const accuracyPct = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
      const avgSpeedSec = answeredCount > 0 ? (totalTimeMs / answeredCount / 1000).toFixed(1) : '0.0';

      const topicStrengths = {};
      for (const [t, s] of Object.entries(topicStats)) {
        topicStrengths[t] = {
          total: s.total,
          correct: s.correct,
          pct: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
        };
      }

      playerStatsMap.set(player.userId, {
        userId: player.userId,
        displayName: player.displayName,
        score: player.score,
        accuracyPct,
        correctCount,
        totalQuestions,
        avgSpeedSec,
        topicStrengths,
      });
    }

    return {
      top10: leaderboard.top10,
      fullRankings: leaderboard.fullRankings,
      playerStats: Object.fromEntries(playerStatsMap),
    };
  }

  // --- WARNING & DISQUALIFICATION ENGINE ---
  warnPlayer(targetUserId, issuerRole, reason, questionNumber = 0) {
    const player = this.getPlayer(targetUserId);
    if (!player) {
      throw new AppError('VALIDATION_ERROR', 'Player not found in room');
    }

    if (player.status === 'disqualified') {
      return { alreadyDisqualified: true, warningCount: 3, disqualified: true };
    }

    this.warningCounter++;
    const warningId = this.warningCounter;
    player.warningCount += 1;

    const record = {
      warningId,
      userId: player.userId,
      issuerRole,
      reason,
      questionNumber: questionNumber || this.currentQuestionIndex + 1,
      revoked: false,
      createdAt: new Date(),
    };

    this.warningsLog.push(record);

    let disqualified = false;
    if (player.warningCount >= 3) {
      player.status = 'disqualified';
      disqualified = true;
    }

    return {
      warningId,
      warningCount: player.warningCount,
      disqualified,
      reason,
    };
  }

  revokeWarning(warningId) {
    const record = this.warningsLog.find((w) => w.warningId === warningId && !w.revoked);
    if (!record) {
      throw new AppError('VALIDATION_ERROR', 'Active warning record not found');
    }

    record.revoked = true;
    const player = this.getPlayer(record.userId);
    if (player) {
      player.warningCount = Math.max(0, player.warningCount - 1);
      if (player.status === 'disqualified' && player.warningCount < 3) {
        player.status = 'active';
      }
    }

    return { userId: record.userId, warningCount: player ? player.warningCount : 0 };
  }

  reinstatePlayer(targetUserId) {
    const player = this.getPlayer(targetUserId);
    if (!player) {
      throw new AppError('VALIDATION_ERROR', 'Player not found in room');
    }

    player.status = 'active';
    player.warningCount = 2; // Set back to 2 warnings
    return { userId: player.userId, warningCount: player.warningCount };
  }
}

// Global Room Store in memory (up to 80 concurrent rooms per process)
export class RoomManager {
  constructor() {
    this.roomsByPin = new Map(); // pin -> Room
    this.roomsByTokenHash = new Map(); // tokenHash -> Room
    this.roomsById = new Map(); // id -> Room
    this.nextRoomId = 1;
  }

  createRoom(hostId, questionSet, settings = {}) {
    if (this.roomsById.size >= 80) {
      throw new AppError('RATE_LIMITED', 'Server room capacity reached. Try again later.');
    }

    let pin = generatePin();
    let attempts = 0;
    while (this.roomsByPin.has(pin) && attempts < 100) {
      pin = generatePin();
      attempts++;
    }

    const inviteToken = generateInviteToken();
    const roomId = this.nextRoomId++;

    const room = new Room(roomId, pin, inviteToken, hostId, questionSet, settings);

    this.roomsByPin.set(pin, room);
    this.roomsByTokenHash.set(room.inviteTokenHash, room);
    this.roomsById.set(roomId, room);

    return room;
  }

  findRoomByPin(pin) {
    return this.roomsByPin.get(pin);
  }

  findRoomByToken(inviteToken) {
    const tokenHash = hashToken(inviteToken);
    return this.roomsByTokenHash.get(tokenHash);
  }

  findRoomById(id) {
    return this.roomsById.get(id);
  }

  regenerateLink(room) {
    this.roomsByTokenHash.delete(room.inviteTokenHash);
    room.inviteToken = generateInviteToken();
    room.inviteTokenHash = hashToken(room.inviteToken);
    this.roomsByTokenHash.set(room.inviteTokenHash, room);
    return room.inviteToken;
  }

  closeRoom(room) {
    this.roomsByPin.delete(room.pin);
    this.roomsByTokenHash.delete(room.inviteTokenHash);
    this.roomsById.delete(room.id);
  }
}

export const roomManager = new RoomManager();
