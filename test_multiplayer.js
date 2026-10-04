const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

console.log('🎮 Starting End-to-End Multiplayer Simulation Test...');

function connectClient() {
  return new Promise((resolve) => {
    const socket = io(SERVER_URL, { forceNew: true });
    socket.on('connect', () => resolve(socket));
  });
}

async function run() {
  const p1 = await connectClient();
  console.log('  ✅ Player 1 connected');

  const p2 = await connectClient();
  console.log('  ✅ Player 2 connected');

  const p3 = await connectClient();
  console.log('  ✅ Player 3 connected');

  let roomCode = '';

  // Player 1 creates room
  await new Promise((resolve, reject) => {
    p1.once('room:joined', ({ room, isHost }) => {
      assert.strictEqual(isHost, true);
      assert.strictEqual(room.players.length, 1);
      roomCode = room.code;
      console.log(`  ✅ Player 1 created room: ${roomCode}`);
      resolve();
    });
    p1.once('room:error', (err) => reject(new Error(err.message)));
    p1.emit('room:create', { name: 'PlayerOne' });
  });

  // Player 2 joins
  await new Promise((resolve, reject) => {
    p2.once('room:joined', ({ room, isHost }) => {
      assert.strictEqual(isHost, false);
      console.log('  ✅ Player 2 joined room');
      resolve();
    });
    p2.once('room:error', (err) => reject(new Error(err.message)));
    p2.emit('room:join', { code: roomCode, name: 'PlayerTwo' });
  });

  // Player 3 joins
  await new Promise((resolve, reject) => {
    p3.once('room:joined', ({ room, isHost }) => {
      assert.strictEqual(isHost, false);
      console.log('  ✅ Player 3 joined room');
      resolve();
    });
    p3.once('room:error', (err) => reject(new Error(err.message)));
    p3.emit('room:join', { code: roomCode, name: 'PlayerThree' });
  });

  // Non-hosts ready up
  p2.emit('room:ready');
  p3.emit('room:ready');
  console.log('  ✅ Players 2 and 3 clicked Ready');

  await new Promise((r) => setTimeout(r, 200));

  // Host starts game
  const dealPromise = Promise.all([
    new Promise((res) => p1.once('game:dealt', (d) => res(d))),
    new Promise((res) => p2.once('game:dealt', (d) => res(d))),
    new Promise((res) => p3.once('game:dealt', (d) => res(d))),
  ]);

  p1.emit('game:start');
  const [deal1, deal2, deal3] = await dealPromise;

  assert.strictEqual(deal1.hand.length, 3);
  assert.strictEqual(deal2.hand.length, 3);
  assert.strictEqual(deal3.hand.length, 3);
  console.log(`  ✅ Cards dealt: P1=${deal1.hand.join(' ')}, P2=${deal2.hand.join(' ')}, P3=${deal3.hand.join(' ')}`);

  // Test live chat
  await new Promise((resolve) => {
    p2.once('chat:message', ({ name, text }) => {
      assert.strictEqual(name, 'PlayerOne');
      assert.strictEqual(text, 'Hey friends!');
      console.log('  ✅ Live Chat broadcast verified');
      resolve();
    });
    p1.emit('chat:send', { text: 'Hey friends!' });
  });

  // Test peek
  await new Promise((resolve) => {
    p1.once('room:updated', (publicState) => {
      const p = publicState.players.find((x) => x.name === 'PlayerOne');
      if (p && p.state === 'seen') {
        console.log('  ✅ Peeking state successfully synced');
        resolve();
      }
    });
    p1.emit('game:peek');
  });

  p1.disconnect();
  p2.disconnect();
  p3.disconnect();

  console.log('\n🎉 ALL MULTIPLAYER SOCKET FLOWS PASSED WITH 100% SUCCESS!\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Multiplayer Simulation Failed:', err);
  process.exit(1);
});
