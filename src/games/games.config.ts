export interface GameConfig {
  id: string;
  name: string;
  description: string;
  maxScore: number;
  dailyLimit: number;
  maxPower: number; // max temporary power (Gh/s) earned per play
}

export const GAME_CONFIG: Record<string, GameConfig> = {
  click: {
    id: 'click',
    name: 'Coin Clicker',
    description: 'Click the coin as fast as you can for 30 seconds!',
    maxScore: 300,
    dailyLimit: 3,
    maxPower: 8400,
  },
  memory: {
    id: 'memory',
    name: 'Memory Match',
    description: 'Match all 8 pairs of crypto cards to win!',
    maxScore: 100,
    dailyLimit: 3,
    maxPower: 6000,
  },
  '2048': {
    id: '2048',
    name: '2048 Crypto',
    description: 'Merge tiles to reach 2048 using arrow keys!',
    maxScore: 2048,
    dailyLimit: 3,
    maxPower: 7200,
  },
};
