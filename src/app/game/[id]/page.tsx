'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Canvas, { type FleetOrder } from '@/components/Canvas';
import OnMapBattle from '@/components/OnMapBattle';
import {
  subscribeGame,
  subscribePlanets,
  subscribeFleets,
  subscribePlayer,
  subscribePlayers,
  subscribeBattles,
  subscribeColonizations,
  subscribeReinforcements,
  markBattleViewed,
  markColonizationViewed,
  markReinforcementViewed,
} from '@/lib/firestore';
import { dispatchFleet, endPlayerTurn } from '@/lib/gameEngine';
import type { Game, Planet, Fleet, Player, BattleRecord, ColonizationRecord, ReinforcementRecord } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import soundManager from '@/lib/soundManager';
import AudioManager from '@/components/AudioManager';
import styles from './game.module.css';

const MODAL_W = 228;
const MODAL_H = 210;
const MODAL_OFFSET = 20;

// ── Arcade Event Types ────────────────────────────────────────────────────────
type ReportType = 'colonize' | 'battle-lost' | 'battle-offensive' | 'battle-defensive' | 'reinforce';

interface ReportEvent {
  id: string; // The Firestore doc ID
  planetId: string; // the Firestore planet document ID (used for spotlight + positioning)
  type: ReportType;
  px: number; // planet % x
  py: number; // planet % y
  ships: number;
  production: number;
  shipLoss?: number; // approximate damage for float numbers
  battleRec?: BattleRecord;
  colonizeRec?: ColonizationRecord;
  reinforceRec?: ReinforcementRecord;
}

interface FloatNum {
  id: string;
  px: number;
  py: number;
  label: string;
}

// ── Starfield ─────────────────────────────────────────────────────────────────
const STAR_COUNT = 200;
const TWINKLE_VARIANTS = ['a', 'b', 'c'] as const;

function seededRand(seed: number) {
  // Simple LCG — deterministic so memoised stars are stable
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

interface StarData {
  id: number; x: number; y: number; size: number;
  variant: typeof TWINKLE_VARIANTS[number];
  dur: string; delay: string;
}

function generateStars(): StarData[] {
  const rand = seededRand(42);
  return Array.from({ length: STAR_COUNT }, (_, i) => ({
    id: i,
    x: rand() * 100,
    y: rand() * 100,
    size: 0.8 + rand() * 1.6,           // 0.8 – 2.4 px
    variant: TWINKLE_VARIANTS[Math.floor(rand() * 3)],
    dur: `${(2.5 + rand() * 5).toFixed(2)}s`,    // 2.5 – 7.5s
    delay: `-${(rand() * 6).toFixed(2)}s`,        // negative = already mid-cycle
  }));
}

function Starfield() {
  const stars = useMemo(generateStars, []);
  return (
    <div className={styles.starfield} aria-hidden>
      {stars.map((s) => (
        <div
          key={s.id}
          className={styles.star}
          data-twinkle={s.variant}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            '--dur': s.dur,
            '--delay': s.delay,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
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

// Old ArcadeBanner logic removed, incorporated directly into Morning Report queue
// ── Main page ─────────────────────────────────────────────────────────────────
export default function GamePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [planets, setPlanets] = useState<Planet[]>([]);
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);

  // ── Map container ref (for on-map battle coordinate conversion) ───────────
  const [boardDims, setBoardDims] = useState({ w: 0, h: 0, padTop: 48, padBot: 96 });
  const roRef = useRef<ResizeObserver | null>(null);

  const mapContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el) return;

    const update = () => {
      const cs = window.getComputedStyle(el);
      setBoardDims({
        w: el.clientWidth || window.innerWidth,
        h: el.clientHeight || window.innerHeight,
        padTop: parseFloat(cs.paddingTop) || 48,
        padBot: parseFloat(cs.paddingBottom) || 96,
      });
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    roRef.current = ro;
    update(); // Initial synchronous measurement
  }, []);
  const [player, setPlayer] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  // ── Background Music ──────────────────────────────────────────────────────
  const [musicOn, setMusicOn] = useState(true);

  // ── Mobile viewport detection (SSR-safe) ─────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  function toggleMusic() {
    soundManager.unlock();
    setMusicOn(!musicOn);
  }

  // ── Tap-to-Target State ───────────────────────────────────────────────────
  const [origin, setOrigin] = useState<Planet | null>(null);
  const [target, setTarget] = useState<Planet | null>(null);
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const [modalShips, setModalShips] = useState(1);
  const [pendingOrders, setPendingOrders] = useState<FleetOrder[]>([]);

  // ── Battle Replay ─────────────────────────────────────────────────────────
  const [battles, setBattles] = useState<BattleRecord[]>([]);
  const [activeBattle, setActiveBattle] = useState<BattleRecord | null>(null);

  // ── Colonization Events ───────────────────────────────────────────────────
  const [colonizations, setColonizations] = useState<ColonizationRecord[]>([]);
  const [reinforcements, setReinforcements] = useState<ReinforcementRecord[]>([]);

  // Local optimistic dismissal state
  const [localDismissed, setLocalDismissed] = useState<string[]>([]);

  // ── Derived Local Planets ─────────────────────────────────────────────────
  // Start from official Firestore planets (post-production, no battle results).
  // Apply all events the player has already viewed to reconstruct the
  // player's current map state. Refresh-safe because viewedBy is in Firestore.
  const localPlanets = useMemo(() => {
    if (!user) return planets;
    const pMap = new Map(planets.map((p) => [p.id, { ...p }]));

    // Apply colonizations — viewed ones for any player, PLUS unviewed ones
    // belonging to this user (so the planet is visible while the modal shows).
    for (const col of colonizations) {
      if (col.appliedToMap) continue; // Already reflected in the official map
      const viewed = (col.viewedBy ?? []).includes(user.uid);
      const isMyColony = col.fleetOwnerUid === user.uid;
      if (viewed || isMyColony) {
        const p = pMap.get(col.planetId);
        if (p) {
          p.owner = col.fleetOwnerUid;
          p.ships = col.ships;
        }
      }
    }

    // Apply reinforcements — only after the user has dismissed the banner,
    // so the canvas shows pre-reinforcement count while the modal is visible.
    for (const r of reinforcements) {
      if (r.appliedToMap) continue;
      const viewed = (r.viewedBy ?? []).includes(user.uid);
      if (viewed) {
        const p = pMap.get(r.planetId);
        if (p) {
          p.ships += r.ships;
        }
      }
    }

    // Apply viewed battles
    for (const b of battles) {
      if (b.appliedToMap) continue; // Already reflected in the official map
      if ((b.viewedBy ?? []).includes(user.uid)) {
        const p = pMap.get(b.planetId);
        if (p) {
          if (b.attackerWon) {
            p.owner = b.attackerUid;
            p.ships = b.survivingAttackerShips;
          } else {
            p.ships = b.survivingDefenderShips;
          }
        }
      }
    }

    return Array.from(pMap.values());
  }, [planets, battles, colonizations, reinforcements, user]);

  // ── All unviewed events (reinforcements + colonizations + battles + defensive losses) ──────
  const allUnviewedReinforcements = useMemo(() => {
    if (!user) return [];
    return reinforcements.filter(
      (r) => r.fleetOwnerUid === user.uid && !(r.viewedBy ?? []).includes(user.uid)
    );
  }, [reinforcements, user]);

  const reinforceReportEvents: ReportEvent[] = useMemo(() => {
    return allUnviewedReinforcements.map((r) => {
      const p = planets.find((pl) => pl.id === r.planetId);
      return {
        id: r.id,
        planetId: r.planetId,
        type: 'reinforce' as ReportType,
        px: p?.x ?? 50,
        py: p?.y ?? 50,
        ships: r.ships,
        production: p?.productionBase ?? 0,
        reinforceRec: r,
      };
    });
  }, [allUnviewedReinforcements, planets]);

  const allUnviewedColonizations = useMemo(() => {
    if (!user) return [];
    return colonizations.filter(
      (c) => c.fleetOwnerUid === user.uid && !(c.viewedBy ?? []).includes(user.uid)
    );
  }, [colonizations, user]);

  // Build report event queue from unviewed colonizations
  const colonizeReportEvents: ReportEvent[] = useMemo(() => {
    return allUnviewedColonizations.map((c) => {
      const p = planets.find((pl) => pl.id === c.planetId);
      return {
        id: c.id,
        planetId: c.planetId,
        type: 'colonize' as ReportType,
        px: p?.x ?? 50,
        py: p?.y ?? 50,
        ships: c.ships,
        production: p?.productionBase ?? 0,
        colonizeRec: c,
      };
    });
  }, [allUnviewedColonizations, planets]);

  // Build report event queue from unviewed defensive battles
  const defensiveBattleReportEvents: ReportEvent[] = useMemo(() => {
    if (!user) return [];
    return battles
      .filter(
        (b) =>
          b.defenderUid === user.uid &&
          !(b.viewedBy ?? []).includes(user.uid)
      )
      .map((b) => {
        const p = planets.find((pl) => pl.id === b.planetId);
        return {
          id: b.id + '-defensive',
          planetId: b.planetId,
          type: 'battle-defensive' as ReportType,
          px: p?.x ?? 50,
          py: p?.y ?? 50,
          ships: b.survivingAttackerShips ?? 0,
          production: p?.productionBase ?? 0,
          shipLoss: b.defenderShips ?? 0,
          battleRec: b,
        };
      });
  }, [battles, planets, user]);

  // Build report event queue from offensive battles the user hasn't seen
  const offensiveBattleReportEvents: ReportEvent[] = useMemo(() => {
    if (!user) return [];
    return battles
      .filter(
        (b) =>
          b.attackerUid === user.uid &&
          !(b.viewedBy ?? []).includes(user.uid)
      )
      .map((b) => {
        const p = planets.find((pl) => pl.id === b.planetId);
        return {
          id: b.id + '-offensive',
          planetId: b.planetId,
          type: 'battle-offensive' as ReportType,
          px: p?.x ?? 50,
          py: p?.y ?? 50,
          ships: 0,
          production: 0,
          battleRec: b,
        };
      });
  }, [battles, planets, user]);


  // ── VFX State ──────────────────────────────────────────────────────────────
  const [flashEvents, setFlashEvents] = useState<{ id: string; px: number; py: number; color: string }[]>([]);
  const [floatNums, setFloatNums] = useState<FloatNum[]>([]);
  const [shardEvents, setShardEvents] = useState<{ id: string; px: number; py: number; color: string }[]>([]);

  // ── Error toast ───────────────────────────────────────────────────────────
  const [errorToast, setErrorToast] = useState('');
  function showToast(msg: string) {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(''), 3500);
  }

  // Keep a live ref to planets for coordinate lookups
  const planetsRef = useRef<Planet[]>([]);
  useEffect(() => { planetsRef.current = planets; }, [planets]);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  // Dismiss an arcade event: mark the underlying Firestore record as viewed
  function dismissArcade(evId: string) {
    if (!user || !game) return;
    // Check if this is a colonization event
    const colRec = colonizations.find((c) => c.id === evId);
    if (colRec) {
      markColonizationViewed(gameId, colRec.id, user.uid);
      return;
    }
    // Check if this is a battle-lost event (id ends with '-lost')
    const battleId = evId.replace(/-lost$/, '');
    const battleRec = battles.find((b) => b.id === battleId);
    if (battleRec) {
      markBattleViewed(gameId, battleRec.id, user.uid, [battleRec.attackerUid, battleRec.defenderUid]);
    }
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
    const jitter = (Math.random() - 0.5) * 4;
    setFloatNums((prev) => [...prev, { id, px: px + jitter, py, label }]);
    setTimeout(() => setFloatNums((prev) => prev.filter((f) => f.id !== id)), 2000);
  }

  // ── Sound: unlock AudioContext on first user gesture ────────────────────
  useEffect(() => {
    soundManager.initAutoUnlock();
  }, []);

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
      subscribeBattles(gameId, (allBattles) => {
        if (!user) return;
        // Keep all battles involving this player (viewed or not)
        // — viewedBy filtering is done in localPlanets derivation
        const mine = allBattles.filter(
          (b) => b.attackerUid === user.uid || b.defenderUid === user.uid
        );
        setBattles(mine);
      }),
      subscribeColonizations(gameId, setColonizations),
      subscribeReinforcements(gameId, setReinforcements),
      subscribePlayers(gameId, setAllPlayers),
    ];
    return () => unsubs.forEach((u) => u());
  }, [gameId, user]);

  const morningReportEvents = useMemo(() => {
    const result = [
      ...reinforceReportEvents,
      ...colonizeReportEvents,
      ...defensiveBattleReportEvents,
      ...offensiveBattleReportEvents,
    ].filter((ev) => !localDismissed.includes(ev.id));

    // Sort events so they are presented in the exact sequence they resolved
    result.sort((a, b) => {
      const seqA = a.battleRec?.sequence ?? a.colonizeRec?.sequence ?? a.reinforceRec?.sequence ?? 0;
      const seqB = b.battleRec?.sequence ?? b.colonizeRec?.sequence ?? b.reinforceRec?.sequence ?? 0;
      return seqA - seqB;
    });

    return result;
  }, [reinforceReportEvents, colonizeReportEvents, defensiveBattleReportEvents, offensiveBattleReportEvents, localDismissed]);



  // ── Selection helpers ─────────────────────────────────────────────────────
  function clearSelection() {
    setOrigin(null);
    setTarget(null);
    setModalShips(1);
  }

  function handlePlanetClick(planet: Planet, px: number, py: number) {
    if (iHaveEnded) {
      showToast('Waiting for other players to finish their turn.');
      return;
    }
    if (morningReportEvents.length > 0) {
      showToast('Dismiss pending events first.');
      return;
    }
    const hasUnresolvedBattles = battles.some((b) => 
      (b.attackerUid === user?.uid || b.defenderUid === user?.uid) &&
      !(b.viewedBy ?? []).includes(user?.uid ?? '')
    );
    if (hasUnresolvedBattles) {
      showToast('Resolve pending battles first.');
      return;
    }

    soundManager.playBlip();
    if (origin?.id === planet.id) { clearSelection(); return; }
    if (origin && planet.id !== origin.id) {
      setTarget(planet);
      const originPlanet = localPlanets.find((p) => p.id === origin.id);
      const alreadyQueuedForOrigin = pendingOrders
        .filter((o) => o.fromPlanetId === origin.id)
        .reduce((sum, o) => sum + o.ships, 0);
      const availableForOrigin = (originPlanet?.ships ?? 2) - alreadyQueuedForOrigin;
      setModalShips(Math.max(1, Math.floor(availableForOrigin / 2)));
      const viewW = window.innerWidth, viewH = window.innerHeight;
      let mx = px + MODAL_OFFSET, my = py - MODAL_H / 2;
      if (mx + MODAL_W > viewW - 16) mx = px - MODAL_W - MODAL_OFFSET;
      if (my < 60) my = 60;
      if (my + MODAL_H > viewH - 80) my = viewH - MODAL_H - 80;
      setModalPos({ x: mx, y: my });
      return;
    }
    if (planet.owner !== user?.uid) { showToast('Select one of your own planets first.'); return; }
    if (planet.ships < 1) { showToast('Not enough ships to send a fleet.'); return; }
    setOrigin(planet);
    setTarget(null);
  }

  function confirmOrder() {
    if (!origin || !target || modalShips < 1) return;
    const originPlanet = localPlanets.find((p) => p.id === origin.id);
    if (!originPlanet) return;
    const alreadyQueued = pendingOrders
      .filter((o) => o.fromPlanetId === origin.id)
      .reduce((sum, o) => sum + o.ships, 0);
    const availableShips = originPlanet.ships - alreadyQueued;
    if (modalShips > availableShips) {
      showToast('Not enough ships.');
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

    if (morningReportEvents.length > 0) {
      showToast('Dismiss pending events first.');
      return;
    }
    const hasUnresolvedBattles = battles.some((b) => 
      (b.attackerUid === user?.uid || b.defenderUid === user?.uid) &&
      !(b.viewedBy ?? []).includes(user?.uid ?? '')
    );
    if (hasUnresolvedBattles) {
      showToast('Resolve pending battles first.');
      return;
    }

    setBusy(true);
    for (const order of pendingOrders) {
      const from = localPlanets.find((p) => p.id === order.fromPlanetId);
      const to = localPlanets.find((p) => p.id === order.toPlanetId);
      if (!from || !to || from.ships <= 0) continue;
      await dispatchFleet(gameId, user!.uid, from, to, Math.min(order.ships, from.ships), game.currentYear);
    }
    setPendingOrders([]);
    clearSelection();
    await endPlayerTurn(gameId, user!.uid);
    setBusy(false);
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const myPlanets = useMemo(() => localPlanets.filter((p) => p.owner === user?.uid), [localPlanets, user]);
  const totalShips = useMemo(() => myPlanets.reduce((s, p) => s + p.ships, 0), [myPlanets]);
  const inTransit = useMemo(() => fleets.filter((f) => f.owner === user?.uid).length, [fleets, user]);
  const originPlanet = localPlanets.find((p) => p.id === origin?.id);
  const alreadyQueuedFromOrigin = pendingOrders
    .filter((o) => o.fromPlanetId === origin?.id)
    .reduce((sum, o) => sum + o.ships, 0);
  const maxShips = originPlanet ? originPlanet.ships - alreadyQueuedFromOrigin : 1;

  // Player display labels: current player = "You", others use their stored name
  const playerLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    (game?.players ?? []).forEach((uid, idx) => {
      if (uid === user?.uid) {
        labels[uid] = 'You';
      } else {
        const playerDoc = allPlayers.find((p) => p.uid === uid);
        labels[uid] = playerDoc?.name || `CMDR ${idx + 1}`;
      }
    });
    return labels;
  }, [game?.players, user?.uid, allPlayers]);

  // Turn readiness
  const iHaveEnded = !!(game?.turnEnded?.[user?.uid ?? '']);

  // The unviewed battles are now handled directly inside morningReportEvents.

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

  // ── Unified Spotlight ─────────────────────────────────────────────────
  // Priorities: The queue determines the order.
  const SPOTLIGHT_COLORS: Record<ReportType, string> = {
    'reinforce': '#44aaff',
    'colonize': '#00ff88',
    'battle-lost': '#aa44ff',
    'battle-offensive': '#ffffff', // Battles naturally use white spotlights
    'battle-defensive': '#ffffff',
  };
  const frontEvent = morningReportEvents[0] ?? null;
  const spotlightPlanetId = frontEvent?.planetId;
  const spotlightColor = frontEvent ? SPOTLIGHT_COLORS[frontEvent.type] : undefined;



  /**
   * Convert an event's planet percent coords to page-space pixel coords.
   */
  function evToPx(ev: ReportEvent): { x: number; y: number } | null {
    if (boardDims.w === 0) return null;
    const canvasH = boardDims.h - boardDims.padTop - boardDims.padBot;
    return {
      x: (ev.px / 100) * boardDims.w,
      y: boardDims.padTop + (ev.py / 100) * canvasH,
    };
  }

  return (
    <div className={`${styles.layout} ${shake ? styles.shake : ''}`}>
      {/* ── Background Stars ── */}
      <Starfield />

      {/* ── Galaxy Map ── */}
      <main ref={mapContainerRef} className={styles.board}>
        <Canvas
          planets={localPlanets}
          player={player}
          playerTotalShips={totalShips}
          origin={origin}
          target={target}
          pendingOrders={pendingOrders}
          spotlightPlanetId={spotlightPlanetId}
          spotlightColor={spotlightColor}
          onPlanetClick={handlePlanetClick}
          onOrderCancel={(id) => setPendingOrders((prev) => prev.filter((o) => o.id !== id))}
          className={styles.canvasWrap}
        />


        {/* The active, screen-takeover battle is now rendered below as part of the Morning Report queue */}

        {/* ── Spotlight Pulse Ring — for the current morning report event ── */}
        {(() => {
          const ev = morningReportEvents[0];
          if (!ev) return null;
          const pt = evToPx(ev);
          if (!pt) return null;
          const ringColor = SPOTLIGHT_COLORS[ev.type] ?? '#ffffff';
          return (
            <div
              key={`ring-${ev.id}`}
              className={styles.spotlightPulseRing}
              style={{ left: pt.x, top: pt.y, '--ring-color': ringColor } as React.CSSProperties}
            />
          );
        })()}
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

      {/* ── Arcade Banner / Morning Report Queue ── */}
      <AnimatePresence mode="wait">
        {(() => {
          const ev = morningReportEvents[0];
          if (!ev) return null;

          // Look up the live planet using the explicit planetId field on the event
          const livePlanet = planets.find((p) => p.id === ev.planetId);

          let px = livePlanet?.x ?? ev.px;
          let py = livePlanet?.y ?? ev.py;

          let pt: { x: number; y: number } | null = null;
          if (!isNaN(px) && !isNaN(py) && boardDims.w > 0) {
            const canvasH = boardDims.h - boardDims.padTop - boardDims.padBot;
            pt = {
              x: (px / 100) * boardDims.w,
              y: boardDims.padTop + (py / 100) * canvasH,
            };
          }

          if ((ev.type === 'battle-offensive' || ev.type === 'battle-defensive') && ev.battleRec && user) {
            return (
              <motion.div
                key={`wrapper-${ev.id}`}
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 25,
                  pointerEvents: 'none',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <OnMapBattle
                  battle={ev.battleRec}
                  myUid={user.uid}
                  playerLabels={playerLabels}
                  planets={planets}
                  pt={pt}
                  boardDims={boardDims}
                  onDismiss={() => {
                    soundManager.playBlip();
                    setLocalDismissed((prev) => [...prev, ev.id]);
                    markBattleViewed(
                      gameId,
                      ev.battleRec!.id,
                      user.uid,
                      [ev.battleRec!.attackerUid, ev.battleRec!.defenderUid]
                    ).catch(err => showToast(`Error: ${err.message}`));
                  }}
                />
              </motion.div>
            );
          }

          // For colonize and battle-lost:
          const BANNER_W = 260;
          const BANNER_H = 164; // Set to actual accurate modal dom height
          const GAP      = 48; // Standoff distance to clear labels and planet visual
          const HUD_H    = boardDims.padTop + 4;
          const evColor  = SPOTLIGHT_COLORS[ev.type] ?? '#ffffff';

          let motionLeft: number | string;
          let motionTop: number;
          let tetherDir: 'down' | 'up' | null = null;
          let tetherOffset: number | string = '50%';

          if (pt && boardDims.w > 0 && !isNaN(pt.x) && !isNaN(pt.y)) {
            motionLeft = Math.max(8, Math.min(boardDims.w - BANNER_W - 8, pt.x - BANNER_W / 2));
            tetherOffset = Math.max(16, Math.min(BANNER_W - 16, pt.x - (typeof motionLeft === 'number' ? motionLeft : 0)));
            const topIfAbove = pt.y - BANNER_H - GAP;
            if (topIfAbove >= HUD_H) {
              motionTop = topIfAbove;
              tetherDir = 'down';
            } else {
              motionTop = pt.y + GAP;
              tetherDir = 'up';
            }
          } else {
            motionLeft = '50%';
            motionTop  = 56;
          }

          return (
            <motion.div
              key={`wrapper-${ev.id}`}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 19,
                pointerEvents: 'none',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                style={{
                  position: 'absolute',
                  left: motionLeft,
                  top: motionTop,
                  transform: pt ? 'none' : 'translateX(-50%)',
                  zIndex: 20,
                  pointerEvents: 'auto',
                }}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {tetherDir === 'down' && <div className={styles.tetherDown} style={{ left: tetherOffset, '--tether-color': evColor } as React.CSSProperties} />}
                {tetherDir === 'up'   && <div className={styles.tetherUp} style={{ left: tetherOffset, '--tether-color': evColor } as React.CSSProperties} />}
                
              <div className={`${styles.arcadeBanner} ${
                ev.type === 'colonize' ? styles.arcadeBannerColonize :
                ev.type === 'reinforce' ? styles.arcadeBannerReinforce :
                styles.arcadeBannerBattleLost
              }`}>
                {ev.type === 'colonize' ? (
                  <>
                    <span className={styles.arcadeBannerLine}>&gt; PLANET SECURED</span>
                    <span className={styles.arcadeBannerLine}>  NEW COLONY ESTABLISHED</span>
                    <span className={styles.arcadeBannerLine}>  {ev.ships} SHIPS STATIONED</span>
                    <span className={styles.arcadeBannerLine}>  PRODUCTION: +{ev.production}/YR</span>
                  </>
                ) : ev.type === 'reinforce' ? (
                  <>
                    <span className={styles.arcadeBannerLine}>&gt; FLEET ARRIVED</span>
                    <span className={styles.arcadeBannerLine}>  REINFORCEMENTS SECURED</span>
                    <span className={styles.arcadeBannerLine}>  +{ev.ships} SHIPS STATIONED</span>
                    <span className={styles.arcadeBannerLine}>  TOTAL: {(localPlanets.find((p) => p.id === ev.planetId)?.ships ?? 0) + ev.ships} SHIPS</span>
                  </>
                ) : (
                  <>
                    <span className={styles.arcadeBannerLine}>&gt; PLANET LOST TO ENEMY</span>
                    <span className={styles.arcadeBannerLine}>  DEFENSES OVERWHELMED</span>
                    <span className={styles.arcadeBannerLine}>  -{ev.shipLoss ?? 0} SHIPS LOST</span>
                    <span className={styles.arcadeBannerLine}>  {ev.ships ?? 0} ENEMY SHIPS SECURED</span>
                  </>
                )}
                
                <button
                  className={styles.arcadeBannerDismiss}
                  onClick={() => {
                    soundManager.playBlip();
                    // Optimistically hide the banner instantly
                    setLocalDismissed((prev) => [...prev, ev.id]);
                    
                    // Mark underlying document as viewed to clear it from the queue
                    if (ev.type === 'colonize' && ev.colonizeRec) {
                      markColonizationViewed(gameId, ev.colonizeRec.id, user?.uid ?? '')
                        .catch(err => showToast(`Error: ${err.message}`));
                    } else if (ev.type === 'reinforce' && ev.reinforceRec) {
                      markReinforcementViewed(gameId, ev.reinforceRec.id, user?.uid ?? '')
                        .catch(err => showToast(`Error: ${err.message}`));
                    } else if (ev.type === 'battle-lost' && ev.battleRec) {
                      markBattleViewed(
                        gameId,
                        ev.battleRec.id,
                        user?.uid ?? '',
                        [ev.battleRec.attackerUid, ev.battleRec.defenderUid]
                      ).catch(err => showToast(`Error: ${err.message}`));
                    }
                  }}
                >
                  [ DISMISS ]
                </button>
              </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Audio Manager ── */}
      <AudioManager
        gameState="map"
        activeBattle={!!frontEvent && frontEvent.type.startsWith('battle')}
        colonizedEventId={frontEvent?.type === 'colonize' ? frontEvent.id : null}
        musicOn={musicOn}
      />

      {/* ── Top HUD ── */}
      <header className={styles.topHud}>
        {/* Row 1: logo (left) + music toggle (right) */}
        <div className={styles.hudRow1}>
          <span className={styles.hudLogo}>SPACE</span>
          <button
            id="music-toggle-btn"
            className={`${styles.musicToggle} ${musicOn ? styles.musicToggleOn : ''}`}
            onClick={toggleMusic}
            aria-label={musicOn ? 'Pause background music' : 'Play background music'}
          >
            [ MUSIC: {musicOn ? 'ON' : 'OFF'} ]
          </button>
        </div>
        {/* Row 2: stats (left) + hint (right, hidden on mobile) */}
        <div className={styles.hudRow2}>
          <div className={styles.hudStats}>
            <div className={styles.hudStat}>
              <span className={styles.hudStatLabel}>Year</span>
              <span className={styles.hudStatLabelShort}>YR</span>
              <span className={styles.hudStatValue}>{game.currentYear}</span>
            </div>
            <div className={styles.hudStat}>
              <span className={styles.hudStatLabel}>Planets</span>
              <span className={styles.hudStatLabelShort}>PL</span>
              <span className={styles.hudStatValue}>{myPlanets.length}</span>
            </div>
            <div className={styles.hudStat}>
              <span className={styles.hudStatLabel}>Ships</span>
              <span className={styles.hudStatLabelShort}>SH</span>
              <span className={styles.hudStatValue}>{totalShips}</span>
            </div>
            <div className={styles.hudStat}>
              <span className={styles.hudStatLabel}>In Transit</span>
              <span className={styles.hudStatLabelShort}>TR</span>
              <span className={styles.hudStatValue}>{inTransit}</span>
            </div>
          </div>
          <span className={styles.hudHint}>{hudHint}</span>
        </div>
      </header>

      {/* ── Ship Dispatch Modal ── */}
      <AnimatePresence>
        {origin && target && (
          <motion.div
            key="modal"
            className={styles.modal}
            style={isMobile ? undefined : { left: modalPos.x, top: modalPos.y }}
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
              <button className={styles.modalConfirm} onClick={() => { soundManager.playBlip(); confirmOrder(); }} disabled={modalShips < 1 || modalShips > maxShips}>
                Confirm
              </button>
              <button className={styles.modalCancel} onClick={() => { soundManager.playBlip(); clearSelection(); }}>Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FAB End Turn / Resolve Battles state machine ── */}
      {morningReportEvents.length === 0 && <button
        id="end-turn-btn"
        className={styles.fab}
        onClick={() => {
          if (iHaveEnded) {
            const allDone = game?.players.every((pid) => game.turnEnded[pid]);
            if (allDone && game?.id && user?.uid) {
              showToast('Attempting to force-resume turn...');
              endPlayerTurn(game.id, user.uid).catch((err) => showToast(err.message));
            }
          } else {
            handleEndTurn();
          }
        }}
        disabled={busy || (iHaveEnded && !(game?.players.every((pid) => game.turnEnded[pid])))}
      >
        {busy ? 'Processing' : iHaveEnded ? 'Waiting…' : 'End Turn'}
        {pendingOrders.length > 0 && !busy && !iHaveEnded && (
          <span className={styles.fabBadge}>{pendingOrders.length}</span>
        )}
      </button>}

      {/* ── Share (Copy Invite Code) ── */}
      {game.inviteCode && (
        <button
          id="copy-code-btn"
          className={styles.shareLink}
          onClick={() => {
            soundManager.playBlip();
            navigator.clipboard.writeText(game.inviteCode).then(() => {
              showToast('SECTOR CODE COPIED!');
            }).catch(() => {
              showToast(game.inviteCode); // fallback: just show the code
            });
          }}
        >
          [⎘] {game.inviteCode}
        </button>
      )}

      {/* ── Lobby link ── */}
      <button id="leave-game-btn" className={styles.lobbyLink} onClick={() => { soundManager.playBlip(); router.push('/lobby'); }}>
        [&lt;] LOBBY
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

      {/* ── Game Over Overlay ── */}
      <AnimatePresence>
        {game.status === 'ended' && morningReportEvents.length === 0 && (
          <motion.div
            key="game-over"
            className={styles.gameOverOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className={`${styles.gameOverBox} ${game.winnerUid === user?.uid ? styles.gameOverBoxWon : ''}`}>
              <h1 className={`${styles.gameOverTitle} ${game.winnerUid === user?.uid ? styles.gameOverTitleWon : ''}`}>
                {game.winnerUid === user?.uid ? 'YOU WIN!' : `${playerLabels[game.winnerUid ?? ''] ?? 'PLAYER'} WINS!`}
              </h1>
              <p className={styles.gameOverSubtitle}>
                {game.winnerUid === user?.uid 
                  ? 'GALAXY SECURED UNDER YOUR COMMAND' 
                  : 'GALAXY LOST TO ENEMY FORCES'}
              </p>
              <button 
                className={styles.gameOverBtn}
                onClick={() => {
                  soundManager.playBlip();
                  router.push('/lobby');
                }}
              >
                [ RETURN TO LOBBY ]
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* OnMapBattle is now rendered inside .board — see above */}
    </div>
  );
}

function sortedPlanetIdx(planets: Planet[], id: string) {
  const sorted = [...planets].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.id);
  return sorted.indexOf(id) + 1;
}
