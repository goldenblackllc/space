'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
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

// How far outside the viewport to flip the modal anchor
const MODAL_W = 228;
const MODAL_H = 210;
const MODAL_OFFSET = 20; // px gap from planet

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

  // ── Toast queue ───────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<string[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function queueToast(msg: string) {
    setToasts((prev) => [...prev, msg]);
  }

  // Show each toast for 3s then shift to next
  useEffect(() => {
    if (toasts.length === 0) return;
    if (toastTimer.current) return; // already running
    toastTimer.current = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
      toastTimer.current = null;
    }, 3000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = null;
    };
  }, [toasts]);

  // ── Tap-to-Target State ───────────────────────────────────────────────
  const [origin, setOrigin] = useState<Planet | null>(null);
  const [target, setTarget] = useState<Planet | null>(null);
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 }); // pixel on canvas
  const [modalShips, setModalShips] = useState(1);
  const [pendingOrders, setPendingOrders] = useState<FleetOrder[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

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

  // ── Colonization detection ─────────────────────────────────────────────
  const prevPlanetsRef = useRef<Planet[]>([]);
  useEffect(() => {
    if (!user || prevPlanetsRef.current.length === 0) {
      prevPlanetsRef.current = planets;
      return;
    }
    const prevMap = new Map(prevPlanetsRef.current.map((p) => [p.id, p.owner]));
    for (const planet of planets) {
      const wasOwner = prevMap.get(planet.id);
      if (wasOwner === null && planet.owner === user.uid) {
        // Neutral → colonized by us
        queueToast(`Planet colonized`);
      }
    }
    prevPlanetsRef.current = planets;
  }, [planets, user]);

  // Legacy single-toast helper (for validation errors)
  const [errorToast, setErrorToast] = useState('');
  function showToast(msg: string) {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(''), 3500);
  }

  function clearSelection() {
    setOrigin(null);
    setTarget(null);
    setModalShips(1);
  }

  // ── Planet click handler ──────────────────────────────────────────────
  function handlePlanetClick(planet: Planet, px: number, py: number) {
    // If tapping the same origin again → deselect
    if (origin?.id === planet.id) {
      clearSelection();
      return;
    }

    // If we have an origin and this is a DIFFERENT planet → set target + show modal
    if (origin && planet.id !== origin.id) {
      setTarget(planet);
      // Default to half of origin ships (at least 1)
      const originPlanet = planets.find((p) => p.id === origin.id);
      const half = Math.max(1, Math.floor((originPlanet?.ships ?? 2) / 2));
      setModalShips(half);

      // Compute modal position, flipping to stay on screen
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      let mx = px + MODAL_OFFSET;
      let my = py - MODAL_H / 2;
      if (mx + MODAL_W > viewW - 16) mx = px - MODAL_W - MODAL_OFFSET;
      if (my < 60) my = 60;
      if (my + MODAL_H > viewH - 80) my = viewH - MODAL_H - 80;
      setModalPos({ x: mx, y: my });
      return;
    }

    // No origin yet → must be own planet
    if (planet.owner !== user?.uid) {
      showToast('Select one of your own planets first.');
      return;
    }
    if (planet.ships < 2) {
      showToast('Not enough ships to send a fleet.');
      return;
    }

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

    setPendingOrders((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        fromPlanetId: origin.id,
        toPlanetId: target.id,
        ships: modalShips,
      },
    ]);

    clearSelection();
  }

  async function handleEndTurn() {
    if (!game || busy) return;
    setBusy(true);

    // Dispatch all pending orders first
    for (const order of pendingOrders) {
      const from = planets.find((p) => p.id === order.fromPlanetId);
      const to = planets.find((p) => p.id === order.toPlanetId);
      if (!from || !to || from.ships <= 1) continue;
      const ships = Math.min(order.ships, from.ships - 1);
      await dispatchFleet(gameId, user!.uid, from, to, ships, game.currentYear);
    }
    setPendingOrders([]);

    await advanceTurn(gameId, game.currentYear);
    setBusy(false);
  }

  // ── Derived stats ─────────────────────────────────────────────────────
  const myPlanets = useMemo(() => planets.filter((p) => p.owner === user?.uid), [planets, user]);
  const totalShips = useMemo(() => myPlanets.reduce((s, p) => s + p.ships, 0), [myPlanets]);
  const inTransit = useMemo(() => fleets.filter((f) => f.owner === user?.uid).length, [fleets, user]);

  // Max ships the user can send (origin.ships - 1)
  const originPlanet = planets.find((p) => p.id === origin?.id);
  const maxShips = originPlanet ? originPlanet.ships - 1 : 1;

  if (!game) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Loading</span>
      </div>
    );
  }

  // Dynamic HUD hint
  const hudHint = origin
    ? target
      ? 'Set ships and confirm'
      : 'Tap destination planet'
    : pendingOrders.length > 0
    ? `${pendingOrders.length} order${pendingOrders.length !== 1 ? 's' : ''} queued`
    : 'Tap a planet you own';

  return (
    <div className={styles.layout}>
      {/* ── Board ── */}
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
              <button
                className={styles.modalConfirm}
                onClick={confirmOrder}
                disabled={modalShips < 1 || modalShips > maxShips}
              >
                Confirm
              </button>
              <button className={styles.modalCancel} onClick={clearSelection}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FAB End Turn ── */}
      <button
        id="end-turn-btn"
        className={styles.fab}
        onClick={handleEndTurn}
        disabled={busy}
      >
        {busy ? 'Processing' : 'End Turn'}
        {pendingOrders.length > 0 && !busy && (
          <span className={styles.fabBadge}>{pendingOrders.length}</span>
        )}
      </button>

      {/* ── Lobby link ── */}
      <button
        id="leave-game-btn"
        className={styles.lobbyLink}
        onClick={() => router.push('/lobby')}
      >
        ← Lobby
      </button>

      {/* ── Colonization toasts (queue) ── */}
      <AnimatePresence>
        {toasts[0] && (
          <motion.div
            key={toasts[0] + toasts.length}
            className={styles.toast}
            style={{ bottom: 104 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            ⬡ {toasts[0]}
            {toasts.length > 1 && (
              <span style={{ marginLeft: 8, opacity: 0.5, fontSize: 10 }}>
                +{toasts.length - 1} more
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error toast ── */}
      <AnimatePresence>
        {errorToast && (
          <motion.div
            key="error-toast"
            className={styles.toast}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
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
