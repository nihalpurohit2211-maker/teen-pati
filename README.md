# Teen Patti Multiplayer Game

A real-time multiplayer implementation of the classic Indian card game Teen Patti, built with Node.js, Express, and Socket.io.

## Prerequisites
- Node.js 18+

## Installation
Run the following command to install dependencies:
```
npm install
```

## Running Locally
Start the server using:
```
npm start
```
The application will be accessible at http://localhost:3000.

## How to Share
### LAN (Same WiFi)
1. Find your local IP address using `ipconfig` (Windows) or `ifconfig` (macOS/Linux).
2. Ask your friends to visit `http://<your-ip>:3000` on their devices.

### Free Internet Deploy with Railway
1. Push this project to a GitHub repository.
2. Sign up on [Railway.app](https://railway.app/).
3. Click "New Project" -> "Deploy from GitHub repo".
4. Select your repository and deploy. Railway will automatically build and provide a public URL.

## Sound Files
To add sound effects, place them in a `public/sounds` directory (e.g., `deal.mp3`, `chip.mp3`, `win.mp3`).
You can get free royalty-free sounds from websites like [Freesound](https://freesound.org/) or [Mixkit](https://mixkit.co/free-sound-effects/).

## Game Rules Quick Reference
The game uses a standard 52-card deck (no jokers). Each player is dealt 3 cards. 

**Hand Rankings (Highest to Lowest):**
1. **Trail / Set** (Three of a kind): E.g., A-A-A, K-K-K
2. **Pure Sequence** (Straight Flush): E.g., A-K-Q of hearts, 4-3-2 of spades
3. **Sequence** (Straight): E.g., A-K-Q mixed suits, 4-3-2 mixed suits
4. **Color** (Flush): 3 cards of the same suit
5. **Pair**: 2 cards of the same rank
6. **High Card**: When none of the above apply

*Note: A-2-3 is a valid sequence, but Q-K-A is not valid.*

**Actions:**
- **Blind**: Play without seeing your cards (pay normal bet).
- **Seen**: Play after seeing your cards (pay double the bet).
- **Sideshow**: Ask the previous seen player to compare hands secretly. The loser folds.
- **Show**: When only 2 players remain, one can pay to reveal and compare hands to determine the winner.
