'use client';

import { useEffect, useState } from 'react';
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
import { motion } from 'framer-motion';
import styles from './game.module.css';

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
    setTimeout(() => setToast(''), 3000);
  }

  async function handleFleetDispatch(from: Planet, to: Planet) {
    if (!user || !game) return;
    if (from.owner !== user.uid) {
      showToast('You can only launch fleets from your own planets.');
      return;
    }
    if (from.ships < 2) {
      showToast('Not enough ships to dispatch a fleet.');
      return;
    }
    const sendShips = Math.floor(from.ships / 2);
    await dispatchFleet(gameId, user.uid, from, to, sendShips, game.currentYear);
    showToast(`Launched ${sendShips} ships → travel time ${Math.round(Math.hypot(from.x - to.x, from.y - to.y))} years`);
  }

  async function handleEndTurn() {
    if (!game || busy) return;
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

  const isMyTurn = game.turn === user?.uid;
  const myPlanets = planets.filter((p) => p.owner === user?.uid);

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
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
            <span className={styles.statValue}>
              {myPlanets.reduce((sum, p) => sum + p.ships, 0)}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Fleets In Transit</span>
            <span className={styles.statValue}>
              {fleets.filter((f) => f.owner === user?.uid).length}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Players</span>
            <span className={styles.statValue}>{game.players.length}</span>
          </div>
        </div>

        {/* Game ID */}
        <div className={styles.gameId}>
          <span className={styles.statLabel}>Game ID</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
            {gameId}
          </span>
        </div>

        {/* End Turn */}
        <button
          id="end-turn-btn"
          className="btn btn-primary"
          onClick={handleEndTurn}
          disabled={busy}
          style={{ marginTop: 'auto' }}
        >
          {busy ? 'Processing…' : isMyTurn ? 'End Turn →' : 'Waiting…'}
        </button>

        <button
          id="leave-game-btn"
          className="btn btn-ghost"
          onClick={() => router.push('/lobby')}
          style={{ marginTop: 8 }}
        >
          ← Lobby
        </button>
      </aside>

      {/* Board */}
      <main className={styles.board}>
        <Canvas
          planets={planets}
          fleets={fleets}
          player={player}
          currentYear={game.currentYear}
          onFleetDispatch={handleFleetDispatch}
        />
      </main>

      {/* Toast */}
      {toast && (
        <motion.div
          className={styles.toast}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          {toast}
        </motion.div>
      )}
    </div>
  );
}
