import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  Timestamp,
  query,
  where,
  limit,
  arrayUnion,
  deleteDoc,
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import { generatePlanets, assignHomePlanet } from './gameEngine';
import type { Game, Planet, Fleet, Player, BattleRecord, ColonizationRecord, ReinforcementRecord } from './types';

// ─── Invite Code Helper ───────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
function generateInviteCode(length = 5): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// ─── Game Collection Helpers ──────────────────────────────────────────────────

export async function createGame(hostUid: string): Promise<string> {
  const gameRef = doc(collection(db, 'games'));
  const planets = generatePlanets(20);

  const inviteCode = generateInviteCode();

  const gameData: Omit<Game, 'id'> = {
    status: 'lobby',
    currentYear: 0,
    players: [hostUid],
    turn: hostUid,
    turnEnded: {},
    hostUid,
    inviteCode,
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

export async function joinGame(input: string, uid: string): Promise<string> {
  let gameId = input;

  // If input looks like a short invite code (≤ 6 chars), resolve it
  if (input.length <= 6) {
    const q = query(
      collection(db, 'games'),
      where('inviteCode', '==', input.toUpperCase()),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Game not found');
    gameId = snap.docs[0].id;
  }

  const gameRef = doc(db, 'games', gameId);
  const gameSnap = await getDoc(gameRef);
  if (!gameSnap.exists()) throw new Error('Game not found');

  const game = gameSnap.data() as Game;

  // Guard: if player is already in the game, just navigate them back — don't
  // assign a second home planet or overwrite their player doc.
  if (game.players.includes(uid)) {
    return gameId;
  }

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

  return gameId;
}

// ─── Real-time Subscriptions ──────────────────────────────────────────────────

export function subscribeGame(
  gameId: string,
  callback: (game: Game) => void
): () => void {
  return onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (!snap.exists()) return;
    const data = { id: snap.id, ...(snap.data() as Omit<Game, 'id'>) };

    // Auto-migrate: generate inviteCode for games created before this feature
    if (!data.inviteCode) {
      const code = generateInviteCode();
      updateDoc(doc(db, 'games', gameId), { inviteCode: code });
      // The updateDoc will trigger another snapshot with the code filled in
      return;
    }

    callback(data);
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

export function subscribeBattles(
  gameId: string,
  callback: (battles: BattleRecord[]) => void
): () => void {
  return onSnapshot(collection(db, 'games', gameId, 'combatResults'), (snap) => {
    const battles = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<BattleRecord, 'id'>),
    }));
    callback(battles);
  });
}

export async function markBattleViewed(
  gameId: string,
  battleId: string,
  uid: string,
  allPartyUids: string[]
): Promise<void> {
  const ref = doc(db, 'games', gameId, 'combatResults', battleId);
  await updateDoc(ref, { viewedBy: arrayUnion(uid) });

  // If all involved parties have now viewed, delete the record
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as BattleRecord;
    const viewed: string[] = data.viewedBy ?? [];
    if (data.appliedToMap && allPartyUids.every((u) => viewed.includes(u))) {
      await deleteDoc(ref);
    }
  }
}

// ─── Colonization Events ──────────────────────────────────────────────────────

export function subscribeColonizations(
  gameId: string,
  callback: (records: ColonizationRecord[]) => void
): () => void {
  return onSnapshot(collection(db, 'games', gameId, 'colonizationResults'), (snap) => {
    const records = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ColonizationRecord, 'id'>),
    }));
    callback(records);
  });
}

export async function markColonizationViewed(
  gameId: string,
  colonizationId: string,
  uid: string,
  allPlayerUids: string[]
): Promise<void> {
  const ref = doc(db, 'games', gameId, 'colonizationResults', colonizationId);
  await updateDoc(ref, { viewedBy: arrayUnion(uid) });

  // If all players have now viewed, delete the record
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as ColonizationRecord;
    const viewed: string[] = data.viewedBy ?? [];
    if (data.appliedToMap && allPlayerUids.every((u) => viewed.includes(u))) {
      await deleteDoc(ref);
    }
  }
}

// ─── Reinforcement Events ──────────────────────────────────────────────────────

export function subscribeReinforcements(
  gameId: string,
  callback: (records: ReinforcementRecord[]) => void
): () => void {
  return onSnapshot(collection(db, 'games', gameId, 'reinforcementResults'), (snap) => {
    const records = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ReinforcementRecord, 'id'>),
    }));
    callback(records);
  });
}

export async function markReinforcementViewed(
  gameId: string,
  reinforcementId: string,
  uid: string,
): Promise<void> {
  const ref = doc(db, 'games', gameId, 'reinforcementResults', reinforcementId);
  await updateDoc(ref, { viewedBy: arrayUnion(uid) });

  // Reinforcements only notify the fleet owner, so once they've viewed it
  // and it's been applied to the official map, clean it up immediately.
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as ReinforcementRecord;
    if (data.appliedToMap) {
      await deleteDoc(ref);
    }
  }
}

// ─── Apply Pending Events to Official Map ─────────────────────────────────────

export async function applyPendingEventsToOfficialMap(
  gameId: string
): Promise<void> {
  const gameSnap = await getDoc(doc(db, 'games', gameId));
  const players = (gameSnap.data() as Game | undefined)?.players ?? [];

  // Apply reinforcement results
  const reinSnap = await getDocs(collection(db, 'games', gameId, 'reinforcementResults'));
  for (const d of reinSnap.docs) {
    const rec = d.data() as Omit<ReinforcementRecord, 'id'>;
    if (rec.appliedToMap) continue;

    // Reinforcements add to existing ships
    await updateDoc(doc(db, 'games', gameId, 'planets', rec.planetId), {
      ships: increment(rec.ships),
    });
    
    // Reinforcements only notify the fleet owner — delete once they've viewed
    const ownerViewed = (rec.viewedBy ?? []).includes(rec.fleetOwnerUid);
    if (ownerViewed) {
      await deleteDoc(d.ref);
    } else {
      await updateDoc(d.ref, { appliedToMap: true });
    }
  }

  // Apply colonization results to official planet docs
  const colonSnap = await getDocs(collection(db, 'games', gameId, 'colonizationResults'));
  for (const d of colonSnap.docs) {
    const rec = d.data() as Omit<ColonizationRecord, 'id'>;
    if (rec.appliedToMap) continue;

    await updateDoc(doc(db, 'games', gameId, 'planets', rec.planetId), {
      owner: rec.fleetOwnerUid,
      ships: rec.ships,
    });
    
    if (players.every((u) => (rec.viewedBy ?? []).includes(u))) {
      await deleteDoc(d.ref);
    } else {
      await updateDoc(d.ref, { appliedToMap: true });
    }
  }

  // Apply battle results to official planet docs
  const combatSnap = await getDocs(collection(db, 'games', gameId, 'combatResults'));
  for (const d of combatSnap.docs) {
    const rec = d.data() as Omit<BattleRecord, 'id'>;
    if (rec.appliedToMap) continue;

    if (rec.attackerWon) {
      await updateDoc(doc(db, 'games', gameId, 'planets', rec.planetId), {
        owner: rec.attackerUid,
        ships: rec.survivingAttackerShips,
      });
    } else {
      await updateDoc(doc(db, 'games', gameId, 'planets', rec.planetId), {
        ships: rec.survivingDefenderShips,
      });
    }
    
    const involved = [rec.attackerUid, rec.defenderUid];
    if (involved.every((u) => (rec.viewedBy ?? []).includes(u))) {
      await deleteDoc(d.ref);
    } else {
      await updateDoc(d.ref, { appliedToMap: true });
    }
  }
}
