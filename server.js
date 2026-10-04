const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const gameEngine = require('./src/gameEngine');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/:code', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (rooms.has(code));
  return code;
}

function publicRoomState(room) {
  const state = { ...room };
  delete state.deck;
  delete state.turnTimer;
  state.players = state.players.map(p => {
    const pCopy = { ...p };
    if (pCopy.hand) {
      pCopy.handSize = pCopy.hand.length;
      delete pCopy.hand;
    }
    return pCopy;
  });
  return state;
}

function clearTurnTimer(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
}

function clearSideshowTimer(room) {
  if (room.sideshowTimer) { clearTimeout(room.sideshowTimer); room.sideshowTimer = null; }
}

function startTurnTimer(room, io) {
  clearTurnTimer(room);
  room.turnTimer = setTimeout(() => {
    const p = room.players[room.currentPlayerIndex];
    if (p && p.state !== 'folded') {
      p.state = 'folded';
      if (gameEngine.countActivePlayers(room.players) <= 1) {
        endRound(room, io);
      } else {
        advanceTurn(room, io);
      }
    }
  }, 35000);
}

function advanceTurn(room, io) {
  const nextIdx = gameEngine.getNextActivePlayerIndex(room.players, room.currentPlayerIndex);
  if (nextIdx === -1) {
    endRound(room, io);
    return;
  }
  room.currentPlayerIndex = nextIdx;
  const p = room.players[nextIdx];
  const activeCount = gameEngine.countActivePlayers(room.players);
  
  const options = {
    canCall: true, canRaise: true, canFold: true,
    canShow: activeCount === 2 && p.state === 'seen',
    canSideshow: gameEngine.canSideshow(room, p.id),
    isBlind: p.state === 'blind',
    currentBet: room.currentBet,
    callAmount: gameEngine.getMinBet(p.state === 'blind', room.currentBet),
    minRaise: room.currentBet * 2,
    myChips: p.chips,
  };
  
  io.to(p.id).emit('game:yourTurn', { options, timeLimit: 35 });
  io.to(room.code).emit('room:updated', publicRoomState(room));
  startTurnTimer(room, io);
}

function endRound(room, io, winnerId) {
  clearTurnTimer(room);
  let winner = winnerId ? room.players.find(p => p.id === winnerId) : gameEngine.getWinner(room.players);
  if (winner) winner.chips += room.pot;

  const allHands = room.players.filter(p => p.state !== 'folded').map(p => ({
    playerId: p.id, name: p.name, hand: p.hand, state: p.state
  }));
  
  io.to(room.code).emit('game:over', {
    winnerId: winner ? winner.id : null,
    winnerName: winner ? winner.name : null,
    winnerHand: winner ? winner.hand : null,
    allHands, pot: room.pot, publicState: publicRoomState(room)
  });
  
  room.phase = 'waiting';
  room.roundNumber++;
  
  for (let i = room.players.length - 1; i >= 0; i--) {
    const p = room.players[i];
    if (p.chips <= 0) {
      room.players.splice(i, 1);
      io.to(p.id).emit('room:error', { message: 'You are out of chips!' });
    } else {
      p.state = 'blind'; p.currentRoundBet = 0; p.hand = []; p.ready = false;
    }
  }
  
  if (room.players.length === 0) rooms.delete(room.code);
  else io.to(room.code).emit('room:updated', publicRoomState(room));
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name }) => {
    if (!name || name.length > 20) return socket.emit('room:error', { message: 'Invalid name' });
    const code = generateRoomCode();
    const room = {
      code, host: socket.id, phase: 'waiting', settings: { startingChips: 1000, boot: 50 },
      players: [{ id: socket.id, name, chips: 1000, hand: [], state: 'blind', currentRoundBet: 0, ready: false, seatIndex: 0, connected: true }],
      deck: [], pot: 0, currentBet: 50, currentPlayerIndex: 0, turnTimer: null, roundNumber: 0, sideshowPending: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room:joined', { room: publicRoomState(room), playerId: socket.id, isHost: true });
    io.to(code).emit('room:updated', publicRoomState(room));
  });

  socket.on('room:join', ({ code, name }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    if (room.players.length >= 6) return socket.emit('room:error', { message: 'Room full' });
    if (room.phase !== 'waiting') return socket.emit('room:error', { message: 'Game in progress' });
    if (room.players.find(p => p.name === name)) return socket.emit('room:error', { message: 'Name taken' });
    room.players.push({ id: socket.id, name, chips: room.settings.startingChips, hand: [], state: 'blind', currentRoundBet: 0, ready: false, seatIndex: room.players.length, connected: true });
    socket.join(code);
    socket.emit('room:joined', { room: publicRoomState(room), playerId: socket.id, isHost: false });
    io.to(code).emit('room:updated', publicRoomState(room));
  });

  socket.on('room:ready', () => {
    for (const room of rooms.values()) {
      const p = room.players.find(p => p.id === socket.id);
      if (p && room.phase === 'waiting') {
        p.ready = !p.ready;
        io.to(room.code).emit('room:updated', publicRoomState(room));
        break;
      }
    }
  });

  socket.on('room:settings', ({ startingChips, boot }) => {
    for (const room of rooms.values()) {
      if (room.host === socket.id && room.phase === 'waiting') {
        if (startingChips >= 100 && startingChips <= 100000 && boot >= 10 && boot <= 10000) {
          room.settings.startingChips = startingChips; room.settings.boot = boot;
          room.players.forEach(p => p.chips = startingChips);
          io.to(room.code).emit('room:updated', publicRoomState(room));
        }
        break;
      }
    }
  });

  socket.on('game:start', () => {
    for (const room of rooms.values()) {
      if (room.host === socket.id && room.phase === 'waiting') {
        if (room.players.length < 3) return socket.emit('room:error', { message: 'Need at least 3 players' });
        if (!room.players.filter(p => p.id !== room.host).every(p => p.ready)) return socket.emit('room:error', { message: 'Not all players ready' });
        
        room.phase = 'betting';
        const deal = gameEngine.dealHands(room.players.length);
        room.deck = deal.remaining; room.pot = 0;
        
        room.players.forEach((p, i) => {
          p.hand = deal.hands[i];
          const bootAmount = Math.min(room.settings.boot, p.chips);
          p.chips -= bootAmount; room.pot += bootAmount;
          p.state = p.chips === 0 ? 'all-in' : 'blind';
          p.currentRoundBet = 0;
        });
        
        room.currentBet = room.settings.boot; room.currentPlayerIndex = 0;
        room.players.forEach(p => io.to(p.id).emit('game:dealt', { hand: p.hand, publicState: publicRoomState(room) }));
        advanceTurn(room, io);
        break;
      }
    }
  });

  socket.on('game:peek', () => {
    for (const room of rooms.values()) {
      const p = room.players.find(p => p.id === socket.id);
      if (p && room.phase === 'betting' && p.state === 'blind') {
        p.state = 'seen';
        io.to(room.code).emit('room:updated', publicRoomState(room));
        break;
      }
    }
  });

  socket.on('game:action', ({ type, amount }) => {
    for (const room of rooms.values()) {
      const p = room.players[room.currentPlayerIndex];
      if (room.phase === 'betting' && p && p.id === socket.id) {
        clearTurnTimer(room);
        
        if (type === 'fold') {
          p.state = 'folded';
          io.to(room.code).emit('game:action', { playerId: p.id, name: p.name, action: 'fold', publicState: publicRoomState(room) });
          if (gameEngine.countActivePlayers(room.players) <= 1) endRound(room, io);
          else advanceTurn(room, io);
        } else if (type === 'call') {
          const cost = gameEngine.getMinBet(p.state === 'blind', room.currentBet);
          const actualCost = Math.min(cost, p.chips);
          p.chips -= actualCost; room.pot += actualCost; p.currentRoundBet += actualCost;
          if (p.chips === 0) p.state = 'all-in';
          io.to(room.code).emit('game:action', { playerId: p.id, name: p.name, action: 'call', amount: actualCost, publicState: publicRoomState(room) });
          advanceTurn(room, io);
        } else if (type === 'raise') {
          const minRaise = room.currentBet * 2;
          const cost = p.state === 'blind' ? amount : amount * 2;
          if (amount >= minRaise && cost <= p.chips) {
            room.currentBet = amount;
            const actualCost = Math.min(cost, p.chips);
            p.chips -= actualCost; room.pot += actualCost; p.currentRoundBet += actualCost;
            if (p.chips === 0) p.state = 'all-in';
            io.to(room.code).emit('game:action', { playerId: p.id, name: p.name, action: 'raise', amount, publicState: publicRoomState(room) });
            advanceTurn(room, io);
          } else advanceTurn(room, io);
        } else if (type === 'show') {
           if (gameEngine.countActivePlayers(room.players) === 2 && p.state === 'seen') {
             const cost = room.currentBet * 2;
             const actualCost = Math.min(cost, p.chips);
             p.chips -= actualCost; room.pot += actualCost;
             endRound(room, io);
           } else advanceTurn(room, io);
        } else if (type === 'sideshow_request') {
           if (gameEngine.canSideshow(room, p.id)) {
             let prevIdx = (room.currentPlayerIndex - 1 + room.players.length) % room.players.length;
             while(room.players[prevIdx].state === 'folded') prevIdx = (prevIdx - 1 + room.players.length) % room.players.length;
             const target = room.players[prevIdx];
             room.sideshowPending = { requesterId: p.id, targetId: target.id };
             io.to(room.code).emit('game:sideshow_request', { requesterName: p.name, targetName: target.name });
             io.to(target.id).emit('game:sideshow_respond', {});
             clearSideshowTimer(room);
             room.sideshowTimer = setTimeout(() => {
                io.to(room.code).emit('game:sideshow_declined');
                room.sideshowPending = null;
                advanceTurn(room, io);
             }, 15000);
           } else advanceTurn(room, io);
        }
        break;
      }
    }
  });

  socket.on('game:sideshow_respond', ({ accept }) => {
    for (const room of rooms.values()) {
      if (room.sideshowPending && room.sideshowPending.targetId === socket.id) {
        clearSideshowTimer(room);
        const reqP = room.players.find(p => p.id === room.sideshowPending.requesterId);
        const tarP = room.players.find(p => p.id === room.sideshowPending.targetId);
        if (accept) {
          const comp = gameEngine.compareHands(reqP.hand, tarP.hand);
          let loser = comp > 0 ? tarP : reqP;
          loser.state = 'folded';
          io.to(room.code).emit('game:sideshow_result', { requesterName: reqP.name, targetName: tarP.name, loserName: loser.name, publicState: publicRoomState(room) });
          room.sideshowPending = null;
          if (gameEngine.countActivePlayers(room.players) <= 1) endRound(room, io);
          else advanceTurn(room, io);
        } else {
          io.to(room.code).emit('game:sideshow_declined');
          room.sideshowPending = null;
          advanceTurn(room, io);
        }
        break;
      }
    }
  });

  socket.on('chat:send', ({ text }) => {
    if (text && text.length <= 200) {
      for (const room of rooms.values()) {
        const p = room.players.find(p => p.id === socket.id);
        if (p) { io.to(room.code).emit('chat:message', { name: p.name, text, time: Date.now() }); break; }
      }
    }
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const pIdx = room.players.findIndex(p => p.id === socket.id);
      if (pIdx !== -1) {
        if (room.phase === 'waiting') {
          room.players.splice(pIdx, 1);
          if (room.players.length === 0) rooms.delete(room.code);
          else io.to(room.code).emit('room:updated', publicRoomState(room));
        } else if (room.phase === 'betting') {
          const p = room.players[pIdx];
          p.connected = false; p.state = 'folded';
          io.to(room.code).emit('player:disconnected', { name: p.name });
          if (gameEngine.countActivePlayers(room.players) <= 1) endRound(room, io);
          else if (room.currentPlayerIndex === pIdx) { clearTurnTimer(room); advanceTurn(room, io); }
          else io.to(room.code).emit('room:updated', publicRoomState(room));
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });
