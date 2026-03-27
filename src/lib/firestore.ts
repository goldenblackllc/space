import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  Timestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { generatePlanets, assignHomePlanet } from './gameEngine';
import type { Game, Planet, Fleet, Player } from './types';

// ─── Game Collection Helpers ──────────────────────────────────────────────────

export async function createGame(hostUid: string): Promise<string> {
  const gameRef = doc(collection(db, 'games'));
  const planets = generatePlanets(20);

  const gameData: Omit<Game, 'id'> = {
    status: 'lobby',
    currentYear: 0,
    players: [hostUid],
    turn: hostUid,
    hostUid,
  };

  await setDoc(gameRef, gameData);

  // Write planets as a subcollection
  for (const planet of planets) {
    await setDoc(doc(db, 'games', gameRef.id, 'planets', planet.id), planet);
  }

  // Assign a home planet to the host
  const homePlanetId = await assignHomePlanet(gameRef.id, hostUid, planets);

  // Create player doc
  const playerData: Player = {
    uid: hostUid,
    phone: '',
    homePlanetId,
    revealedPlanets: [homePlanetId],
  };
  await setDoc(doc(db, 'games', gameRef.id, 'players', hostUid), playerData);

  return gameRef.id;
}

export async function joinGame(gameId: string, uid: string): Promise<void> {
  const gameRef = doc(db, 'games', gameId);
  const gameSnap = await getDoc(gameRef);
  if (!gameSnap.exists()) throw new Error('Game not found');

  const game = gameSnap.data() as Game;

  // Fetch existing planets
  const planetsSnap = await import('firebase/firestore').then(({ getDocs }) =>
    getDocs(collection(db, 'games', gameId, 'planets'))
  );
  const planets: Planet[] = planetsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Planet, 'id'>),
  }));

  const homePlanetId = await assignHomePlanet(gameId, uid, planets);

  const playerData: Player = {
    uid,
    phone: '',
    homePlanetId,
    revealedPlanets: [homePlanetId],
  };
  await setDoc(doc(db, 'games', gameId, 'players', uid), playerData);
  await updateDoc(gameRef, { players: [...game.players, uid] });
}

// ─── Real-time Subscriptions ──────────────────────────────────────────────────

export function subscribeGame(
  gameId: string,
  callback: (game: Game) => void
): () => void {
  return onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (snap.exists()) callback({ id: snap.id, ...(snap.data() as Omit<Game, 'id'>) });
  });
}

export function subscribePlanets(
  gameId: string,
  callback: (planets: Planet[]) => void
): () => void {
  return onSnapshot(collection(db, 'games', gameId, 'planets'), (snap) => {
    const planets = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Planet, 'id'>),
    }));
    callback(planets);
  });
}

export function subscribeFleets(
  gameId: string,
  callback: (fleets: Fleet[]) => void
): () => void {
  return onSnapshot(collection(db, 'games', gameId, 'fleets'), (snap) => {
    const fleets = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Fleet, 'id'>),
    }));
    callback(fleets);
  });
}

export function subscribePlayer(
  gameId: string,
  uid: string,
  callback: (player: Player) => void
): () => void {
  return onSnapshot(doc(db, 'games', gameId, 'players', uid), (snap) => {
    if (snap.exists()) callback({ uid: snap.id, ...(snap.data() as Omit<Player, 'uid'>) });
  });
}
