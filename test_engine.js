const assert = require('assert');
const gameEngine = require('./src/gameEngine');

console.log('🧪 Running Comprehensive Teen Patti Engine & Logic Tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n${err.stack}`);
    failed++;
  }
}

// 1. Deck tests
test('Deck has 52 unique valid cards', () => {
  const deck = gameEngine.createDeck();
  assert.strictEqual(deck.length, 52);
  const set = new Set(deck);
  assert.strictEqual(set.size, 52);
});

test('Deck shuffling modifies order', () => {
  const deck = gameEngine.createDeck();
  const shuffled = gameEngine.shuffleDeck(deck);
  assert.strictEqual(shuffled.length, 52);
  // Probability of exact match after shuffle is negligible
  assert.notDeepStrictEqual(deck, shuffled);
});

test('Deal hands deals correct number of cards and remaining', () => {
  const dealt = gameEngine.dealHands(4);
  assert.strictEqual(dealt.hands.length, 4);
  dealt.hands.forEach(h => assert.strictEqual(h.length, 3));
  assert.strictEqual(dealt.remaining.length, 52 - 12);
});

// 2. Hand Ranking Tests
test('Rank 1: Trail (Three of a Kind) detected correctly', () => {
  const trailA = gameEngine.rankHand(['AS', 'AH', 'AD']);
  const trailK = gameEngine.rankHand(['KS', 'KH', 'KD']);
  assert.strictEqual(trailA.rank, 1);
  assert.strictEqual(trailK.rank, 1);
  assert.strictEqual(gameEngine.compareHands(['AS', 'AH', 'AD'], ['KS', 'KH', 'KD']), 1);
  assert.strictEqual(gameEngine.compareHands(['KS', 'KH', 'KD'], ['AS', 'AH', 'AD']), -1);
});

test('Rank 2: Pure Sequence (Straight Flush) beats Sequence & Color', () => {
  const pureSeq = gameEngine.rankHand(['AS', 'KS', 'QS']);
  const pureSeqLow = gameEngine.rankHand(['AS', '2S', '3S']);
  const regSeq = gameEngine.rankHand(['AS', 'KD', 'QS']);
  const color = gameEngine.rankHand(['AS', 'JS', '7S']);

  assert.strictEqual(pureSeq.rank, 2);
  assert.strictEqual(pureSeqLow.rank, 2);
  assert.strictEqual(gameEngine.compareHands(['AS', 'KS', 'QS'], ['AS', 'KD', 'QS']), 1);
  assert.strictEqual(gameEngine.compareHands(['AS', 'KS', 'QS'], ['AS', 'JS', '7S']), 1);
});

test('Pure Sequence A-2-3 is lower than 2-3-4', () => {
  // A-2-3 is considered the lowest sequence in Teen Patti
  const comp = gameEngine.compareHands(['2S', '3S', '4S'], ['AS', '2S', '3S']);
  assert.strictEqual(comp, 1);
});

test('Rank 3: Sequence beats Color and Pair', () => {
  const seq = gameEngine.rankHand(['TD', '9S', '8H']);
  const color = gameEngine.rankHand(['AH', 'KH', '2H']);
  const pair = gameEngine.rankHand(['AS', 'AH', 'KD']);

  assert.strictEqual(seq.rank, 3);
  assert.strictEqual(color.rank, 4);
  assert.strictEqual(pair.rank, 5);

  assert.strictEqual(gameEngine.compareHands(['TD', '9S', '8H'], ['AH', 'KH', '2H']), 1);
  assert.strictEqual(gameEngine.compareHands(['AH', 'KH', '2H'], ['AS', 'AH', 'KD']), 1);
});

test('Rank 5: Pair comparisons with kicker', () => {
  // Higher pair wins
  assert.strictEqual(gameEngine.compareHands(['KS', 'KD', '2H'], ['QS', 'QD', 'AH']), 1);
  // Equal pair, higher kicker wins
  assert.strictEqual(gameEngine.compareHands(['KS', 'KD', 'AH'], ['KC', 'KH', 'TH']), 1);
  // Equal pair, equal kicker is a tie
  assert.strictEqual(gameEngine.compareHands(['KS', 'KD', 'AH'], ['KC', 'KH', 'AS']), 0);
});

test('Rank 6: High Card comparisons', () => {
  assert.strictEqual(gameEngine.compareHands(['AS', 'KD', '9H'], ['AS', 'KD', '8H']), 1);
  assert.strictEqual(gameEngine.compareHands(['KS', 'QD', '9H'], ['AS', '7D', '2H']), -1);
  assert.strictEqual(gameEngine.compareHands(['AS', 'KD', '9H'], ['AH', 'KC', '9S']), 0);
});

test('Hand strength metadata and percentile', () => {
  const strengthTrail = gameEngine.getHandStrength(['AS', 'AH', 'AD']);
  assert.strictEqual(strengthTrail.rank, 1);
  assert.strictEqual(strengthTrail.percentile >= 90, true);

  const strengthHigh = gameEngine.getHandStrength(['7S', '5D', '2H']);
  assert.strictEqual(strengthHigh.rank, 6);
  assert.strictEqual(strengthHigh.percentile <= 20, true);
});

test('Bet calculation for Blind vs Seen', () => {
  const currentBet = 50;
  assert.strictEqual(gameEngine.getMinBet(true, currentBet), 50);
  assert.strictEqual(gameEngine.getMinBet(false, currentBet), 100);
});

test('Sideshow validity conditions', () => {
  const room = {
    players: [
      { id: '1', state: 'seen' },
      { id: '2', state: 'seen' },
      { id: '3', state: 'seen' }
    ]
  };
  assert.strictEqual(gameEngine.canSideshow(room, '2'), true);

  // If previous player is blind
  room.players[0].state = 'blind';
  assert.strictEqual(gameEngine.canSideshow(room, '2'), false);

  // If only 2 active players left (sideshow not allowed, only show)
  room.players[0].state = 'folded';
  assert.strictEqual(gameEngine.canSideshow(room, '2'), false);
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
