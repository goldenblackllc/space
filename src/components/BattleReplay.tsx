'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BattleRecord } from '@/lib/types';
import styles from './BattleReplay.module.css';

// ── Duration scaling ──────────────────────────────────────────────────────────
// 500ms base interval for tiny battles → 2s for big ones, but the per-phase
// delay is always at least 2 seconds (user wants slow dramatic pacing).
// Total battle time = phaseCount × phaseInterval.
const PHASE_INTERVAL_MS = 2000;   // 2s between phases (user request)
const PROCESSING_LABEL_MS = 1200; // first 1.2s shows "PROCESSING…"

// ── Component ─────────────────────────────────────────────────────────────────
type CombatSubStage = 'reveal' | 'processing' | 'resolved';
type Stage = 'briefing' | 'combat' | 'outcome';

interface Props {
  battle: BattleRecord;
  myUid: string;
  /** Label for each player UID, e.g. { [uid]: "You" | "Player 2" } */
  playerLabels: Record<string, string>;
  onDismiss: () => void;
}

export default function BattleReplay({ battle, myUid, playerLabels, onDismiss }: Props) {
  const [stage, setStage] = useState<Stage>('briefing');
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const [subStage, setSubStage] = useState<CombatSubStage>('resolved');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phaseCount = battle.phases.length;

  const atkLabel = playerLabels[battle.attackerUid] ?? 'Player';
  const defLabel = playerLabels[battle.defenderUid] ?? 'Player';

  // Current ships for display
  const currentAtk = phaseIdx < 0 ? battle.attackerShips : (battle.phases[phaseIdx]?.atk ?? 0);
  const currentDef = phaseIdx < 0 ? battle.defenderShips : (battle.phases[phaseIdx]?.def ?? 0);

  // Previous phase (for winner highlight)
  const prevAtk = phaseIdx <= 0 ? battle.attackerShips : (battle.phases[phaseIdx - 1]?.atk ?? battle.attackerShips);
  const prevDef = phaseIdx <= 0 ? battle.defenderShips : (battle.phases[phaseIdx - 1]?.def ?? battle.defenderShips);

  // Which side took more losses this phase?
  const atkLoss = prevAtk - currentAtk;
  const defLoss = prevDef - currentDef;
  const phaseWinner: 'atk' | 'def' | null =
    phaseIdx < 0 ? null
    : defLoss > atkLoss ? 'atk'
    : atkLoss > defLoss ? 'def'
    : null;

  // Tug-of-war: attacker fill = atk/(atk+def) expressed as % of bar
  const totalRemaining = currentAtk + currentDef;
  const atkBarPct = totalRemaining > 0 ? (currentAtk / (battle.attackerShips + battle.defenderShips)) * 100 : 0;
  const defBarPct = totalRemaining > 0 ? (currentDef / (battle.attackerShips + battle.defenderShips)) * 100 : 0;

  // Drive phase sequence
  const advancePhase = useCallback((i: number) => {
    if (i >= phaseCount) {
      setTimeout(() => setStage('outcome'), 800);
      return;
    }
    // Show "processing" for first portion of interval
    setSubStage('processing');
    timerRef.current = setTimeout(() => {
      setPhaseIdx(i);
      setSubStage('reveal');
      timerRef.current = setTimeout(() => {
        setSubStage('resolved');
        timerRef.current = setTimeout(() => advancePhase(i + 1), PHASE_INTERVAL_MS - PROCESSING_LABEL_MS - 400);
      }, 400);
    }, PROCESSING_LABEL_MS);
  }, [phaseCount]);

  const startCombat = useCallback(() => {
    setStage('combat');
    setPhaseIdx(-1);
    setSubStage('resolved');
    advancePhase(0);
  }, [advancePhase]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // ── Briefing ──────────────────────────────────────────────────────────────
  if (stage === 'briefing') {
    return (
      <div className={styles.overlay}>
        <div className={styles.container}>
          <span className={styles.yearBadge}>YEAR {battle.year}</span>
          <span className={styles.briefingTitle}>⚔ BATTLE REPORT</span>

          <div className={styles.briefingBox}>
            {/* Attacker side */}
            <div className={styles.briefingSide}>
              <span className={styles.briefingRole}>ATTACKER</span>
              <span className={`${styles.briefingName} ${styles.attackerColor}`}>
                {atkLabel}
              </span>
              <span className={`${styles.briefingShips} ${styles.attackerColor}`}>
                {battle.attackerShips.toLocaleString()} SHIPS
              </span>
            </div>

            <div className={styles.versus}>VS</div>

            {/* Defender side */}
            <div className={styles.briefingSide}>
              <span className={styles.briefingRole}>DEFENDER</span>
              <span className={`${styles.briefingName} ${styles.defenderColor}`}>
                {defLabel}
              </span>
              <span className={`${styles.briefingShips} ${styles.defenderColor}`}>
                {battle.defenderShips.toLocaleString()} SHIPS
              </span>
            </div>
          </div>

          <button className={styles.beginBtn} onClick={startCombat}>
            BEGIN BATTLE
          </button>
        </div>
      </div>
    );
  }

  // ── Combat stage ──────────────────────────────────────────────────────────
  if (stage === 'combat') {
    const isProcessing = subStage === 'processing';
    const phaseNum = Math.max(1, phaseIdx + 1);

    return (
      <div className={styles.overlay}>
        <div className={styles.container}>
          <span className={styles.yearBadge}>YEAR {battle.year}</span>

          {/* Status line */}
          <span className={styles.combatTitle}>
            {isProcessing
              ? `⚙ BATTLE · PROCESSING…`
              : phaseIdx < 0
              ? `⚔ BATTLE IN PROGRESS`
              : `⚔ BATTLE · ROUND ${phaseNum} / ${phaseCount}`}
          </span>

          {/* Player labels above bar */}
          <div className={styles.tugLabels}>
            <div className={styles.tugSide}>
              <span className={`${styles.tugName} ${styles.attackerColor} ${phaseWinner === 'atk' && !isProcessing ? styles.winner : ''}`}>
                {atkLabel}
              </span>
              <span className={`${styles.tugCount} ${styles.attackerColor} ${phaseWinner === 'atk' && !isProcessing ? styles.winner : ''}`}>
                {currentAtk.toLocaleString()}
              </span>
              {phaseWinner === 'atk' && !isProcessing && (
                <span className={styles.winIndicator}>▲</span>
              )}
            </div>

            <div className={`${styles.tugSide} ${styles.tugSideRight}`}>
              {phaseWinner === 'def' && !isProcessing && (
                <span className={`${styles.winIndicator} ${styles.winIndicatorRight}`}>▲</span>
              )}
              <span className={`${styles.tugCount} ${styles.defenderColor} ${phaseWinner === 'def' && !isProcessing ? styles.winner : ''}`}>
                {currentDef.toLocaleString()}
              </span>
              <span className={`${styles.tugName} ${styles.defenderColor} ${phaseWinner === 'def' && !isProcessing ? styles.winner : ''}`}>
                {defLabel}
              </span>
            </div>
          </div>

          {/* Tug-of-war single bar */}
          <div className={styles.tugTrack}>
            {/* Attacker fill (left, green) */}
            <div
              className={`${styles.tugFillAtk} ${isProcessing ? styles.tugPulsing : ''}`}
              style={{ width: `${atkBarPct}%` }}
            />
            {/* Defender fill (right, red) — fills from right */}
            <div
              className={`${styles.tugFillDef} ${isProcessing ? styles.tugPulsing : ''}`}
              style={{ width: `${defBarPct}%` }}
            />
            {/* Center divider line */}
            <div className={styles.tugCenter} style={{ left: `${atkBarPct}%` }} />
          </div>

          {/* Loss tickers — always rendered to prevent layout shift */}
          <div className={styles.phaseLosses}>
            <span
              className={styles.atkLoss}
              style={{ visibility: !isProcessing && phaseIdx >= 0 && atkLoss > 0 ? 'visible' : 'hidden' }}
            >
              -{atkLoss.toLocaleString()}
            </span>
            <span
              className={styles.defLoss}
              style={{ visibility: !isProcessing && phaseIdx >= 0 && defLoss > 0 ? 'visible' : 'hidden' }}
            >
              -{defLoss.toLocaleString()}
            </span>
          </div>

          <span className={styles.phaseHint}>
            {isProcessing ? 'calculating…' : phaseIdx < 0 ? 'press BEGIN BATTLE' : 'next round incoming…'}
          </span>
        </div>
      </div>
    );
  }

  // ── Outcome ───────────────────────────────────────────────────────────────
  const finalAtk = battle.phases[phaseCount - 1]?.atk ?? 0;
  const finalDef = battle.phases[phaseCount - 1]?.def ?? 0;
  const isAttacker = myUid === battle.attackerUid;
  const iWon = (isAttacker && battle.attackerWon) || (!isAttacker && !battle.attackerWon);
  const winnerLabel = battle.attackerWon ? atkLabel : defLabel;
  // Grammar: "You WIN" (no -s for second person), "Player 2 WINS"
  const winVerb = (battle.attackerWon ? atkLabel : defLabel) === 'You' ? 'WIN!' : 'WINS!';
  const loserLabel = battle.attackerWon ? defLabel : atkLabel;
  const outcomeColor = battle.attackerWon ? styles.attackerColor : styles.defenderColor;

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <span className={styles.yearBadge}>YEAR {battle.year}</span>

        <div className={styles.outcomeBox}>
          <span className={styles.outcomeTitle}>⚔ BATTLE OVER</span>
          <span className={`${styles.outcomeWinner} ${outcomeColor}`}>
            {winnerLabel} {winVerb}
          </span>
          {iWon ? (
            <span className={styles.outcomeYou}>THE PLANET IS YOURS</span>
          ) : (
            <span className={styles.outcomeYou} style={{ color: 'rgba(255,255,255,0.3)' }}>YOU WERE DEFEATED</span>
          )}
        </div>

        <div className={styles.outcomeStats}>
          <div className={styles.outcomeStatsHeader}>STARTED → SURVIVED</div>
          <div className={styles.outcomeRow}>
            <span className={styles.attackerColor}>{atkLabel}</span>
            <span>{battle.attackerShips.toLocaleString()} → <strong>{finalAtk.toLocaleString()}</strong></span>
          </div>
          <div className={styles.outcomeRow}>
            <span className={styles.defenderColor}>{defLabel}</span>
            <span>{battle.defenderShips.toLocaleString()} → <strong>{finalDef.toLocaleString()}</strong></span>
          </div>
        </div>

        <button className={styles.dismissBtn} onClick={onDismiss}>
          [ DISMISS ]
        </button>
      </div>
    </div>
  );
}
