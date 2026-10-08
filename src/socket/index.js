import { Server } from 'socket.io';
import { roomManager } from './roomEngine.js';
import { AppError, formatErrorForUser, logger } from '../utils/errorModule.js';
import {
  joinRoomPayloadSchema,
  submitAnswerPayloadSchema,
  warnPlayerPayloadSchema,
  proctorAuthPayloadSchema,
} from '../utils/validators.js';
import { shuffleOptionsForPlayer } from '../utils/scoring.js';

export function setupSocketIO(server) {
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // Socket Authentication Middleware
  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      let user = null;

      if (cookieHeader) {
        const match = cookieHeader.match(/apti_session=([^;]+)/);
        if (match) {
          try {
            user = JSON.parse(decodeURIComponent(match[1]));
          } catch (e) {}
        }
      }

      // Handshake auth fallback for simulation bots / testing
      if (!user && socket.handshake.auth && socket.handshake.auth.user) {
        user = socket.handshake.auth.user;
      }

      if (!user) {
        user = {
          id: Math.floor(Math.random() * 900000) + 100000,
          displayName: `Guest_${Math.floor(Math.random() * 1000)}`,
          role: 'player',
        };
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new AppError('SESSION_EXPIRED'));
    }
  });

  io.on('connection', (socket) => {
    let currentRoom = null;
    let isProctor = false;

    // RTT Measurement Ping/Pong
    socket.on('ping', (clientTime, callback) => {
      if (typeof callback === 'function') {
        callback(clientTime);
      } else {
        socket.emit('pong', clientTime);
      }
      if (currentRoom && socket.user) {
        const player = currentRoom.players.get(socket.user.id);
        if (player && typeof clientTime === 'number') {
          player.rttMs = Math.max(0, Date.now() - clientTime);
        }
      }
    });

    // Helper to safely wrap handler execution
    const safeHandle = (handlerName, fn) => {
      return async (...args) => {
        try {
          await fn(...args);
        } catch (err) {
          logger.error({ handlerName, err }, 'Socket handler error');
          const userErr = formatErrorForUser(err);
          socket.emit('error:notice', userErr);
          const lastArg = args[args.length - 1];
          if (typeof lastArg === 'function') {
            lastArg({ success: false, error: userErr });
          }
        }
      };
    };

    // --- ROOM JOIN ---
    socket.on('room:join', safeHandle('room:join', async (payload, callback) => {
      const parsed = joinRoomPayloadSchema.parse(payload || {});
      let room = null;

      if (parsed.pin) {
        room = roomManager.findRoomByPin(parsed.pin);
      } else if (parsed.inviteToken) {
        room = roomManager.findRoomByToken(parsed.inviteToken);
      }

      if (!room) {
        throw new AppError('ROOM_NOT_FOUND');
      }

      room.checkCanJoin(socket.user, !!parsed.inviteToken);

      const { player, isHost, takeover } = room.addPlayer(
        socket.user,
        socket.id,
        !socket.user.email
      );

      currentRoom = room;
      socket.join(`room_${room.id}`);

      const snapshot = room.getSnapshotForPlayer(socket.user.id);

      if (typeof callback === 'function') {
        callback({ success: true, snapshot });
      } else {
        socket.emit('room:state', snapshot);
      }

      // Broadcast join/rejoin to room for student players
      if (!isHost && player) {
        io.to(`room_${room.id}`).emit('room:player_joined', {
          userId: player.userId,
          displayName: player.displayName,
          totalPlayers: room.players.size,
          takeover,
        });
      }
    }));

    // --- ROOM REJOIN ---
    socket.on('room:rejoin', safeHandle('room:rejoin', async (payload, callback) => {
      const roomId = payload?.roomId;
      const room = roomManager.findRoomById(roomId);
      if (!room) throw new AppError('ROOM_NOT_FOUND');

      const existingPlayer = room.players.get(socket.user.id);
      if (!existingPlayer) throw new AppError('ROOM_NOT_FOUND');
      if (existingPlayer.status === 'disqualified') throw new AppError('DISQUALIFIED');

      existingPlayer.socketId = socket.id;
      existingPlayer.status = 'active';

      currentRoom = room;
      socket.join(`room_${room.id}`);

      const snapshot = room.getSnapshotForPlayer(socket.user.id);
      if (typeof callback === 'function') callback({ success: true, snapshot });
      else socket.emit('room:state', snapshot);
    }));

    // --- SUBMIT ANSWER ---
    socket.on('player:submit_answer', safeHandle('player:submit_answer', async (payload, callback) => {
      if (!currentRoom) throw new AppError('ROOM_NOT_FOUND');

      const parsed = submitAnswerPayloadSchema.parse(payload);
      
      let res;
      await currentRoom.queue.enqueue(async () => {
        res = currentRoom.submitAnswer(
          socket.user.id,
          parsed.questionId,
          parsed.selectedOption,
          parsed.clientSendTime
        );
      });

      if (!res.accepted) {
        socket.emit('error:notice', { code: 'TIME_EXPIRED', message: res.reason });
        if (typeof callback === 'function') callback({ success: false, reason: res.reason });
        return;
      }

      // Send locked acknowledgement
      socket.emit('game:answer_acknowledged', {
        questionId: parsed.questionId,
        selectedOption: parsed.selectedOption,
        status: 'locked',
      });

      if (typeof callback === 'function') {
        callback({ success: true, duplicate: res.duplicate });
      }

      // If all active connected players answered, close round early!
      if (res.allAnswered && currentRoom.status === 'QUESTION') {
        clearTimeout(currentRoom.timer);
        await triggerRoundEnd(currentRoom, io);
      }
    }));

    // --- HOST ACTIONS ---
    const checkHost = () => {
      if (!currentRoom) throw new AppError('ROOM_NOT_FOUND');
      const isHost = Number(currentRoom.hostId) === Number(socket.user.id) || socket.user.role === 'host';
      if (!isHost) throw new AppError('NOT_ALLOWED');
    };

    socket.on('host:start_game', safeHandle('host:start_game', async (payload) => {
      checkHost();
      await triggerNextQuestion(currentRoom, io);
    }));

    socket.on('host:next_question', safeHandle('host:next_question', async () => {
      checkHost();
      await triggerNextQuestion(currentRoom, io);
    }));

    socket.on('host:kick_player', safeHandle('host:kick_player', async (payload) => {
      checkHost();
      const targetUserId = payload?.targetUserId;

      const target = currentRoom.players.get(targetUserId);
      if (target) {
        currentRoom.players.delete(targetUserId);
        io.to(`room_${currentRoom.id}`).emit('room:player_kicked', { targetUserId });
      }
    }));

    socket.on('host:update_settings', safeHandle('host:update_settings', async (payload) => {
      checkHost();
      if (payload?.questionDurationMs) {
        currentRoom.questionDurationMs = Number(payload.questionDurationMs);
      }
      Object.assign(currentRoom.settings, payload || {});
      io.to(`room_${currentRoom.id}`).emit('room:settings_updated', {
        ...currentRoom.settings,
        questionDurationMs: currentRoom.questionDurationMs,
      });
    }));

    socket.on('host:regenerate_link', safeHandle('host:regenerate_link', async (payload, callback) => {
      checkHost();
      const newToken = roomManager.regenerateLink(currentRoom);
      if (typeof callback === 'function') callback({ success: true, inviteToken: newToken });
    }));

    // --- PROCTOR ACTIONS ---
    socket.on('proctor:auth', safeHandle('proctor:auth', async (payload, callback) => {
      const parsed = proctorAuthPayloadSchema.parse(payload);
      if (!currentRoom && parsed.pin) {
        currentRoom = roomManager.findRoomByPin(parsed.pin);
        if (currentRoom) {
          socket.join(`room_${currentRoom.id}`);
        }
      }
      if (!currentRoom) throw new AppError('ROOM_NOT_FOUND');

      if (currentRoom.proctorCode.toUpperCase() === parsed.proctorCode.toUpperCase()) {
        isProctor = true;
        socket.isProctor = true;
        if (typeof callback === 'function') callback({ success: true });
      } else {
        throw new AppError('NOT_ALLOWED', 'Invalid Proctor Code');
      }
    }));

    socket.on('proctor:warn_player', safeHandle('proctor:warn_player', async (payload, callback) => {
      if (!currentRoom) throw new AppError('ROOM_NOT_FOUND');
      const isHost = Number(currentRoom.hostId) === Number(socket.user.id) || socket.user.role === 'host';
      if (!isHost && !isProctor) throw new AppError('NOT_ALLOWED');

      const parsed = warnPlayerPayloadSchema.parse(payload);
      const role = isHost ? 'host' : 'proctor';

      let result;
      await currentRoom.queue.enqueue(async () => {
        result = currentRoom.warnPlayer(parsed.targetUserId, role, parsed.reason);
      });

      const targetPlayer = currentRoom.players.get(parsed.targetUserId);
      if (targetPlayer && targetPlayer.socketId) {
        if (result.disqualified) {
          io.to(targetPlayer.socketId).emit('player:disqualified', {
            reason: `Disqualified after 3 warnings. Last reason: ${parsed.reason}`,
          });
        } else {
          io.to(targetPlayer.socketId).emit('player:warning', {
            warningCount: result.warningCount,
            maxWarnings: 3,
            reason: parsed.reason,
          });
        }
      }

      io.to(`room_${currentRoom.id}`).emit('room:warning_issued', {
        targetUserId: parsed.targetUserId,
        warningCount: result.warningCount,
        disqualified: result.disqualified,
        reason: parsed.reason,
        status: targetPlayer ? targetPlayer.status : (result.disqualified ? 'disqualified' : 'active'),
      });

      if (typeof callback === 'function') callback({ success: true, result });
    }));

    socket.on('proctor:revoke_warning', safeHandle('proctor:revoke_warning', async (payload, callback) => {
      if (!currentRoom) throw new AppError('ROOM_NOT_FOUND');
      const isHost = Number(currentRoom.hostId) === Number(socket.user.id) || socket.user.role === 'host';
      if (!isHost && !isProctor) throw new AppError('NOT_ALLOWED');

      const warningId = Number(payload?.warningId);
      let result;
      await currentRoom.queue.enqueue(async () => {
        result = currentRoom.revokeWarning(warningId);
      });

      io.to(`room_${currentRoom.id}`).emit('room:warning_revoked', result);
      if (typeof callback === 'function') callback({ success: true, result });
    }));

    socket.on('proctor:reinstate_player', safeHandle('proctor:reinstate_player', async (payload, callback) => {
      if (!currentRoom) throw new AppError('ROOM_NOT_FOUND');
      const isHost = Number(currentRoom.hostId) === Number(socket.user.id) || socket.user.role === 'host';
      if (!isHost && !isProctor) throw new AppError('NOT_ALLOWED');

      const targetUserId = Number(payload?.targetUserId);
      let result;
      await currentRoom.queue.enqueue(async () => {
        result = currentRoom.reinstatePlayer(targetUserId);
      });

      const targetPlayer = currentRoom.players.get(targetUserId);
      io.to(`room_${currentRoom.id}`).emit('room:player_reinstated', {
        targetUserId,
        warningCount: result.warningCount,
        status: targetPlayer ? targetPlayer.status : 'active',
      });
      if (typeof callback === 'function') callback({ success: true, result });
    }));

    socket.on('disconnect', () => {
      if (currentRoom) {
        currentRoom.disconnectPlayer(socket.id);
        io.to(`room_${currentRoom.id}`).emit('room:player_left', {
          userId: socket.user.id,
        });
      }
    });
  });

  return io;
}

// Helper to trigger next question with timer
async function triggerNextQuestion(room, io) {
  let result;
  await room.queue.enqueue(async () => {
    result = room.startNextQuestion();
  });

  if (result.finished) {
    const summary = room.calculateLeaderboard();
    io.to(`room_${room.id}`).emit('game:finished', { summary });
    return;
  }

  const { question, durationMs } = result;

  // Broadcast per-player custom payload with shuffled options
  for (const player of room.players.values()) {
    if (player.socketId && player.status !== 'disqualified') {
      const shuffledOptions = shuffleOptionsForPlayer(question.options, player.userId, question.id);
      const targetSocket = io.sockets.sockets.get(player.socketId);
      if (targetSocket) {
        targetSocket.emit('game:question_start', {
          questionId: question.id,
          text: question.text,
          options: shuffledOptions,
          durationMs,
          topic: question.topic,
          difficulty: question.difficulty,
          image_url: question.image_url,
          table_data: question.table_data,
          currentQuestionIndex: room.currentQuestionIndex + 1,
          totalQuestions: room.questionSet.length,
        });
      }
    }
  }

  // Set Question Timer
  room.timer = setTimeout(async () => {
    if (room.status === 'QUESTION') {
      await triggerRoundEnd(room, io);
    }
  }, durationMs + 300); // 15s + 300ms grace window
}

// Helper to trigger round reveal and leaderboard
async function triggerRoundEnd(room, io) {
  let revealData;
  await room.queue.enqueue(async () => {
    revealData = room.endRound();
  });

  if (room.timer) clearTimeout(room.timer);

  // 1. Calculate live leaderboard & standings with rank movement
  let leaderboard;
  await room.queue.enqueue(async () => {
    leaderboard = room.calculateLeaderboard();
  });

  const currentQ = room.questionSet[room.currentQuestionIndex];

  // Broadcast general leaderboard event to room (spectators & host)
  io.to(`room_${room.id}`).emit('game:leaderboard', {
    top10: leaderboard.top10,
    currentQuestionIndex: room.currentQuestionIndex + 1,
    totalQuestions: room.questionSet.length,
  });

  // Emit per-player reveal and rank update
  for (const player of room.players.values()) {
    if (player.socketId) {
      const myAnswer = room.currentAnswers.get(player.userId);
      const isCorrect = myAnswer ? myAnswer.isCorrect : false;
      const pointsEarned = myAnswer ? myAnswer.points : 0;
      const adjustedTimeMs = myAnswer ? myAnswer.adjustedTimeMs : room.questionDurationMs;

      const myRankObj = leaderboard.fullRankings.find((r) => r.userId === player.userId) || {
        score: player.score,
        rank: -1,
        delta: 'unchanged',
      };

      const targetSocket = io.sockets.sockets.get(player.socketId);
      if (targetSocket) {
        targetSocket.emit('game:reveal', {
          questionId: currentQ ? currentQ.id : null,
          correctOptionId: revealData.correctOptionId,
          explanation: revealData.explanation,
          isCorrect,
          pointsEarned,
          adjustedTimeMs,
          newTotalScore: player.score,
        });

        targetSocket.emit('game:leaderboard', {
          top10: leaderboard.top10,
          myRank: myRankObj,
          currentQuestionIndex: room.currentQuestionIndex + 1,
          totalQuestions: room.questionSet.length,
        });
      }
    }
  }

  const isLastQuestion = room.currentQuestionIndex >= room.questionSet.length - 1;

  // After 2 seconds of showing live leaderboard:
  room.timer = setTimeout(async () => {
    if (!isLastQuestion) {
      // Auto advance to next question
      await triggerNextQuestion(room, io);
    } else {
      // All questions finished: Send detailed results (accuracy, speed, topic strengths)
      let summary;
      await room.queue.enqueue(async () => {
        summary = room.calculateFinalSummary();
      });

      for (const player of room.players.values()) {
        if (player.socketId) {
          const myStats = summary.playerStats[player.userId] || null;
          const targetSocket = io.sockets.sockets.get(player.socketId);
          if (targetSocket) {
            targetSocket.emit('game:finished', {
              summary: {
                top10: summary.top10,
                fullRankings: summary.fullRankings,
                myStats,
              },
            });
          }
        }
      }
    }
  }, 2000);
}
