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
      await joinGame(gameIdInput.trim(), user!.uid);
      router.push(`/game/${gameIdInput.trim()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join game');
      setBusy(false);
    }
  }

  return (
    <main className={styles.main}>
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
          <div className={styles.logoMark}>
            <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="17" stroke="var(--accent)" strokeWidth="1.5" />
              <circle cx="18" cy="18" r="6" fill="var(--accent)" opacity="0.9" />
              <ellipse cx="18" cy="18" rx="17" ry="6" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            </svg>
            <span className={styles.logoLabel}>SPACE</span>
          </div>
          <button id="sign-out-btn" className="btn btn-ghost" onClick={signOut}>Sign out</button>
        </header>

        <motion.div
          className={styles.content}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className={styles.title}>Mission Control</h1>
          <p className={styles.welcome}>
            Welcome back, <span className="mono" style={{ color: 'var(--accent)' }}>{user.uid.slice(0, 16)}…</span>
          </p>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.cards}>
            {/* Create game */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>⬡ New Campaign</h2>
              <p className={styles.cardDesc}>Generate a new galaxy and invite others to join.</p>
              <button
                id="create-game-btn"
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={busy}
              >
                {busy ? 'Generating…' : 'Create Game'}
              </button>
            </div>

            {/* Join game */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>⊕ Join Campaign</h2>
              <p className={styles.cardDesc}>Enter a game ID to join an existing galaxy.</p>
              <div className={styles.joinRow}>
                <input
                  id="game-id-input"
                  className="input"
                  placeholder="Game ID"
                  value={gameIdInput}
                  onChange={(e) => setGameIdInput(e.target.value)}
                />
                <button
                  id="join-game-btn"
                  className="btn btn-primary"
                  onClick={handleJoin}
                  disabled={busy || !gameIdInput.trim()}
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
