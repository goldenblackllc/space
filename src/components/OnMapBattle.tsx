'use client';

import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import type { BattleRecord, Planet } from '@/lib/types';
import soundManager from '@/lib/soundManager';
import styles from './OnMapBattle.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────
type CombatSubStage = 'reveal' | 'processing' | 'resolved';
type Stage = 'briefing' | 'combat' | 'outcome' | 'dismissing';

interface ScreenPt { x: number; y: number }

interface DamageFloat {
  id: string;
  x: number;
  y: number;
  label: string;
}

interface PixelSpark {
  id: string;
  x: number;
  y: number;
  color: string;
  dx: string;
  dy: string;
  rot: string;
}

interface Props {
  battle: BattleRecord;
  myUid: string;
  playerLabels: Record<string, string>;
  planets: Planet[];
  boardDims: { w: number; h: number; padTop: number; padBot: number };
  pt: { x: number; y: number } | null;
  onDismiss: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PHASE_INTERVAL_MS = 2000;
const PROCESSING_LABEL_MS = 1200;
const SPARKS_PER_HIT = 8;
const SPARK_SCATTER_R = 42;

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPARK_COLORS = [
  '#ff4422', '#ff6600', '#ff8800', '#ffaa00',
  '#ff2200', '#ff5533', '#ffcc00', '#ff3300',
];

function randomSpark(cx: number, cy: number): PixelSpark {
  const angle = Math.random() * Math.PI * 2;
  const dist = 6 + Math.random() * SPARK_SCATTER_R;
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist;
  const rot = (Math.random() * 180 - 90).toFixed(0) + 'deg';
  const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
  const jx = (Math.random() - 0.5) * 16;
  const jy = (Math.random() - 0.5) * 16;
  return {
    id: crypto.randomUUID(),
    x: cx + jx,
    y: cy + jy,
    color,
    dx: dx.toFixed(1) + 'px',
    dy: dy.toFixed(1) + 'px',
    rot,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function OnMapBattle({
  battle, myUid, playerLabels, pt, boardDims, planets, onDismiss,
}: Props) {
  const [stage, setStage] = useState<Stage>('briefing');
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const [subStage, setSubStage] = useState<CombatSubStage>('resolved');
  const [damageFloats, setDamageFloats] = useState<DamageFloat[]>([]);
  const [sparks, setSparks] = useState<PixelSpark[]>([]);

  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phaseCount = battle.phases.length;
  const atkLabel = playerLabels[battle.attackerUid] ?? 'Player';
  const defLabel = playerLabels[battle.defenderUid] ?? 'Player';

  // ── Derived ship counts ────────────────────────────────────────────────────
  const currentAtk = phaseIdx < 0 ? battle.attackerShips : (battle.phases[phaseIdx]?.atk ?? 0);
  const currentDef = phaseIdx < 0 ? battle.defenderShips : (battle.phases[phaseIdx]?.def ?? 0);
  const prevAtk = phaseIdx <= 0 ? battle.attackerShips : (battle.phases[phaseIdx - 1]?.atk ?? battle.attackerShips);
  const prevDef = phaseIdx <= 0 ? battle.defenderShips : (battle.phases[phaseIdx - 1]?.def ?? battle.defenderShips);

  const atkLoss = prevAtk - currentAtk;
  const defLoss = prevDef - currentDef;
  const phaseWinner: 'atk' | 'def' | null =
    phaseIdx < 0 ? null
    : defLoss > atkLoss ? 'atk'
    : atkLoss > defLoss ? 'def'
    : null;

  const totalStart = battle.attackerShips + battle.defenderShips;
  const atkBarPct = totalStart > 0 ? (currentAtk / totalStart) * 100 : 0;
  const defBarPct = totalStart > 0 ? (currentDef / totalStart) * 100 : 0;

  const { w: cW, h: cH } = boardDims;

  // Use passed pt only if coords are valid, otherwise fallback to center
  const defPt: ScreenPt = (pt && !isNaN(pt.x) && !isNaN(pt.y)) ? pt : { x: cW / 2, y: cH / 2 };

  // ── Spawn pixel explosion sparks on the defender planet ───────────────────
  const spawnSparks = useCallback((count: number) => {
    const newSparks = Array.from({ length: count }, () => randomSpark(defPt.x, defPt.y));
    setSparks((prev) => [...prev, ...newSparks]);
    const ids = newSparks.map((s) => s.id);
    setTimeout(() => {
      setSparks((prev) => prev.filter((s) => !ids.includes(s.id)));
    }, 700);
  }, [defPt.x, defPt.y]);

  // ── Damage float spawner ───────────────────────────────────────────────────
  const spawnDamage = useCallback((amount: number) => {
    if (amount <= 0) return;
    const id = crypto.randomUUID();
    const jitter = (Math.random() - 0.5) * 24;
    setDamageFloats((prev) => [
      ...prev,
      { id, x: defPt.x + jitter, y: defPt.y, label: `-${amount}` },
    ]);
    setTimeout(() => setDamageFloats((prev) => prev.filter((f) => f.id !== id)), 1700);
  }, [defPt.x, defPt.y]);

  // ── Phase sequencer ────────────────────────────────────────────────────────
  const advancePhase = useCallback((i: number) => {
    if (i >= phaseCount) {
      setTimeout(() => {
        soundManager.playExplosion();
        setStage('outcome');
      }, 400);
      return;
    }

    setSubStage('processing');

    phaseTimerRef.current = setTimeout(() => {
      setPhaseIdx(i);
      setSubStage('reveal');

      const ph = battle.phases[i];
      const prevAtkShips = i === 0 ? battle.attackerShips : (battle.phases[i - 1]?.atk ?? battle.attackerShips);
      const prevDefShips = i === 0 ? battle.defenderShips : (battle.phases[i - 1]?.def ?? battle.defenderShips);
      const dLoss = prevDefShips - ph.def;
      const aLoss = prevAtkShips - ph.atk;

      // Visual feedback — all centered on the defender planet
      if (dLoss > 0 || aLoss > 0) {
        soundManager.playLaser();
        // Scale spark count: at least SPARKS_PER_HIT, proportional to ships lost
        const totalLoss = dLoss + aLoss;
        const sparkCount = SPARKS_PER_HIT + Math.min(8, Math.floor(totalLoss / 3));
        spawnSparks(sparkCount);
      }
      if (dLoss > 0) spawnDamage(dLoss);
      if (aLoss > 0) spawnDamage(aLoss);

      phaseTimerRef.current = setTimeout(() => {
        setSubStage('resolved');
        phaseTimerRef.current = setTimeout(
          () => advancePhase(i + 1),
          PHASE_INTERVAL_MS - PROCESSING_LABEL_MS - 400,
        );
      }, 400);
    }, PROCESSING_LABEL_MS);
  }, [phaseCount, battle, spawnSparks, spawnDamage]);

  const startCombat = useCallback(() => {
    setStage('combat');
    setPhaseIdx(-1);
    setSubStage('resolved');
    advancePhase(0);
  }, [advancePhase]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, []);

  // ── Dismiss ────────────────────────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    setStage('dismissing');
    setTimeout(onDismiss, 380);
  }, [onDismiss]);

  // ── Outcome data ───────────────────────────────────────────────────────────
  const finalAtk = battle.phases[phaseCount - 1]?.atk ?? 0;
  const finalDef = battle.phases[phaseCount - 1]?.def ?? 0;
  const winnerLabel = battle.attackerWon ? atkLabel : defLabel;
  const winVerb = winnerLabel === 'You' ? 'WIN!' : 'WINS!';

  const isAttacker = myUid === battle.attackerUid;
  const iWon = (isAttacker && battle.attackerWon) || (!isAttacker && !battle.attackerWon);

  const isDismissing = stage === 'dismissing';
  const isProcessing = subStage === 'processing';

  const BANNER_W = 280;
  const GAP = 44;
  
  let motionLeftNum: number;
  let motionTop: number | string | undefined = undefined;
  let motionBottom: number | string | undefined = undefined;
  let tetherDir: 'up' | 'down' | null = null;

  if (cW > 0 && !isNaN(defPt.x)) {
    motionLeftNum = Math.max(8, Math.min(cW - BANNER_W - 8, defPt.x - BANNER_W / 2));
    if (!isNaN(defPt.y) && !isNaN(cH) && cH > 0) {
      if (defPt.y < cH / 2) {
        motionTop = defPt.y + GAP;
        tetherDir = 'up';
      } else {
        motionBottom = cH - defPt.y + GAP;
        tetherDir = 'down';
      }
    } else {
      motionTop = '40%';
    }
  } else {
    // Fallback: center the panel when boardDims haven't loaded
    motionLeftNum = 0;
    motionTop = '40%';
  }

  const motionLeft = cW > 0 ? `${motionLeftNum}px` : '50%';
  const motionTransform = cW > 0 ? 'translateX(0)' : 'translateX(-50%)';
  // calculate tether X relative to the modal to point directly at the planet center!
  const tetherLeft = cW > 0 ? `${Math.max(16, Math.min(BANNER_W - 16, defPt.x - motionLeftNum))}px` : '50%';

  const panelColor = stage === 'outcome' ? (iWon ? '#00ff88' : '#ff4444') : '#ffffff';

  return (
    <>
      {/* Visual Effects Layer (Sparks and Damage) */}
      {sparks.map((s) => (
        <div
          key={s.id}
          className={styles.pixelFlash}
          style={{
            left: s.x,
            top: s.y,
            background: s.color,
            '--dx': s.dx,
            '--dy': s.dy,
            '--rot': s.rot,
          } as React.CSSProperties}
        />
      ))}

      {damageFloats.map((f) => (
        <div
          key={f.id}
          className={styles.damageFloat}
          style={{ left: f.x, top: f.y }}
        >
          {f.label}
        </div>
      ))}

      {/* Unified Battle Panel */}
      {!isDismissing && (
        <div
          className={`${styles.battlePanel} ${
            stage === 'outcome' && !iWon ? styles.battlePanelLost : 
            stage === 'outcome' && iWon ? styles.battlePanelWon : ''
          }`}
          style={{
            left: motionLeft,
            ...(motionTop !== undefined ? { top: motionTop } : {}),
            ...(motionBottom !== undefined ? { bottom: motionBottom } : {}),
            transform: motionTransform,
            '--panel-color': panelColor,
          } as React.CSSProperties}
        >
          {tetherDir === 'down' && <div className={styles.tetherDown} style={{ left: tetherLeft, '--tether-color': panelColor } as React.CSSProperties} />}
          {tetherDir === 'up'   && <div className={styles.tetherUp} style={{ left: tetherLeft, '--tether-color': panelColor } as React.CSSProperties} />}
          
          {/* Briefing Stage */}
          {stage === 'briefing' && (
            <>
              <span className={styles.panelTitle}>&gt; BATTLE REPORT</span>
              <div className={styles.briefingBox}>
                <div className={styles.briefingSide}>
                  <span className={styles.briefingRole}>ATTACKER</span>
                  <span className={`${styles.briefingName} ${styles.atkColor}`}>{atkLabel}</span>
                  <span className={`${styles.briefingShips} ${styles.atkColor}`}>
                    {battle.attackerShips.toLocaleString()} SHIPS
                  </span>
                </div>
                <div className={styles.versus}>VS</div>
                <div className={styles.briefingSide}>
                  <span className={styles.briefingRole}>DEFENDER</span>
                  <span className={`${styles.briefingName} ${styles.defColor}`}>{defLabel}</span>
                  <span className={`${styles.briefingShips} ${styles.defColor}`}>
                    {battle.defenderShips.toLocaleString()} SHIPS
                  </span>
                </div>
              </div>
              <button className={styles.actionBtn} onClick={startCombat}>
                [ BEGIN BATTLE ]
              </button>
            </>
          )}

          {/* Combat Stage */}
          {stage === 'combat' && (
            <>
              <span className={styles.panelTitle}>
                {isProcessing
                  ? `> BATTLE · PROCESSING…`
                  : `> BATTLE · ROUND ${Math.max(1, phaseIdx + 1)}/${phaseCount}`}
              </span>

              <div className={styles.combatLabels}>
                <div className={styles.combatSide}>
                  <span className={`${styles.combatName} ${styles.atkColor}`}>
                    {atkLabel}
                  </span>
                  <span className={`${styles.combatCount} ${styles.atkColor}`}>
                    {currentAtk.toLocaleString()}
                  </span>
                </div>
                <div className={`${styles.combatSide} ${styles.combatSideRight}`}>
                  <span className={`${styles.combatName} ${styles.defColor}`}>
                    {defLabel}
                  </span>
                  <span className={`${styles.combatCount} ${styles.defColor}`}>
                    {currentDef.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className={styles.combatTrack}>
                <div
                  className={`${styles.combatFillAtk} ${isProcessing ? styles.combatPulsing : ''}`}
                  style={{ width: `${atkBarPct}%` }}
                />
                <div
                  className={`${styles.combatFillDef} ${isProcessing ? styles.combatPulsing : ''}`}
                  style={{ width: `${defBarPct}%` }}
                />
                <div className={styles.combatDivider} style={{ left: `${atkBarPct}%` }} />
              </div>

              <div className={styles.combatLosses}>
                <span
                  className={styles.combatLossAtk}
                  style={{ visibility: !isProcessing && phaseIdx >= 0 && atkLoss > 0 ? 'visible' : 'hidden' }}
                >
                  -{atkLoss}
                </span>
                <span
                  className={styles.combatLossDef}
                  style={{ visibility: !isProcessing && phaseIdx >= 0 && defLoss > 0 ? 'visible' : 'hidden' }}
                >
                  -{defLoss}
                </span>
              </div>
            </>
          )}

          {/* Outcome Stage */}
          {stage === 'outcome' && (
             <>
               <span className={styles.panelTitle}>&gt; BATTLE OVER</span>
     
               <span className={styles.outcomeWinner}>
                 {winnerLabel} {winVerb}
               </span>
     
               {iWon
                 ? <span className={styles.outcomeLine}>THE PLANET IS YOURS</span>
                 : <span className={styles.outcomeLine} style={{ opacity: 0.5 }}>YOU WERE DEFEATED</span>
               }
     
               {!iWon && !isAttacker && (
                 <span className={styles.outcomeLine}>&gt; PLANET LOST TO ENEMY</span>
               )}
               {!iWon && isAttacker && (
                 <span className={styles.outcomeLine}>&gt; INVASION FAILED</span>
               )}
               {iWon && !battle.attackerWon && (
                 <span className={styles.outcomeLine}>&gt; INVASION REPELLED</span>
               )}
     
               <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', marginTop: '6px' }}>
                 <span className={styles.outcomeStatHeader}>STARTED  →  SURVIVED</span>
                 <span className={styles.outcomeStat}>
                   <span className={styles.atkColor}>{atkLabel}</span>: {battle.attackerShips} → <strong>{finalAtk}</strong>
                 </span>
                 <span className={styles.outcomeStat}>
                   <span className={styles.defColor}>{defLabel}</span>: {battle.defenderShips} → <strong>{finalDef}</strong>
                 </span>
               </div>
     
               <button className={styles.actionBtn} onClick={handleDismiss} style={{ marginTop: '10px' }}>
                 [ DISMISS ]
               </button>
             </>
          )}

        </div>
      )}
    </>
  );
}
