// ─── Shared TypeScript Types ──────────────────────────────────────────────────

export type GameStatus = 'lobby' | 'active' | 'ended';

export interface Planet {
  id: string;
  x: number;           // 0–100 (percent of canvas width)
  y: number;           // 0–100 (percent of canvas height)
  owner: string | null; // UID or null for unowned
  ships: number;
  productionBase: number; // 15 for home planets, 1–20 for others
  isHome: boolean;
}

export interface Fleet {
  id: string;
  owner: string;           // UID
  fromPlanetId: string;
  toPlanetId: string;
  ships: number;
  departYear: number;
  arriveYear: number;
}

export interface Player {
  uid: string;
  name: string;
  phone: string;
  homePlanetId: string;
  revealedPlanets: string[]; // Fog of War: planet IDs the player can see
}

export interface Game {
  id: string;
  status: GameStatus;
  currentYear: number;
  players: string[];   // array of UIDs
  turn: string;        // UID of the player whose turn it is
  turnEnded: Record<string, boolean>; // UID → has ended turn this year
  hostUid: string;
  createdAt?: number;  // Unix ms timestamp when game was created
  updatedAt?: number;  // Unix ms timestamp of last status change
  inviteCode: string;  // Short 5-char code for sharing (e.g. "X7K2M")
  planetCount?: number; // Number of planets in the galaxy (10 or 20)
  maxPlayers?: number;  // Maximum number of players allowed (default: 4)
  winnerUid?: string;  // UID of the winner when game ends
}

export interface CombatPhase {
  atk: number;   // attackers remaining after this phase
  def: number;   // defenders remaining after this phase
}

export interface CombatResult {
  survivingAttackers: number;
  survivingDefenders: number;
  attackerWon: boolean;
  phases: CombatPhase[];  // snapshots after each batch of rounds
}

export interface BattleRecord {
  id: string;
  attackerUid: string;
  defenderUid: string;
  planetId: string;
  planetIndex: number;       // sorted planet # for display
  attackerShips: number;     // starting count
  defenderShips: number;     // starting count
  phases: CombatPhase[];     // ship counts after each phase
  attackerWon: boolean;
  survivingAttackerShips: number;  // final attacker count after combat
  survivingDefenderShips: number;  // final defender count after combat
  year: number;
  sequence?: number;         // resolution order
  viewedBy: string[];        // UIDs who have watched the replay
  appliedToMap?: boolean;    // true once applied to the official planet docs
}

export interface ColonizationRecord {
  id: string;
  fleetOwnerUid: string;
  planetId: string;
  ships: number;             // ships that arrived to colonize
  year: number;
  sequence?: number;
  viewedBy: string[];
  appliedToMap?: boolean;    // true once applied to the official planet docs
}

export interface ReinforcementRecord {
  id: string;
  fleetOwnerUid: string;
  planetId: string;
  ships: number;             // ships that arrived to reinforce
  year: number;
  sequence?: number;
  viewedBy: string[];
  appliedToMap?: boolean;    // true once applied to the official planet docs
}
