'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import styles from './bracket.module.css';

// ── v1 API types ──────────────────────────────────────────────────────────────

interface V1Participant {
  id: number;
  name: string;
  seed: number;
  final_rank: number | null;
  wins: number;
  losses: number;
  misc?: string;
}

interface V1Match {
  id: number;
  state: 'pending' | 'open' | 'complete';
  round: number;
  suggested_play_order: number | null;
  winner_id: number | null;
  scores_csv: string | null;
  player1_id: number | null;
  player2_id: number | null;
}

interface TournamentData {
  participants: V1Participant[];
  matches: V1Match[];
  tournamentName: string;
  tournamentState: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function participantName(participants: V1Participant[], id: number | null): string {
  if (!id) return 'TBD';
  return participants.find((p) => p.id === id)?.name ?? 'Unknown';
}

function stateLabel(state: string) {
  if (state === 'open') return 'LIVE';
  if (state === 'complete') return 'DONE';
  return 'PENDING';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BracketPage() {
  const router = useRouter();
  const tournamentId = process.env.NEXT_PUBLIC_CHALLONGE_TOURNAMENT_ID;

  const [data, setData] = useState<TournamentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'matches' | 'standings'>('matches');
  const [reporting, setReporting] = useState<number | null>(null);
  const [reportError, setReportError] = useState('');

  async function fetchBracket() {
    if (!tournamentId) {
      setError('No tournament configured. Set NEXT_PUBLIC_CHALLONGE_TOURNAMENT_ID in .env.local');
      setLoading(false);
      return;
    }

    try {
      const [mRes, pRes, tRes] = await Promise.all([
        fetch(`/api/challonge?path=/tournaments/${tournamentId}/matches.json`),
        fetch(`/api/challonge?path=/tournaments/${tournamentId}/participants.json`),
        fetch(`/api/challonge?path=/tournaments/${tournamentId}.json`),
      ]);

      if (!mRes.ok || !pRes.ok) {
        const errJson = await mRes.json().catch(() => ({}));
        const msg = Array.isArray(errJson?.errors) ? errJson.errors[0] : `API error ${mRes.status}`;
        throw new Error(msg);
      }

      const [mJson, pJson, tJson] = await Promise.all([mRes.json(), pRes.json(), tRes.json()]);

      const participants: V1Participant[] = (pJson as { participant: V1Participant }[]).map(
        (p) => p.participant
      );
      const matches: V1Match[] = (mJson as { match: V1Match }[]).map((m) => m.match);

      setData({
        participants,
        matches,
        tournamentName: tJson.tournament?.name ?? 'Tournament',
        tournamentState: tJson.tournament?.state ?? 'unknown',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bracket');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBracket();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  async function reportWinner(matchId: number, winnerId: number, winnerName: string) {
    if (!window.confirm(`Report "${winnerName}" as the winner?`)) return;
    setReporting(matchId);
    setReportError('');
    try {
      const res = await fetch(`/api/challonge?path=/matches/${matchId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match: { winner_id: winnerId, scores_csv: '1-0' } }),
      });
      if (!res.ok) {
        const err = await res.json();
        const msg = Array.isArray(err?.errors) ? err.errors[0] : err?.error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await fetchBracket();
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Failed to report result');
    } finally {
      setReporting(null);
    }
  }

  function renderMatches(matches: V1Match[], participants: V1Participant[]) {
    const byRound = matches.reduce<Record<number, V1Match[]>>((acc, m) => {
      if (!acc[m.round]) acc[m.round] = [];
      acc[m.round].push(m);
      return acc;
    }, {});

    return Object.keys(byRound)
      .map(Number)
      .sort((a, b) => a - b)
      .map((round) => (
        <div key={round} className={styles.round}>
          <span className={styles.roundLabel}>
            {round < 0 ? `LOSERS R${Math.abs(round)}` : `ROUND ${round}`}
          </span>
          {byRound[round].map((match) => {
            const p1 = participantName(participants, match.player1_id);
            const p2 = participantName(participants, match.player2_id);
            const label = stateLabel(match.state);
            const winnerName = match.winner_id ? participantName(participants, match.winner_id) : null;
            const isOpen = match.state === 'open';

            return (
              <div
                key={match.id}
                className={`${styles.match} ${
                  label === 'LIVE' ? styles.matchLive :
                  label === 'DONE' ? styles.matchDone : styles.matchPending
                }`}
              >
                <span className={`${styles.matchState} ${
                  label === 'LIVE' ? styles.stateLive :
                  label === 'DONE' ? styles.stateDone : styles.statePending
                }`}>{label}</span>

                <div className={styles.matchup}>
                  <span className={`${styles.matchPlayer} ${winnerName === p1 ? styles.winner : ''}`}>{p1}</span>
                  <span className={styles.vs}>VS</span>
                  <span className={`${styles.matchPlayer} ${winnerName === p2 ? styles.winner : ''}`}>{p2}</span>
                </div>

                {isOpen && (
                  <div className={styles.matchActions}>
                    <span className={styles.reportLabel}>Report winner:</span>
                    <div className={styles.reportBtns}>
                      {[
                        { label: p1, id: match.player1_id },
                        { label: p2, id: match.player2_id },
                      ].map(({ label: pLabel, id }) => (
                        <button
                          key={id}
                          className={styles.reportBtn}
                          disabled={!id || reporting === match.id}
                          onClick={() => id && reportWinner(match.id, id, pLabel)}
                        >
                          {reporting === match.id ? '...' : pLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ));
  }

  function renderStandings(participants: V1Participant[]) {
    const sorted = [...participants].sort((a, b) => {
      if (a.final_rank !== null && b.final_rank !== null) return a.final_rank - b.final_rank;
      if (a.final_rank !== null) return -1;
      if (b.final_rank !== null) return 1;
      return (b.wins ?? 0) - (a.wins ?? 0);
    });

    return (
      <div className={styles.standings}>
        {sorted.map((p, i) => (
          <div key={p.id} className={`${styles.standingRow} ${i === 0 ? styles.first : ''}`}>
            <span className={styles.standingRank}>{p.final_rank ?? `#${i + 1}`}</span>
            <span className={styles.standingName}>{p.name}</span>
            <span className={styles.standingRecord}>{p.wins ?? 0}W — {p.losses ?? 0}L</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.crt} aria-hidden />
      <div className={styles.stars} aria-hidden>
        {Array.from({ length: 50 }).map((_, i) => (
          <span key={i} className={styles.star} style={{
            left: `${(i * 31 + 7) % 100}%`,
            top: `${(i * 17 + 13) % 100}%`,
            animationDelay: `${(i * 0.37) % 5}s`,
          }} />
        ))}
      </div>

      <div className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push('/lobby')}>[&lt;] LOBBY</button>
          <span className={styles.title}>{data ? data.tournamentName.toUpperCase() : 'BRACKET'}</span>
          <button className={styles.refreshBtn} onClick={fetchBracket}>[↻] REFRESH</button>
        </header>

        {loading && <div className={styles.loading}><div className={styles.spinner} /><span>LOADING BRACKET...</span></div>}
        {error && <div className={styles.errorBox}>{error}</div>}
        {reportError && <div className={styles.errorBox}>{reportError}</div>}

        {data && !loading && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className={styles.tourneyStatus}>
              <span className={styles.statusDot} />
              <span className={styles.statusText}>TOURNAMENT: {data.tournamentState.toUpperCase().replace('_', ' ')}</span>
            </div>

            <div className={styles.tabs}>
              <button className={`${styles.tab} ${activeTab === 'matches' ? styles.tabActive : ''}`} onClick={() => setActiveTab('matches')}>MATCHES</button>
              <button className={`${styles.tab} ${activeTab === 'standings' ? styles.tabActive : ''}`} onClick={() => setActiveTab('standings')}>STANDINGS</button>
            </div>

            {activeTab === 'matches'
              ? <div className={styles.roundsContainer}>{renderMatches(data.matches, data.participants)}</div>
              : renderStandings(data.participants)
            }
          </motion.div>
        )}
      </div>
    </main>
  );
}
