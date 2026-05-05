// ─── Turn Timer Utilities ─────────────────────────────────────────────────────
//
// Compressed tournament timer (3-day games):
//   Day 1:  12 hours per turn — opening moves, claim territory
//   Day 2:   6 hours per turn — mid-game push, pressure mounts
//   Day 3+:  Tiebreaker — game ends, most planets wins

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

/** Timer durations in ms, indexed by game day (0-based) */
const TIMER_SCHEDULE: number[] = [
  12 * MS_HOUR, // Day 1
  6 * MS_HOUR,  // Day 2
  // Day 3+ = tiebreaker (0 = immediate)
];

const TIEBREAKER_DAY = 3; // 1-indexed: game ends on day 3

export interface TurnTimerInfo {
  /** Whether the timer is active for this game */
  enabled: boolean;
  /** How many ms the current turn allows */
  turnDurationMs: number;
  /** Unix ms deadline for the current turn */
  deadline: number;
  /** Seconds remaining until deadline (negative = expired) */
  remainingSeconds: number;
  /** Whether the deadline has passed */
  expired: boolean;
  /** Whether we're in tiebreaker territory (Day 7+) */
  isTiebreaker: boolean;
  /** Current game day (1-indexed) */
  gameDay: number;
  /** Human-readable time remaining */
  display: string;
}

/**
 * Calculate turn timer info for a game.
 * Returns null if the timer is not enabled.
 */
export function getTurnTimerInfo(
  turnTimerEnabled: boolean | undefined,
  gameStartedAt: number | undefined,
  turnStartedAt: number | undefined,
  now: number = Date.now()
): TurnTimerInfo | null {
  if (!turnTimerEnabled || !gameStartedAt || !turnStartedAt) return null;

  const elapsedSinceGameStart = now - gameStartedAt;
  const gameDay = Math.floor(elapsedSinceGameStart / MS_DAY) + 1; // 1-indexed
  const isTiebreaker = gameDay >= TIEBREAKER_DAY;

  // Look up turn duration from schedule (cap at last defined entry)
  const scheduleIdx = Math.min(gameDay - 1, TIMER_SCHEDULE.length - 1);
  const turnDurationMs = isTiebreaker ? 0 : TIMER_SCHEDULE[scheduleIdx];

  const deadline = turnStartedAt + turnDurationMs;
  const remainingMs = deadline - now;
  const remainingSeconds = Math.floor(remainingMs / 1000);
  const expired = isTiebreaker || remainingMs <= 0;

  return {
    enabled: true,
    turnDurationMs,
    deadline,
    remainingSeconds: Math.max(0, remainingSeconds),
    expired,
    isTiebreaker,
    gameDay,
    display: isTiebreaker
      ? 'TIEBREAKER'
      : expired
        ? 'EXPIRED'
        : formatCountdown(remainingSeconds),
  };
}

/** Format seconds into "12H 34M" or "5M 20S" display */
function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'EXPIRED';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}H ${minutes.toString().padStart(2, '0')}M`;
  }
  return `${minutes}M ${seconds.toString().padStart(2, '0')}S`;
}

/**
 * Get the turn timer label for the HUD (e.g. "DAY 3 • 18H 42M")
 */
export function getTurnTimerLabel(info: TurnTimerInfo): string {
  if (info.isTiebreaker) return `DAY ${info.gameDay} • TIEBREAKER`;
  if (info.expired) return `DAY ${info.gameDay} • EXPIRED`;
  return `DAY ${info.gameDay} • ${info.display}`;
}
