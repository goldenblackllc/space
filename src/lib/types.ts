// ─── Shared TypeScript Types ──────────────────────────────────────────────────

// ─── Team Types ───────────────────────────────────────────────────────────────

/** Pre-defined team colors — visually distinct on dark backgrounds */
export const TEAM_COLORS = [
  '#4fc3f7', // sky blue
  '#ef5350', // coral red
  '#66bb6a', // green
  '#ffa726', // amber
  '#ab47bc', // purple
  '#26c6da', // cyan
  '#ff7043', // deep orange
  '#8d6e63', // brown
] as const;

export interface TeamConfig {
  id: string;         // e.g. 'team-1'
  name: string;       // e.g. 'Alpha Squad'
  color: string;      // hex color from TEAM_COLORS
  members: string[];  // UIDs of players on this team
}

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
  teamId?: string;           // Team ID within this game (e.g. 'team-1')
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
  planetCount?: number; // Number of planets in the galaxy (default 20)
  maxPlayers?: number;  // Maximum number of players allowed (default: 4)
  winnerUid?: string;  // UID of the winner when game ends
  // ── Team Mode Fields ──
  teams?: TeamConfig[];         // Team definitions (absent = free-for-all)
  winnerTeamId?: string;        // Winning team ID when game ends in team mode
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
