'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createGame, joinGame, getMyGames, deleteGame, createTournamentGame, findGameByChallongeMatch } from '@/lib/firestore';
import { motion } from 'framer-motion';
import type { Game } from '@/lib/types';
import styles from './lobby.module.css';

export default function LobbyPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [playerName, setPlayerName] = useState('');
  const [planetCount, setPlanetCount] = useState<number>(20);
  const [gameIdInput, setGameIdInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [myGames, setMyGames] = useState<(Game & { id: string })[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Tournament registration state ────────────────────────────────────────
  const tournamentId = process.env.NEXT_PUBLIC_CHALLONGE_TOURNAMENT_ID;
  const [tourney, setTourney] = useState<{
    name: string;
    state: string;
    participantCount: number;
    maxParticipants: number | null;
    participants: string[];
    myMatch: { opponentName: string; opponentUid: string; matchId: string; round: number; gameId: string | null } | null;
  } | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState('');
  const [tourneyError, setTourneyError] = useState('');

  async function fetchTourney() {
    if (!tournamentId) return;
    setTourneyError('');
    try {
      const [tRes, pRes, mRes] = await Promise.all([
        fetch(`/api/challonge?path=/tournaments/${tournamentId}.json`),
        fetch(`/api/challonge?path=/tournaments/${tournamentId}/participants.json`),
        fetch(`/api/challonge?path=/tournaments/${tournamentId}/matches.json`),
      ]);

      if (!tRes.ok) {
        const errJson = await tRes.json().catch(() => ({}));
        // v1 errors: { errors: ['message'] }
        const msg = Array.isArray(errJson?.errors)
          ? errJson.errors[0]
          : errJson?.error ?? `Challonge API error ${tRes.status}`;
        setTourneyError(msg);
        return;
      }

      const [tJson, pJson, mJson] = await Promise.all([tRes.json(), pRes.json(), mRes.json()]);
      const t = tJson.tournament;
      console.log('[fetchTourney] v1 state:', t?.state);

      // v1: participants is an array of { participant: { id, name, misc } }
      const participantObjs: { id: string | number; name: string; misc?: string }[] =
        (pJson as { participant: { id: string | number; name: string; misc?: string } }[])
          .map((p) => p.participant);
      const participantNames = participantObjs.map((p) => p.name);

      // Find myself by UID stored in misc
      const me = participantObjs.find((p) => p.misc === user?.uid);

      // Find my open match
      // v1: matches is array of { match: { id, state, round, player1_id, player2_id } }
      let myMatch: { opponentName: string; opponentUid: string; matchId: string; round: number; gameId: string | null } | null = null;
      if (me) {
        const matches: { id: string | number; state: string; round: number; player1_id: string | number; player2_id: string | number }[] =
          (mJson as { match: { id: string | number; state: string; round: number; player1_id: string | number; player2_id: string | number } }[])
            .map((m) => m.match);

        const openMatch = matches.find(
          (m) =>
            m.state === 'open' &&
            (String(m.player1_id) === String(me.id) || String(m.player2_id) === String(me.id))
        );

        if (openMatch) {
          const opponentId =
            String(openMatch.player1_id) === String(me.id)
              ? openMatch.player2_id
              : openMatch.player1_id;
          const opponent = participantObjs.find((p) => String(p.id) === String(opponentId));
          const opponentUid = opponent?.misc ?? '';
          const matchIdStr = String(openMatch.id);

          // Check if a game already exists for this match
          let gameId: string | null = null;
          try {
            gameId = await findGameByChallongeMatch(matchIdStr);
          } catch { /* ignore */ }

          // Auto-create the game if it doesn't exist and we know both UIDs
          if (!gameId && opponentUid && user?.uid) {
            const myName = localStorage.getItem('commanderName') || 'Commander';
            const oppName = opponent?.name ?? 'Opponent';
            try {
              gameId = await createTournamentGame(
                user.uid, myName,
                opponentUid, oppName,
                matchIdStr
              );
              // Refresh the games list so it shows up
              getMyGames(user.uid).then(setMyGames).catch(() => {});
            } catch (e) {
              console.error('[auto-create tournament game]', e);
            }
          }

          myMatch = {
            opponentName: opponent?.name ?? 'TBD',
            opponentUid,
            matchId: matchIdStr,
            round: openMatch.round,
            gameId,
          };
        }
      }

      setTourney({
        name: t?.name ?? 'Tournament',
        state: t?.state ?? 'pending',
        participantCount: participantNames.length,
        maxParticipants: t?.signup_cap ?? null,
        participants: participantNames,
        myMatch,
      });
    } catch (e) {
      console.error('[fetchTourney]', e);
      setTourneyError(e instanceof Error ? e.message : 'Failed to load tournament');
    }
  }

  async function handleJoinTourney() {
    if (!tournamentId || !nameTrimmed) return;
    setJoinBusy(true);
    setJoinMsg('');
    try {
      const res = await fetch(
        `/api/challonge?path=/tournaments/${tournamentId}/participants.json`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // v1 format
          body: JSON.stringify({
            participant: { name: nameTrimmed, misc: user!.uid },
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = Array.isArray(err?.errors)
          ? err.errors[0]
          : err?.error ?? `Error ${res.status}`;
        throw new Error(detail);
      }
      setJoinMsg(`${nameTrimmed} registered!`);
      await fetchTourney(); // refresh count

      // Notify via email (fire and forget — don't block UI)
      fetch('/api/notify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: nameTrimmed,
          totalPlayers: (tourney?.participantCount ?? 0) + 1,
          maxPlayers: tourney?.maxParticipants ?? null,
        }),
      }).catch(() => {});
    } catch (e) {
      setJoinMsg(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setJoinBusy(false);
    }
  }

  useEffect(() => {
    if (user) {
      getMyGames(user.uid).then(setMyGames).catch(() => {});
      fetchTourney();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const saved = localStorage.getItem('commanderName');
    if (saved) setPlayerName(saved);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) return null;

  const nameTrimmed = playerName.trim();

  async function handleDeleteGame(gameId: string) {
    if (!window.confirm('Delete this sector? This cannot be undone.')) return;
    setDeletingId(gameId);
    try {
      await deleteGame(gameId, user!.uid);
      setMyGames((prev) => prev.filter((g) => g.id !== gameId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate() {
    if (!nameTrimmed) return;
    setBusy(true);
    setError('');
    try {
      const gameId = await createGame(user!.uid, nameTrimmed, planetCount);
      router.push(`/game/${gameId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create game');
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!gameIdInput.trim() || !nameTrimmed) return;
    setBusy(true);
    setError('');
    try {
      const resolvedId = await joinGame(gameIdInput.trim(), user!.uid, nameTrimmed);
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
          <button className="arcade-btn arcade-btn-muted arcade-btn-sm" onClick={signOut}>
            SIGN OUT
          </button>
        </header>

        <motion.div
          className={styles.content}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Commander Name Input */}
          <div className={styles.nameSection}>
            <label className={styles.nameLabel} htmlFor="player-name-input">
              COMMANDER NAME
            </label>
            <input
              id="player-name-input"
              className={styles.input}
              placeholder="ENTER YOUR CALLSIGN"
              value={playerName}
              onChange={(e) => {
                const v = e.target.value.slice(0, 8);
                setPlayerName(v);
                localStorage.setItem('commanderName', v);
              }}
              maxLength={8}
            />
          </div>

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

              {/* Planet count: configurable */}
              <div className={styles.toggleGroup}>
                <label className={styles.toggleLabel} htmlFor="planet-count-slider">
                  PLANETS: {planetCount}
                </label>
                <input
                  id="planet-count-slider"
                  type="range"
                  min={20}
                  max={35}
                  value={planetCount}
                  onChange={(e) => setPlanetCount(Number(e.target.value) as any)}
                  className={styles.sliderInput}
                />
              </div>

              <button
                id="create-game-btn"
                className="arcade-btn arcade-btn-primary arcade-btn-lg"
                onClick={handleCreate}
                disabled={busy || !nameTrimmed}
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
                className="arcade-btn arcade-btn-primary arcade-btn-lg"
                onClick={handleJoin}
                disabled={busy || !gameIdInput.trim() || !nameTrimmed}
              >
                JOIN SECTOR
              </button>
            </div>
          </div>

          {/* Bottom stat bar */}
          <div className={styles.statsBar}>
            <span className={styles.stat}>STATUS: <span className={styles.statGlow}>ONLINE</span></span>
            {tournamentId && (
              <button
                className="arcade-btn arcade-btn-muted arcade-btn-sm"
                onClick={() => router.push('/bracket')}
              >
                BRACKET
              </button>
            )}
          </div>

          {tourneyError && (
            <div className={styles.errorBox}>{tourneyError}</div>
          )}

          {/* ── YOUR NEXT MATCH ── */}
          {tourney?.myMatch && (
            <div className={styles.myMatchBox}>
              <div className={styles.myMatchHeader}>
                <span className={styles.myMatchIcon}>⚔</span>
                <span className={styles.myMatchLabel}>YOUR NEXT MATCH</span>
              </div>
              <div className={styles.myMatchVs}>
                <span className={styles.myMatchRound}>ROUND {tourney.myMatch.round}</span>
                <span className={styles.myMatchOpponent}>VS. {tourney.myMatch.opponentName.toUpperCase()}</span>
              </div>
              <p className={styles.myMatchHint}>
                Your match has been auto-created. Both players are ready.
              </p>
              {tourney.myMatch.gameId ? (
                <button
                  className="arcade-btn arcade-btn-primary arcade-btn-lg"
                  onClick={() => router.push(`/game/${tourney.myMatch!.gameId}`)}
                >
                  PLAY MATCH
                </button>
              ) : (
                <button
                  className="arcade-btn arcade-btn-muted arcade-btn-lg"
                  disabled
                >
                  SETTING UP...
                </button>
              )}
              <button
                className="arcade-btn arcade-btn-secondary arcade-btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => router.push('/bracket')}
              >
                VIEW BRACKET
              </button>
            </div>
          )}

          {/* ── JOIN CONTEST ── */}
          {tourney && tourney.state !== 'underway' && tourney.state !== 'complete' && (
            <div className={styles.contestBox}>
              <div className={styles.contestHeader}>
                <span className={styles.contestIcon}>⚡</span>
                <div>
                  <span className={styles.contestTitle}>{tourney.name.toUpperCase()}</span>
                  <span className={styles.contestSub}>
                    {tourney.maxParticipants !== null
                      ? `REGISTRATION ${tourney.participantCount >= tourney.maxParticipants ? 'FULL' : 'OPEN'} — ${tourney.participantCount}/${tourney.maxParticipants} COMMANDERS`
                      : `REGISTRATION OPEN — ${tourney.participantCount} COMMANDERS ENROLLED`}
                  </span>
                </div>
              </div>

              {tourney.participants.includes(nameTrimmed) ? (
                <p className={styles.contestAlready}>✓ {nameTrimmed} IS REGISTERED</p>
              ) : tourney.maxParticipants !== null && tourney.participantCount >= tourney.maxParticipants ? (
                <p className={styles.contestFull}>TOURNAMENT IS FULL — REGISTRATION CLOSED</p>
              ) : (
                <>
                  <button
                    id="join-contest-btn"
                    className="arcade-btn arcade-btn-primary arcade-btn-lg"
                    disabled={joinBusy || !nameTrimmed}
                    onClick={handleJoinTourney}
                  >
                    {joinBusy ? 'REGISTERING...' : !nameTrimmed ? 'ENTER NAME ABOVE FIRST' : 'JOIN CONTEST'}
                  </button>
                </>
              )}

              {joinMsg && (
                <p className={`${styles.contestMsg} ${
                  joinMsg.includes('registered') ? styles.contestMsgOk : styles.contestMsgErr
                }`}>{joinMsg}</p>
              )}

              <div className={styles.contestRoster}>
                {tourney.participants.slice(0, 12).map((name) => (
                  <span key={name} className={styles.contestPill}>{name}</span>
                ))}
                {tourney.participantCount > 12 && (
                  <span className={styles.contestPill}>+{tourney.participantCount - 12} more</span>
                )}
              </div>
            </div>
          )}

          {/* My Games */}
          {myGames.length > 0 && (
            <div className={styles.myGames}>
              <span className={styles.myGamesTitle}>MY SECTORS</span>
              {myGames
                .sort((a, b) => {
                  const order = { active: 0, lobby: 1, ended: 2 };
                  return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                })
                .map((g) => (
                  <div key={g.id} className={styles.myGame}>
                    <span className={`${styles.myGameStatus} ${styles['myGameStatus_' + g.status]}`}>
                      {g.status.toUpperCase()}
                    </span>
                    <span className={styles.myGameCode}>{g.inviteCode}</span>
                    <span className={styles.myGamePlayers}>{g.players.length}P</span>
                    <button
                      className="arcade-btn arcade-btn-secondary arcade-btn-sm"
                      onClick={() => router.push(`/game/${g.id}`)}
                    >
                      {g.status === 'lobby' ? 'ENTER' : g.status === 'active' ? 'REJOIN' : 'VIEW'}
                    </button>
                    {g.hostUid === user?.uid && g.status !== 'active' && (
                      <button
                        className="arcade-btn arcade-btn-danger arcade-btn-sm"
                        disabled={deletingId === g.id}
                        onClick={() => handleDeleteGame(g.id)}
                        title="Delete sector"
                        style={{ padding: '6px 8px' }}
                      >
                        {deletingId === g.id ? '…' : '✕'}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </motion.div>
      </div>
    </main>
  );
}
