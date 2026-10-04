const http = require('http');
const { io } = require('socket.io-client');
const assert = require('assert');

let serverInstance = null;
let SERVER_URL = 'http://localhost:3000';
const clients = [];

function checkPortListening(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServerRunning() {
  const isRunning = await checkPortListening(3000);
  if (isRunning) {
    console.log('  📡 Found external server running on http://localhost:3000');
    SERVER_URL = 'http://localhost:3000';
    return;
  }

  // Self-bootstrap internal server on dynamic port
  const app = require('./server');
  const server = app.server;
  await new Promise((resolve) => {
    serverInstance = server.listen(0, () => {
      const port = server.address().port;
      SERVER_URL = `http://localhost:${port}`;
      console.log(`  🚀 Self-bootstrapped internal server listening on dynamic port ${port}`);
      resolve();
    });
  });
}

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      forceNew: true,
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
    });
    socket.once('connect', () => {
      clients.push(socket);
      resolve(socket);
    });
    socket.once('connect_error', (err) => reject(err));
  });
}

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, SERVER_URL);
    const req = http.get(u, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('HTTP request timed out'));
    });
  });
}

function httpOptions(urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, SERVER_URL);
    const req = http.request(u, { method: 'OPTIONS' }, (res) => {
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('OPTIONS request timed out'));
    });
    req.end();
  });
}

function cleanup() {
  for (const s of clients) {
    try {
      if (s && s.connected) s.disconnect();
    } catch (e) {}
  }
  if (serverInstance) {
    try {
      serverInstance.close();
    } catch (e) {}
  }
}

async function run() {
  console.log('🎮 Starting Self-Bootstrapping Multiplayer Simulation Test Suite...');
  await ensureServerRunning();

  // ==========================================
  // STAGE 1: HTTP /health and CORS Verification
  // ==========================================
  console.log('\n[Stage 1/8] Verifying HTTP /health & Express CORS headers...');
  const healthRes = await httpGet('/health');
  assert.strictEqual(healthRes.status, 200, 'GET /health must return status 200');
  assert.strictEqual(healthRes.data.status, 'ok', 'GET /health body status must be ok');
  assert.strictEqual(typeof healthRes.data.uptime, 'number', 'Uptime must be a number');
  assert.ok(healthRes.data.timestamp, 'Timestamp must be present');
  assert.strictEqual(healthRes.headers['access-control-allow-origin'], '*', 'CORS Allow-Origin header must be *');
  assert.ok((healthRes.headers['cache-control'] || '').includes('no-cache'), 'Cache-Control must contain no-cache');

  const optionsRes = await httpOptions('/health');
  assert.ok(optionsRes.status === 200 || optionsRes.status === 204, 'OPTIONS preflight must return 200 or 204');
  assert.strictEqual(optionsRes.headers['access-control-allow-origin'], '*', 'OPTIONS preflight must include CORS headers');
  console.log('  ✅ Stage 1 Passed: /health endpoint and CORS preflight verified');

  // ==========================================
  // STAGE 2: Client Connection & Room Creation
  // ==========================================
  console.log('\n[Stage 2/8] Connecting clients and creating room...');
  const p1 = await connectClient(SERVER_URL);
  const p2 = await connectClient(SERVER_URL);
  const p3 = await connectClient(SERVER_URL);
  console.log('  ✅ 3 Socket clients connected');

  let roomCode = '';
  await new Promise((resolve, reject) => {
    p1.once('room:joined', ({ room, isHost }) => {
      assert.strictEqual(isHost, true);
      assert.strictEqual(room.players.length, 1);
      assert.strictEqual(typeof room.code, 'string');
      assert.strictEqual(room.code.length, 4);
      roomCode = room.code;
      console.log(`  ✅ Player 1 created room: ${roomCode}`);
      resolve();
    });
    p1.once('room:error', (err) => reject(new Error(err.message)));
    p1.emit('room:create', { name: 'PlayerOne' });
  });

  // ==========================================
  // STAGE 3: Room Code Case-Insensitive Sanitization
  // ==========================================
  console.log('\n[Stage 3/8] Testing room code sanitization (lowercase & whitespace)...');
  // Player 2 joins with lowercase code
  await new Promise((resolve, reject) => {
    p2.once('room:joined', ({ room, isHost }) => {
      assert.strictEqual(isHost, false);
      assert.strictEqual(room.players.length, 2);
      console.log('  ✅ Player 2 joined using lowercase code');
      resolve();
    });
    p2.once('room:error', (err) => reject(new Error(err.message)));
    p2.emit('room:join', { code: roomCode.toLowerCase(), name: 'PlayerTwo' });
  });

  // Player 3 joins with untrimmed code
  await new Promise((resolve, reject) => {
    p3.once('room:joined', ({ room, isHost }) => {
      assert.strictEqual(isHost, false);
      assert.strictEqual(room.players.length, 3);
      console.log('  ✅ Player 3 joined using whitespace-padded code');
      resolve();
    });
    p3.once('room:error', (err) => reject(new Error(err.message)));
    p3.emit('room:join', { code: `  ${roomCode}  `, name: 'PlayerThree' });
  });

  // ==========================================
  // STAGE 4: Player Readiness & 3-Player Deal
  // ==========================================
  console.log('\n[Stage 4/8] Readying players and starting 3-player match...');
  p2.emit('room:ready');
  p3.emit('room:ready');
  await new Promise((r) => setTimeout(r, 150));

  const dealPromise = Promise.all([
    new Promise((res) => p1.once('game:dealt', (d) => res(d))),
    new Promise((res) => p2.once('game:dealt', (d) => res(d))),
    new Promise((res) => p3.once('game:dealt', (d) => res(d))),
  ]);

  const p2TurnPromise = new Promise((res) => p2.once('game:yourTurn', (d) => res(d)));

  p1.emit('game:start');
  const [deal1, deal2, deal3] = await dealPromise;
  await p2TurnPromise;

  assert.strictEqual(deal1.hand.length, 3, 'P1 must receive 3 cards');
  assert.strictEqual(deal2.hand.length, 3, 'P2 must receive 3 cards');
  assert.strictEqual(deal3.hand.length, 3, 'P3 must receive 3 cards');
  console.log(`  ✅ Cards dealt: P1=[${deal1.hand.join(' ')}], P2=[${deal2.hand.join(' ')}], P3=[${deal3.hand.join(' ')}]`);
  console.log('  ✅ Turn given to Player 2 (left of dealer/host)');

  // ==========================================
  // STAGE 5: Live Chat Broadcast
  // ==========================================
  console.log('\n[Stage 5/8] Verifying live chat broadcast...');
  await new Promise((resolve) => {
    p2.once('chat:message', ({ name, text }) => {
      assert.strictEqual(name, 'PlayerOne');
      assert.strictEqual(text, 'May the best hand win!');
      console.log('  ✅ Live Chat broadcast verified');
      resolve();
    });
    p1.emit('chat:send', { text: 'May the best hand win!' });
  });

  // ==========================================
  // STAGE 6: Game Actions & Invalid Raise Feedback
  // ==========================================
  console.log('\n[Stage 6/8] Testing game actions & invalid raise error feedback...');
  // P2 (whose turn it is) tests peeking
  await new Promise((resolve) => {
    p2.once('room:updated', (publicState) => {
      const p = publicState.players.find((x) => x.name === 'PlayerTwo');
      if (p && p.state === 'seen') {
        console.log('  ✅ Player 2 peeked successfully');
        resolve();
      }
    });
    p2.emit('game:peek');
  });

  // P2 attempts invalid raise (amount 10 < currentBet * 2 = 100)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Invalid raise timed out waiting for error')), 3000);
    p2.once('room:error', ({ message }) => {
      clearTimeout(timer);
      assert.strictEqual(message, 'Invalid raise amount');
      console.log('  ✅ Invalid raise correctly emitted room:error ("Invalid raise amount") without skipping turn');
      resolve();
    });
    p2.emit('game:action', { type: 'raise', amount: 10 });
  });

  // P2 now makes a valid call -> turn advances to P3
  const p3TurnPromise = new Promise((resolve) => {
    p3.once('game:yourTurn', () => resolve());
  });
  p2.emit('game:action', { type: 'call' });
  await p3TurnPromise;
  console.log('  ✅ Player 2 made valid call, turn advanced to Player 3');

  // ==========================================
  // STAGE 7: Round Completion & Rematch / Next Round Flow
  // ==========================================
  console.log('\n[Stage 7/8] Completing round 1 and testing Rematch / Next Round flow...');
  // P3 folds -> turn advances to P1
  const p1TurnPromise = new Promise((resolve) => {
    p1.once('game:yourTurn', () => resolve());
  });
  p3.emit('game:action', { type: 'fold' });
  await p1TurnPromise;

  // P1 calls -> turn returns to P2
  const p2TurnAgain = new Promise((resolve) => {
    p2.once('game:yourTurn', () => resolve());
  });
  p1.emit('game:action', { type: 'call' });
  await p2TurnAgain;

  // P2 folds -> P1 is the only remaining active player -> round ends
  const gameOverPromise = Promise.all([
    new Promise((res) => p1.once('game:over', (d) => res(d))),
    new Promise((res) => p2.once('game:over', (d) => res(d))),
    new Promise((res) => p3.once('game:over', (d) => res(d))),
  ]);
  p2.emit('game:action', { type: 'fold' });
  const [gameOver1] = await gameOverPromise;
  assert.strictEqual(gameOver1.winnerName, 'PlayerOne');
  console.log('  ✅ Round 1 completed. Winner: PlayerOne');

  // Rematch / Next Round: P1 calls game:start without requiring players to re-ready
  await new Promise((r) => setTimeout(r, 100));
  const dealRound2Promise = Promise.all([
    new Promise((res) => p1.once('game:dealt', (d) => res(d))),
    new Promise((res) => p2.once('game:dealt', (d) => res(d))),
    new Promise((res) => p3.once('game:dealt', (d) => res(d))),
  ]);
  p1.emit('game:start');
  const [r2Deal1, r2Deal2, r2Deal3] = await dealRound2Promise;
  assert.strictEqual(r2Deal1.hand.length, 3);
  assert.strictEqual(r2Deal2.hand.length, 3);
  assert.strictEqual(r2Deal3.hand.length, 3);
  console.log('  ✅ Rematch started successfully without "Not all players ready" deadlock');

  // ==========================================
  // STAGE 8: Host Disconnect & Leadership Transfer
  // ==========================================
  console.log('\n[Stage 8/8] Testing host disconnect leadership transfer and 2-player match...');
  // Let Round 2 finish: P2 has turn in round 2
  const r2OverPromise = Promise.all([
    new Promise((res) => p1.once('game:over', (d) => res(d))),
    new Promise((res) => p2.once('game:over', (d) => res(d))),
    new Promise((res) => p3.once('game:over', (d) => res(d))),
  ]);
  
  // P2 folds, advancing turn to P3; P3 folds, leaving P1 winner
  const p3TurnR2 = new Promise((resolve) => p3.once('game:yourTurn', () => resolve()));
  p2.emit('game:action', { type: 'fold' });
  await p3TurnR2;
  p3.emit('game:action', { type: 'fold' });
  await r2OverPromise;
  await new Promise((r) => setTimeout(r, 100));

  // Current host (P1) disconnects in waiting room
  const leadershipPromise = new Promise((resolve) => {
    p2.once('room:updated', (updatedRoom) => {
      if (updatedRoom.host === p2.id) {
        resolve(updatedRoom);
      }
    });
  });

  p1.disconnect();
  const transferredRoom = await leadershipPromise;
  assert.strictEqual(transferredRoom.host, p2.id, 'Host leadership must transfer to Player 2');
  assert.strictEqual(transferredRoom.players.length, 2, '2 players remain in room');
  console.log('  ✅ Host leadership successfully transferred to Player 2');

  // Test 2-Player Match Start with new host P2
  const twoPlayerDeal = Promise.all([
    new Promise((res) => p2.once('game:dealt', (d) => res(d))),
    new Promise((res) => p3.once('game:dealt', (d) => res(d))),
  ]);
  const p3TurnTwoPlayer = new Promise((res) => p3.once('game:yourTurn', (d) => res(d)));

  p2.emit('game:start');
  const [p2Cards, p3Cards] = await twoPlayerDeal;
  await p3TurnTwoPlayer;

  assert.strictEqual(p2Cards.hand.length, 3);
  assert.strictEqual(p3Cards.hand.length, 3);
  console.log('  ✅ 2-Player match successfully started by new host');

  // Verify sideshow is disabled when active players == 2:
  // P3 peeks
  const peekPromise = new Promise((resolve) => p3.once('room:updated', () => resolve()));
  p3.emit('game:peek');
  await peekPromise;

  // P3 requests sideshow -> must be rejected because only 2 active players
  const sideshowErrPromise = new Promise((resolve) => {
    p3.once('room:error', ({ message }) => resolve(message));
  });
  p3.emit('game:action', { type: 'sideshow_request' });
  const sideshowMsg = await sideshowErrPromise;
  assert.strictEqual(sideshowMsg, 'Sideshow requires at least 3 active players');
  console.log('  ✅ Sideshow correctly disabled in 2-player match');

  // Final Cleanup
  cleanup();
  console.log('\n🎉 ALL 8 MULTIPLAYER AND BACKEND INFRASTRUCTURE STAGES PASSED WITH 100% SUCCESS!\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Multiplayer Simulation Failed:', err);
  cleanup();
  process.exit(1);
});
