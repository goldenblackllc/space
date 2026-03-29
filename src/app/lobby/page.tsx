'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createGame, joinGame } from '@/lib/firestore';
import { motion } from 'framer-motion';
import styles from './lobby.module.css';

export default function LobbyPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [gameIdInput, setGameIdInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) return null;

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      const gameId = await createGame(user!.uid);
      router.push(`/game/${gameId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create game');
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!gameIdInput.trim()) return;
    setBusy(true);
    setError('');
    try {
      const resolvedId = await joinGame(gameIdInput.trim(), user!.uid);
      router.push(`/game/${resolvedId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join game');
      setBusy(false);
    }
  }

  return (
    <main className={styles.main}>
      {/* CRT scanlines */}
      <div className={styles.crt} aria-hidden="true" />

      {/* Starfield */}
      <div className={styles.stars} aria-hidden="true">
        {Array.from({ length: 60 }).map((_, i) => (
          <span key={i} className={styles.star} style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 5}s`,
          }} />
        ))}
      </div>

      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <span className={styles.headerTitle}>LOBBY — COMMAND CENTER</span>
          <button className={styles.ghostBtn} onClick={signOut}>
            [X] SIGN OUT
          </button>
        </header>

        <motion.div
          className={styles.content}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Commander ID */}
          <p className={styles.commanderLabel}>
            COMMANDER <span className={styles.commanderId}>{user.uid.slice(0, 12).toUpperCase()}</span>
          </p>

          {error && <p className={styles.error}>{error}</p>}

          {/* Sector cards */}
          <div className={styles.sectors}>
            {/* Create Sector */}
            <div className={styles.sector}>
              <div className={styles.sectorHeader}>
                <span className={styles.sectorIcon}>⬡</span>
                <span className={styles.sectorTitle}>NEW SECTOR</span>
              </div>
              <p className={styles.sectorDesc}>&gt; GENERATE A NEW GALAXY<br/>&gt; AND AWAIT COMMANDERS</p>
              <button
                id="create-game-btn"
                className={styles.arcadeBtn}
                onClick={handleCreate}
                disabled={busy}
              >
                {busy ? 'GENERATING...' : 'CREATE SECTOR'}
              </button>
            </div>

            {/* Join Sector */}
            <div className={styles.sector}>
              <div className={styles.sectorHeader}>
                <span className={styles.sectorIcon}>⊕</span>
                <span className={styles.sectorTitle}>JOIN SECTOR</span>
              </div>
              <p className={styles.sectorDesc}>&gt; ENTER SECTOR CODE TO<br/>&gt; JOIN EXISTING GALAXY</p>
              <div className={styles.joinRow}>
                <input
                  id="game-id-input"
                  className={styles.input}
                  placeholder="SECTOR CODE"
                  value={gameIdInput}
                  onChange={(e) => setGameIdInput(e.target.value)}
                />
              </div>
              <button
                id="join-game-btn"
                className={styles.arcadeBtn}
                onClick={handleJoin}
                disabled={busy || !gameIdInput.trim()}
              >
                JOIN SECTOR
              </button>
            </div>
          </div>

          {/* Bottom stat bar */}
          <div className={styles.statsBar}>
            <span className={styles.stat}>STATUS: <span className={styles.statGlow}>ONLINE</span></span>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
