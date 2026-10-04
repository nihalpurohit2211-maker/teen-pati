const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const suits = ['S', 'H', 'D', 'C'];

function getCardValue(card) {
  const rank = card[0];
  return ranks.indexOf(rank) + 2;
}

function getCardSuit(card) {
  return card[1];
}

function createDeck() {
  const deck = [];
  for (const rank of ranks) {
    for (const suit of suits) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dealHands(numPlayers) {
  const deck = shuffleDeck(createDeck());
  const hands = [];
  for (let i = 0; i < numPlayers; i++) {
    hands.push([deck.pop(), deck.pop(), deck.pop()]);
  }
  return { hands, remaining: deck };
}

function rankHand(cards) {
  const sortedCards = [...cards].sort((a, b) => getCardValue(b) - getCardValue(a));
  const vals = sortedCards.map(getCardValue);
  const su = sortedCards.map(getCardSuit);

  const isFlush = su[0] === su[1] && su[1] === su[2];
  
  let isSeq = false;
  let seqVals = [...vals];
  if (vals[0] === vals[1] + 1 && vals[1] === vals[2] + 1) {
    isSeq = true;
  } else if (vals[0] === 14 && vals[1] === 3 && vals[2] === 2) {
    isSeq = true;
    seqVals = [3, 2, 14];
  }

  const isTrail = vals[0] === vals[1] && vals[1] === vals[2];
  
  let isPair = false;
  let pairVal = 0;
  let kicker = 0;
  if (vals[0] === vals[1]) { isPair = true; pairVal = vals[0]; kicker = vals[2]; }
  else if (vals[1] === vals[2]) { isPair = true; pairVal = vals[1]; kicker = vals[0]; }
  else if (vals[0] === vals[2]) { isPair = true; pairVal = vals[0]; kicker = vals[1]; }

  if (isTrail) return { rank: 1, label: 'Trail', tiebreaker: [vals[0]] };
  if (isSeq && isFlush) return { rank: 2, label: 'Pure Sequence', tiebreaker: seqVals };
  if (isSeq) return { rank: 3, label: 'Sequence', tiebreaker: seqVals };
  if (isFlush) return { rank: 4, label: 'Color', tiebreaker: vals };
  if (isPair) return { rank: 5, label: 'Pair', tiebreaker: [pairVal, kicker] };
  return { rank: 6, label: 'High Card', tiebreaker: vals };
}

function compareHands(cardsA, cardsB) {
  const rA = rankHand(cardsA);
  const rB = rankHand(cardsB);
  if (rA.rank < rB.rank) return 1;
  if (rA.rank > rB.rank) return -1;
  
  for (let i = 0; i < rA.tiebreaker.length; i++) {
    if (rA.tiebreaker[i] > rB.tiebreaker[i]) return 1;
    if (rA.tiebreaker[i] < rB.tiebreaker[i]) return -1;
  }
  return 0;
}

function getHandStrength(cards) {
  const r = rankHand(cards);
  let percentile, emoji, description;
  switch (r.rank) {
    case 1:
      percentile = 95; emoji = '🔥'; description = 'Three of a Kind! You have three of a kind. This is the best hand in Teen Patti — you are almost certainly winning!';
      break;
    case 2:
      percentile = 85; emoji = '💎'; description = 'Pure Sequence! You have a straight flush. Amazing hand, bet confidently!';
      break;
    case 3:
      percentile = 70; emoji = '⚡'; description = 'Sequence! You have a straight. Very strong hand in Teen Patti.';
      break;
    case 4:
      percentile = 50; emoji = '👍'; description = 'Color! You have a flush. Good hand, but be careful of sequences.';
      break;
    case 5:
      percentile = 30; emoji = '🤔'; description = 'Pair! You have a pair. Play cautiously.';
      break;
    case 6:
      percentile = 10; emoji = '😬'; description = 'High Card. This is the weakest hand type. Consider staying Blind to save chips!';
      break;
  }
  return { rank: r.rank, label: r.label, description, percentile, emoji };
}

function getHandLabel(rank) {
  const labels = { 1: 'Trail', 2: 'Pure Sequence', 3: 'Sequence', 4: 'Color', 5: 'Pair', 6: 'High Card' };
  return labels[rank];
}

function getMinBet(isBlind, currentBet) {
  return isBlind ? currentBet : 2 * currentBet;
}

function countActivePlayers(players) {
  return players.filter(p => p.state !== 'folded').length;
}

function getNextActivePlayerIndex(players, currentIndex) {
  if (countActivePlayers(players) <= 1) return -1;
  let idx = (currentIndex + 1) % players.length;
  while (players[idx].state === 'folded') {
    idx = (idx + 1) % players.length;
  }
  return idx;
}

function canSideshow(room, playerId) {
  const players = room.players;
  const playerIdx = players.findIndex(p => p.id === playerId);
  if (playerIdx === -1 || players[playerIdx].state !== 'seen') return false;
  if (countActivePlayers(players) < 3) return false;

  let prevIdx = (playerIdx - 1 + players.length) % players.length;
  while (players[prevIdx].state === 'folded') {
    prevIdx = (prevIdx - 1 + players.length) % players.length;
  }
  
  if (players[prevIdx].state !== 'seen') return false;
  return true;
}

function getWinner(players) {
  const active = players.filter(p => p.state !== 'folded');
  if (active.length === 0) return null;
  let winner = active[0];
  for (let i = 1; i < active.length; i++) {
    if (compareHands(active[i].hand, winner.hand) > 0) {
      winner = active[i];
    }
  }
  return winner;
}

module.exports = {
  createDeck, shuffleDeck, dealHands, rankHand, compareHands, getHandStrength, getHandLabel,
  getMinBet, canSideshow, getNextActivePlayerIndex, countActivePlayers, getWinner
};
