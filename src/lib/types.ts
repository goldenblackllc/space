// ─── Shared TypeScript Types ──────────────────────────────────────────────────

export type GameStatus = 'lobby' | 'active' | 'ended';

export interface Planet {
  id: string;
  x: number;           // 0–100 (percent of canvas width)
  y: number;           // 0–100 (percent of canvas height)
  owner: string | null; // UID or null for unowned
  ships: number;
  productionBase: number; // 20 for home planets, 1–20 for unowned
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
  hostUid: string;
}

export interface CombatResult {
  survivingAttackers: number;
  survivingDefenders: number;
  attackerWon: boolean;
}
