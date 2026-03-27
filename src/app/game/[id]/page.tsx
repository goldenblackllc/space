'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Canvas from '@/components/Canvas';
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

interface FleetOrder {
  id: string;
  fromPlanetId: string;
  toPlanetId: string;
  ships: number;
}

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
  const [toast, setToast] = useState('');

  // Fleet orders register (staged, not yet dispatched)
  const [orders, setOrders] = useState<FleetOrder[]>([]);
  const [orderFrom, setOrderFrom] = useState('');
  const [orderTo, setOrderTo] = useState('');
  const [orderShips, setOrderShips] = useState('');

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

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  // Stable planet index (sorted by id for consistency)
  const sortedIds = useMemo(
    () => [...planets].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.id),
    [planets]
  );
  const planetIndex = (id: string) => sortedIds.indexOf(id) + 1;
  const planetByIdx = (idx: number) => planets.find((p) => sortedIds[idx - 1] === p.id);
  const myPlanets = planets.filter((p) => p.owner === user?.uid);

  // When canvas planet is clicked, pre-populate the order form
  function handlePlanetClick(planet: Planet) {
    if (planet.owner === user?.uid) {
      setOrderFrom(String(planetIndex(planet.id)));
      const maxShips = Math.max(0, planet.ships - 1);
      setOrderShips(String(Math.floor(maxShips / 2)));
    } else {
      setOrderTo(String(planetIndex(planet.id)));
    }
  }

  function addOrder() {
    const fromIdx = parseInt(orderFrom);
    const toIdx = parseInt(orderTo);
    const ships = parseInt(orderShips);

    const fromPlanet = planetByIdx(fromIdx);
    const toPlanet = planetByIdx(toIdx);

    if (!fromPlanet || !toPlanet) return showToast('Invalid planet numbers.');
    if (fromPlanet.owner !== user?.uid) return showToast("You don't own that planet.");
    if (fromPlanet.id === toPlanet.id) return showToast('Source and target must differ.');
    if (isNaN(ships) || ships < 1) return showToast('Enter at least 1 ship.');
    if (ships >= fromPlanet.ships) return showToast(`Planet #${fromIdx} only has ${fromPlanet.ships} ships. Must keep at least 1.`);

    setOrders((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        fromPlanetId: fromPlanet.id,
        toPlanetId: toPlanet.id,
        ships,
      },
    ]);
    setOrderFrom('');
    setOrderTo('');
    setOrderShips('');
  }

  function removeOrder(id: string) {
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }

  async function launchAllOrders() {
    if (!game || orders.length === 0) return;
    setBusy(true);
    let launched = 0;
    for (const order of orders) {
      const from = planets.find((p) => p.id === order.fromPlanetId);
      const to = planets.find((p) => p.id === order.toPlanetId);
      if (!from || !to || from.ships <= 1) continue;
      const ships = Math.min(order.ships, from.ships - 1);
      await dispatchFleet(gameId, user!.uid, from, to, ships, game.currentYear);
      launched++;
    }
    setOrders([]);
    setBusy(false);
    showToast(`✓ ${launched} fleet${launched !== 1 ? 's' : ''} launched`);
  }

  async function handleEndTurn() {
    if (!game || busy) return;
    if (orders.length > 0) {
      showToast('Launch or clear your fleet orders before ending the turn.');
      return;
    }
    setBusy(true);
    await advanceTurn(gameId, game.currentYear);
    setBusy(false);
  }

  if (!game) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Loading galaxy…</span>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logoRow}>
          <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="var(--accent)" strokeWidth="1.5" />
            <circle cx="18" cy="18" r="6" fill="var(--accent)" opacity="0.9" />
            <ellipse cx="18" cy="18" rx="17" ry="6" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          </svg>
          <span className={styles.logoText}>SPACE</span>
        </div>

        {/* Year */}
        <div className={styles.yearBlock}>
          <span className={styles.yearLabel}>Year</span>
          <span className={styles.yearValue}>{game.currentYear}</span>
        </div>

        {/* Stats */}
        <div className={styles.statGroup}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Planets</span>
            <span className={styles.statValue}>{myPlanets.length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total Ships</span>
            <span className={styles.statValue}>{myPlanets.reduce((s, p) => s + p.ships, 0)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>In Transit</span>
            <span className={styles.statValue}>{fleets.filter((f) => f.owner === user?.uid).length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Players</span>
            <span className={styles.statValue}>{game.players.length}</span>
          </div>
        </div>

        {/* ── Fleet Orders Panel ── */}
        <div className={styles.ordersPanel}>
          <div className={styles.ordersPanelHeader}>
            <span className={styles.ordersTitle}>Fleet Orders</span>
            {orders.length > 0 && (
              <span className={styles.ordersBadge}>{orders.length}</span>
            )}
          </div>

          {/* Order builder */}
          <div className={styles.orderBuilder}>
            <div className={styles.orderInputRow}>
              <div className={styles.orderField}>
                <label className={styles.orderFieldLabel}>From #</label>
                <input
                  className={styles.orderInput}
                  type="number"
                  min={1}
                  placeholder="–"
                  value={orderFrom}
                  onChange={(e) => setOrderFrom(e.target.value)}
                />
              </div>
              <span className={styles.orderArrow}>→</span>
              <div className={styles.orderField}>
                <label className={styles.orderFieldLabel}>To #</label>
                <input
                  className={styles.orderInput}
                  type="number"
                  min={1}
                  placeholder="–"
                  value={orderTo}
                  onChange={(e) => setOrderTo(e.target.value)}
                />
              </div>
              <div className={styles.orderField}>
                <label className={styles.orderFieldLabel}>Ships</label>
                <input
                  className={styles.orderInput}
                  type="number"
                  min={1}
                  placeholder="–"
                  value={orderShips}
                  onChange={(e) => setOrderShips(e.target.value)}
                />
              </div>
            </div>
            <button
              className={styles.orderAddBtn}
              onClick={addOrder}
              disabled={!orderFrom || !orderTo || !orderShips}
            >
              + Queue Order
            </button>
          </div>

          {/* Staged orders list */}
          <div className={styles.ordersList}>
            <AnimatePresence>
              {orders.length === 0 ? (
                <p className={styles.ordersEmpty}>
                  No orders queued. Click a planet or fill in the fields above.
                </p>
              ) : (
                orders.map((order) => {
                  const fromP = planets.find((p) => p.id === order.fromPlanetId);
                  const toP = planets.find((p) => p.id === order.toPlanetId);
                  return (
                    <motion.div
                      key={order.id}
                      className={styles.orderRow}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <span className={styles.orderRowLabel}>
                        #{planetIndex(order.fromPlanetId)} → #{planetIndex(order.toPlanetId)}
                      </span>
                      <span className={styles.orderRowShips}>{order.ships} ships</span>
                      <button
                        className={styles.orderRemoveBtn}
                        onClick={() => removeOrder(order.id)}
                        aria-label="Remove order"
                      >
                        ✕
                      </button>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>

          {orders.length > 0 && (
            <button
              id="launch-all-btn"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={launchAllOrders}
              disabled={busy}
            >
              {busy ? 'Launching…' : `🚀 Launch All (${orders.length})`}
            </button>
          )}
        </div>

        {/* Game ID */}
        <div className={styles.gameId}>
          <span className={styles.statLabel}>Game ID</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
            {gameId}
          </span>
        </div>

        <div className={styles.sidebarFooter}>
          <button
            id="end-turn-btn"
            className="btn btn-primary"
            onClick={handleEndTurn}
            disabled={busy}
          >
            {busy ? 'Processing…' : 'End Turn →'}
          </button>
          <button
            id="leave-game-btn"
            className="btn btn-ghost"
            onClick={() => router.push('/lobby')}
          >
            ← Lobby
          </button>
        </div>
      </aside>

      {/* ── Board ── */}
      <main className={styles.board}>
        <Canvas
          planets={planets}
          fleets={fleets}
          player={player}
          currentYear={game.currentYear}
          onPlanetClick={handlePlanetClick}
        />
      </main>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            className={styles.toast}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
