'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Canvas, { type FleetOrder } from '@/components/Canvas';
import {
  subscribeGame,
  subscribePlanets,
  subscribeFleets,
  subscribePlayer,
} from '@/lib/firestore';
import { dispatchFleet, advanceTurn } from '@/lib/gameEngine';
import type { Game, Planet, Fleet, Player } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './game.module.css';

const MODAL_W = 228;
const MODAL_H = 210;
const MODAL_OFFSET = 20;

// ── Arcade Event Types ────────────────────────────────────────────────────────
type ArcadeType = 'colonize' | 'battle-won' | 'battle-lost';

interface ArcadeEvent {
  id: string;
  type: ArcadeType;
  px: number; // planet % x
  py: number; // planet % y
  ships: number;
  production: number;
  shipLoss?: number; // approximate damage for float numbers
}

interface FloatNum {
  id: string;
  px: number;
  py: number;
  label: string;
}

// ── Shard SVG helper ─────────────────────────────────────────────────────────
function ShardBurst({ color }: { color: string }) {
  const angles = [0, 40, 80, 130, 170, 220, 270, 310];
  const r1 = 20, r2 = 55;
  return (
    <svg viewBox="-60 -60 120 120" width="120" height="120">
      {angles.map((a, i) => {
        const rad = (a * Math.PI) / 180;
        const rad2 = ((a + 15) * Math.PI) / 180;
        const x1 = Math.cos(rad) * r1; const y1 = Math.sin(rad) * r1;
        const x2 = Math.cos(rad) * r2; const y2 = Math.sin(rad) * r2;
        const x3 = Math.cos(rad2) * (r2 * 0.7); const y3 = Math.sin(rad2) * (r2 * 0.7);
        return (
          <polygon
            key={i}
            points={`${x1},${y1} ${x2},${y2} ${x3},${y3}`}
            fill={color}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

// ── Arcade Banner component ───────────────────────────────────────────────────
function ArcadeBanner({ ev, onDismiss }: { ev: ArcadeEvent; onDismiss: () => void }) {
  const isCol = ev.type === 'colonize';
  const isWon = ev.type === 'battle-won';
  const bannerClass = isCol
    ? styles.arcadeBannerColonize
    : isWon
    ? styles.arcadeBannerBattleWon
    : styles.arcadeBannerBattleLost;

  return (
    <div className={`${styles.arcadeBanner} ${bannerClass}`}>
      {isCol && (
        <>
          <span className={styles.arcadeBannerLine}>&gt; PLANET SECURED</span>
          <span className={styles.arcadeBannerLine}>  NEW COLONY ESTABLISHED</span>
          <span className={styles.arcadeBannerLine}>  {ev.ships} SHIPS STATIONED</span>
          <span className={styles.arcadeBannerLine}>  PRODUCTION: +{ev.production}/YR</span>
        </>
      )}
      {isWon && (
        <>
          <span className={styles.arcadeBannerLine}>&gt; PLANET CONQUERED</span>
          <span className={styles.arcadeBannerLine}>  ENEMY DEFENSE SHATTERED</span>
          <span className={styles.arcadeBannerLine}>  {ev.ships} SHIPS LANDED</span>
          <span className={styles.arcadeBannerLine}>  PRODUCTION: +{ev.production}/YR</span>
        </>
      )}
      {ev.type === 'battle-lost' && (
        <>
          <span className={styles.arcadeBannerLine}>&gt; INVASION REPELLED</span>
          <span className={styles.arcadeBannerLine}>  PLANET LOST TO ENEMY</span>
          {ev.shipLoss !== undefined && (
            <span className={styles.arcadeBannerLine}>  -{ev.shipLoss} SHIPS LOST</span>
          )}
        </>
      )}
      <button className={styles.arcadeBannerDismiss} onClick={onDismiss}>
        [ DISMISS ]
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GamePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [planets, setPlanets] = useState<Planet[]>([]);
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  // ── Tap-to-Target State ───────────────────────────────────────────────────
  const [origin, setOrigin] = useState<Planet | null>(null);
  const [target, setTarget] = useState<Planet | null>(null);
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const [modalShips, setModalShips] = useState(1);
  const [pendingOrders, setPendingOrders] = useState<FleetOrder[]>([]);

  // ── Arcade Events ─────────────────────────────────────────────────────────
  const [arcadeEvents, setArcadeEvents] = useState<ArcadeEvent[]>([]);
  const [flashEvents, setFlashEvents] = useState<{ id: string; px: number; py: number; color: string }[]>([]);
  const [floatNums, setFloatNums] = useState<FloatNum[]>([]);
  const [shardEvents, setShardEvents] = useState<{ id: string; px: number; py: number; color: string }[]>([]);

  // ── Error toast ───────────────────────────────────────────────────────────
  const [errorToast, setErrorToast] = useState('');
  function showToast(msg: string) {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(''), 3500);
  }

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  function dismissArcade(id: string) {
    setArcadeEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function spawnFlash(px: number, py: number, color: string) {
    const id = crypto.randomUUID();
    setFlashEvents((prev) => [...prev, { id, px, py, color }]);
    setTimeout(() => setFlashEvents((prev) => prev.filter((f) => f.id !== id)), 800);
  }

  function spawnShard(px: number, py: number, color: string) {
    const id = crypto.randomUUID();
    setShardEvents((prev) => [...prev, { id, px, py, color }]);
    setTimeout(() => setShardEvents((prev) => prev.filter((s) => s.id !== id)), 900);
  }

  function spawnFloatNum(px: number, py: number, label: string) {
    const id = crypto.randomUUID();
    // Slight horizontal jitter
    const jitter = (Math.random() - 0.5) * 4;
    setFloatNums((prev) => [...prev, { id, px: px + jitter, py, label }]);
    setTimeout(() => setFloatNums((prev) => prev.filter((f) => f.id !== id)), 2000);
  }

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // ── Firestore subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || !user) return;
    const unsubs = [
      subscribeGame(gameId, setGame),
      subscribePlanets(gameId, setPlanets),
      subscribeFleets(gameId, setFleets),
      subscribePlayer(gameId, user.uid, setPlayer),
    ];
    return () => unsubs.forEach((u) => u());
  }, [gameId, user]);

  // ── Colonization & Battle detection ──────────────────────────────────────
  const prevPlanetsRef = useRef<Planet[]>([]);
  useEffect(() => {
    if (!user || prevPlanetsRef.current.length === 0) {
      prevPlanetsRef.current = planets;
      return;
    }
    const prevMap = new Map(prevPlanetsRef.current.map((p) => [p.id, { owner: p.owner, ships: p.ships }]));
    const newArcade: ArcadeEvent[] = [];

    for (const planet of planets) {
      const prev = prevMap.get(planet.id);
      if (!prev) continue;

      // Colonization: was neutral, now mine
      if (prev.owner === null && planet.owner === user.uid) {
        const ev: ArcadeEvent = {
          id: planet.id + '-col-' + Date.now(),
          type: 'colonize',
          px: planet.x, py: planet.y,
          ships: planet.ships,
          production: planet.productionBase ?? 0,
        };
        newArcade.push(ev);
        spawnFlash(planet.x, planet.y, '#00ff88');
      }

      // Battle won: was enemy's, now mine
      if (prev.owner !== null && prev.owner !== user.uid && planet.owner === user.uid) {
        const ev: ArcadeEvent = {
          id: planet.id + '-won-' + Date.now(),
          type: 'battle-won',
          px: planet.x, py: planet.y,
          ships: planet.ships,
          production: planet.productionBase ?? 0,
        };
        newArcade.push(ev);
        spawnFlash(planet.x, planet.y, '#ff6600');
        setTimeout(() => spawnShard(planet.x, planet.y, '#ff9944'), 150);
        spawnFloatNum(planet.x, planet.y, `CONQUERED`);
        triggerShake();
      }

      // Battle lost: was mine, now someone else's
      if (prev.owner === user.uid && planet.owner !== user.uid) {
        const shipLoss = Math.max(0, prev.ships - planet.ships);
        const ev: ArcadeEvent = {
          id: planet.id + '-lost-' + Date.now(),
          type: 'battle-lost',
          px: planet.x, py: planet.y,
          ships: planet.ships,
          production: planet.productionBase ?? 0,
          shipLoss,
        };
        newArcade.push(ev);
        spawnFlash(planet.x, planet.y, '#aa44ff');
        if (shipLoss > 0) spawnFloatNum(planet.x, planet.y, `-${shipLoss}`);
        triggerShake();
      }
    }

    if (newArcade.length > 0) setArcadeEvents((prev) => [...prev, ...newArcade]);
    prevPlanetsRef.current = planets;
  }, [planets, user]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  function clearSelection() {
    setOrigin(null);
    setTarget(null);
    setModalShips(1);
  }

  function handlePlanetClick(planet: Planet, px: number, py: number) {
    if (origin?.id === planet.id) { clearSelection(); return; }
    if (origin && planet.id !== origin.id) {
      setTarget(planet);
      const originPlanet = planets.find((p) => p.id === origin.id);
      setModalShips(Math.max(1, Math.floor((originPlanet?.ships ?? 2) / 2)));
      const viewW = window.innerWidth, viewH = window.innerHeight;
      let mx = px + MODAL_OFFSET, my = py - MODAL_H / 2;
      if (mx + MODAL_W > viewW - 16) mx = px - MODAL_W - MODAL_OFFSET;
      if (my < 60) my = 60;
      if (my + MODAL_H > viewH - 80) my = viewH - MODAL_H - 80;
      setModalPos({ x: mx, y: my });
      return;
    }
    if (planet.owner !== user?.uid) { showToast('Select one of your own planets first.'); return; }
    if (planet.ships < 2) { showToast('Not enough ships to send a fleet.'); return; }
    setOrigin(planet);
    setTarget(null);
  }

  function confirmOrder() {
    if (!origin || !target || modalShips < 1) return;
    const originPlanet = planets.find((p) => p.id === origin.id);
    if (!originPlanet || modalShips >= originPlanet.ships) {
      showToast('Must keep at least 1 ship at the source planet.');
      return;
    }
    setPendingOrders((prev) => [...prev, {
      id: crypto.randomUUID(),
      fromPlanetId: origin.id,
      toPlanetId: target.id,
      ships: modalShips,
    }]);
    clearSelection();
  }

  async function handleEndTurn() {
    if (!game || busy) return;
    setBusy(true);
    for (const order of pendingOrders) {
      const from = planets.find((p) => p.id === order.fromPlanetId);
      const to = planets.find((p) => p.id === order.toPlanetId);
      if (!from || !to || from.ships <= 1) continue;
      await dispatchFleet(gameId, user!.uid, from, to, Math.min(order.ships, from.ships - 1), game.currentYear);
    }
    setPendingOrders([]);
    await advanceTurn(gameId, game.currentYear);
    setBusy(false);
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const myPlanets = useMemo(() => planets.filter((p) => p.owner === user?.uid), [planets, user]);
  const totalShips = useMemo(() => myPlanets.reduce((s, p) => s + p.ships, 0), [myPlanets]);
  const inTransit = useMemo(() => fleets.filter((f) => f.owner === user?.uid).length, [fleets, user]);
  const originPlanet = planets.find((p) => p.id === origin?.id);
  const maxShips = originPlanet ? originPlanet.ships - 1 : 1;

  if (!game) return (
    <div className={styles.loading}><div className={styles.spinner} /><span>Loading</span></div>
  );

  const hudHint = origin
    ? (target ? 'Set ships and confirm' : 'Tap destination planet')
    : pendingOrders.length > 0
    ? `${pendingOrders.length} order${pendingOrders.length !== 1 ? 's' : ''} queued`
    : 'Tap a planet you own';

  // Active arcade banner to show (one at a time, stacked in center)
  // We show all banners, each dismissed independently
  const hasBanner = arcadeEvents.length > 0;

  return (
    <div className={`${styles.layout} ${shake ? styles.shake : ''}`}>
      {/* ── Galaxy Map ── */}
      <main className={styles.board}>
        <Canvas
          planets={planets}
          player={player}
          origin={origin}
          target={target}
          pendingOrders={pendingOrders}
          onPlanetClick={handlePlanetClick}
        />
      </main>

      {/* ── Action Layer ── */}
      <div className={styles.actionLayer}>
        {/* Planet flash rings */}
        {flashEvents.map((f) => (
          <div
            key={f.id}
            className={styles.planetFlash}
            style={{
              left: `${f.px}%`,
              top: `${f.py}%`,
              background: `radial-gradient(circle, ${f.color}cc 0%, ${f.color}44 60%, transparent 100%)`,
            }}
          />
        ))}

        {/* Shard bursts (battle won) */}
        {shardEvents.map((s) => (
          <div
            key={s.id}
            className={styles.shardBurst}
            style={{ left: `${s.px}%`, top: `${s.py}%` }}
          >
            <ShardBurst color={s.color} />
          </div>
        ))}

        {/* Floating numbers */}
        {floatNums.map((f) => (
          <div
            key={f.id}
            className={styles.floatNum}
            style={{ left: `${f.px}%`, top: `${f.py}%` }}
          >
            {f.label}
          </div>
        ))}
      </div>

      {/* ── Arcade Banners (stacked below HUD) ── */}
      <AnimatePresence>
        {arcadeEvents.map((ev, i) => (
          <motion.div
            key={ev.id}
            style={{ position: 'absolute', left: '50%', top: 56 + i * 8, zIndex: 20, pointerEvents: 'auto' }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <ArcadeBanner ev={ev} onDismiss={() => dismissArcade(ev.id)} />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── Top HUD ── */}
      <header className={styles.topHud}>
        <span className={styles.hudLogo}>SPACE</span>
        <div className={styles.hudStats}>
          <div className={styles.hudStat}>
            <span className={styles.hudStatLabel}>Year</span>
            <span className={styles.hudStatValue}>{game.currentYear}</span>
          </div>
          <div className={styles.hudStat}>
            <span className={styles.hudStatLabel}>Planets</span>
            <span className={styles.hudStatValue}>{myPlanets.length}</span>
          </div>
          <div className={styles.hudStat}>
            <span className={styles.hudStatLabel}>Ships</span>
            <span className={styles.hudStatValue}>{totalShips}</span>
          </div>
          <div className={styles.hudStat}>
            <span className={styles.hudStatLabel}>In Transit</span>
            <span className={styles.hudStatValue}>{inTransit}</span>
          </div>
        </div>
        <span className={styles.hudHint}>{hudHint}</span>
      </header>

      {/* ── Ship Dispatch Modal ── */}
      <AnimatePresence>
        {origin && target && (
          <motion.div
            key="modal"
            className={styles.modal}
            style={{ left: modalPos.x, top: modalPos.y }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
          >
            <span className={styles.modalTitle}>
              Fleet · #{sortedPlanetIdx(planets, origin.id)} → #{sortedPlanetIdx(planets, target.id)}
            </span>
            <div>
              <div className={styles.modalShipCount}>{modalShips}</div>
              <div className={styles.modalShipCountSub}>ships / {maxShips} available</div>
            </div>
            <input
              className={styles.modalSlider}
              type="range"
              min={1}
              max={Math.max(1, maxShips)}
              value={modalShips}
              onChange={(e) => setModalShips(Number(e.target.value))}
            />
            <div className={styles.modalActions}>
              <button className={styles.modalConfirm} onClick={confirmOrder} disabled={modalShips < 1 || modalShips > maxShips}>
                Confirm
              </button>
              <button className={styles.modalCancel} onClick={clearSelection}>Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FAB End Turn ── */}
      <button id="end-turn-btn" className={styles.fab} onClick={handleEndTurn} disabled={busy}>
        {busy ? 'Processing' : 'End Turn'}
        {pendingOrders.length > 0 && !busy && (
          <span className={styles.fabBadge}>{pendingOrders.length}</span>
        )}
      </button>

      {/* ── Lobby link ── */}
      <button id="leave-game-btn" className={styles.lobbyLink} onClick={() => router.push('/lobby')}>
        ← Lobby
      </button>

      {/* ── Error toast ── */}
      <AnimatePresence>
        {errorToast && (
          <motion.div key="err" className={styles.toast}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {errorToast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function sortedPlanetIdx(planets: Planet[], id: string) {
  const sorted = [...planets].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.id);
  return sorted.indexOf(id) + 1;
}
