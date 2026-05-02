'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Canvas from '@/components/Canvas';
import {
  subscribeGame,
  subscribePlanets,
  subscribeFleets,
  subscribePlayers,
} from '@/lib/firestore';
import type { Game, Planet, Fleet, Player, TeamConfig } from '@/lib/types';
import styles from './spectate.module.css';

export default function SpectatePage() {
  const { id: gameId } = useParams<{ id: string }>();
  const [game, setGame] = useState<Game | null>(null);
  const [planets, setPlanets] = useState<Planet[]>([]);
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  // ── Firestore subscriptions ───────────────────────────────────────────
  useEffect(() => {
    if (!gameId) return;
    const unsubs = [
      subscribeGame(gameId, setGame),
      subscribePlanets(gameId, setPlanets),
      subscribeFleets(gameId, setFleets),
      subscribePlayers(gameId, setPlayers),
    ];
    return () => unsubs.forEach((u) => u());
  }, [gameId]);

  // ── Team color map ────────────────────────────────────────────────────
  const teamColorMap = useMemo(() => {
    const teams = game?.teams;
    if (!teams || teams.length === 0) return undefined;
    const map: Record<string, string> = {};
    for (const team of teams) {
      for (const uid of team.members) {
        map[uid] = team.color;
      }
    }
    return map;
  }, [game?.teams]);

  // ── Scoreboard ────────────────────────────────────────────────────────
  const scoreboard = useMemo(() => {
    if (!game?.teams || game.teams.length === 0) {
      // Free-for-all: score by player
      const playerMap = new Map(players.map((p) => [p.uid, p.name]));
      const scores: { name: string; planets: number; ships: number; color: string }[] = [];
      const uidSet = new Set(game?.players ?? []);
      for (const uid of uidSet) {
        const owned = planets.filter((p) => p.owner === uid);
        scores.push({
          name: playerMap.get(uid) ?? uid.slice(0, 6),
          planets: owned.length,
          ships: owned.reduce((sum, p) => sum + p.ships, 0),
          color: '#e8e8e0',
        });
      }
      return scores.sort((a, b) => b.planets - a.planets || b.ships - a.ships);
    }

    // Team mode: score by team
    return game.teams.map((team) => {
      const owned = planets.filter((p) => p.owner && team.members.includes(p.owner));
      return {
        name: team.name,
        planets: owned.length,
        ships: owned.reduce((sum, p) => sum + p.ships, 0),
        color: team.color,
      };
    }).sort((a, b) => b.planets - a.planets || b.ships - a.ships);
  }, [game, planets, players]);

  // ── Fleet count ───────────────────────────────────────────────────────
  const totalFleetsInTransit = fleets.length;

  if (!game) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingText}>CONNECTING TO SECTOR…</span>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <span className={styles.headerTitle}>⬡ SPECTATOR MODE</span>
        <span className={styles.headerYear}>YEAR {game.currentYear}</span>
        <span className={styles.headerStatus}>
          {game.status === 'ended' ? '🏆 GAME OVER' : '● LIVE'}
        </span>
      </header>

      {/* ── Map ── */}
      <main className={styles.board}>
        <Canvas
          planets={planets}
          player={null}
          playerTotalShips={0}
          origin={null}
          target={null}
          pendingOrders={[]}
          teamColorMap={teamColorMap}
          spectatorMode={true}
          onPlanetClick={() => {}}
          className={styles.canvasWrap}
        />
      </main>

      {/* ── Scoreboard sidebar ── */}
      <aside className={styles.sidebar}>
        <div className={styles.scoreSection}>
          <span className={styles.sectionTitle}>SCOREBOARD</span>
          {scoreboard.map((entry) => (
            <div key={entry.name} className={styles.scoreRow}>
              <span className={styles.scoreDot} style={{ background: entry.color }} />
              <span className={styles.scoreName}>{entry.name.toUpperCase()}</span>
              <span className={styles.scoreVal}>{entry.planets}P</span>
              <span className={styles.scoreVal}>{entry.ships}S</span>
            </div>
          ))}
        </div>

        <div className={styles.scoreSection}>
          <span className={styles.sectionTitle}>STATUS</span>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>FLEETS IN TRANSIT</span>
            <span className={styles.statValue}>{totalFleetsInTransit}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>TOTAL PLANETS</span>
            <span className={styles.statValue}>{planets.length}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>PLAYERS</span>
            <span className={styles.statValue}>{players.length}</span>
          </div>
        </div>

        {game.status === 'ended' && game.winnerTeamId && game.teams && (
          <div className={styles.winnerBox}>
            <span className={styles.winnerLabel}>🏆 WINNER</span>
            <span className={styles.winnerName}>
              {game.teams.find((t) => t.id === game.winnerTeamId)?.name ?? 'Unknown'}
            </span>
          </div>
        )}

        {game.status === 'ended' && !game.winnerTeamId && game.winnerUid && (
          <div className={styles.winnerBox}>
            <span className={styles.winnerLabel}>🏆 WINNER</span>
            <span className={styles.winnerName}>
              {players.find((p) => p.uid === game.winnerUid)?.name ?? 'Unknown'}
            </span>
          </div>
        )}
      </aside>
    </div>
  );
}
