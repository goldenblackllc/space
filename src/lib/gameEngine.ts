import { doc, updateDoc, collection, setDoc, getDocs, getDoc, deleteDoc, increment, arrayUnion } from 'firebase/firestore';
import { db } from './firebase';
import { applyPendingEventsToOfficialMap } from './firestore';
import type { Planet, CombatResult, CombatPhase, Fleet, Game } from './types';

// ─── Planet Generation ────────────────────────────────────────────────────────

const MIN_DISTANCE = 12; // minimum % distance between planet centers

function distance(a: Planet, b: Planet): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function generatePlanets(count: number = 20): Planet[] {
  const planets: Planet[] = [];
  let attempts = 0;

  while (planets.length < count && attempts < 5000) {
    attempts++;
    const candidate: Planet = {
      id: crypto.randomUUID(),
      // x: 5–95% (horizontal margins)
      // y: 12–80% to stay clear of the fixed top HUD (~48px ≈ top 10%)
      //    and the FAB / lobby button area at the bottom (~bottom 15%)
      x: 5 + Math.random() * 90,
      y: 12 + Math.random() * 68,
      owner: null,
      ships: Math.floor(Math.random() * 20) + 1, // 1–20
      productionBase: Math.floor(Math.random() * 20) + 1,
      isHome: false,
    };

    const tooClose = planets.some((p) => distance(p, candidate) < MIN_DISTANCE);
    if (!tooClose) planets.push(candidate);
  }

  return planets;
}

// ─── Home Planet Assignment ───────────────────────────────────────────────────

export async function assignHomePlanet(
  gameId: string,
  uid: string,
  planets: Planet[]
): Promise<string> {
  const unowned = planets.filter((p) => !p.owner && !p.isHome);
  if (unowned.length === 0) throw new Error('No available planets to assign');

  const chosen = unowned[Math.floor(Math.random() * unowned.length)];

  // Update planet in Firestore
  await updateDoc(doc(db, 'games', gameId, 'planets', chosen.id), {
    owner: uid,
    ships: 20,
    productionBase: 15,
    isHome: true,
  });

  return chosen.id;
}

// ─── Ship Cap ────────────────────────────────────────────────────────────────

/** Production never pushes a planet above this. Manual reinforcements can still stack higher. */
export const SHIP_CAP = 100;

// ─── Travel Time Calculation ──────────────────────────────────────────────────

/** Speed: higher = faster travel. At 6, a cross-map trip takes ~15–19 years */
const SPEED = 6;

export function calcTravelTime(from: Planet, to: Planet): number {
  const dist = distance(from, to);
  return Math.max(1, Math.round(dist / SPEED));
}

// ─── Fleet Dispatch ───────────────────────────────────────────────────────────

export async function dispatchFleet(
  gameId: string,
  owner: string,
  fromPlanet: Planet,
  toPlanet: Planet,
  ships: number,
  currentYear: number
): Promise<void> {
  const travelTime = calcTravelTime(fromPlanet, toPlanet);
  const fleetRef = doc(collection(db, 'games', gameId, 'fleets'));

  const fleet: Omit<Fleet, 'id'> = {
    owner,
    fromPlanetId: fromPlanet.id,
    toPlanetId: toPlanet.id,
    ships,
    departYear: currentYear,
    arriveYear: currentYear + travelTime,
  };

  await setDoc(fleetRef, fleet);

  // Deduct ships from source planet (atomic so stacking orders is safe)
  await updateDoc(doc(db, 'games', gameId, 'planets', fromPlanet.id), {
    ships: increment(-ships),
  });
}

const NUM_PHASES = 20;

/**
 * Simulates combat in batched phases for replay.
 * Defenders win each engagement with 2/3 probability.
 * Returns ~20 phase snapshots of remaining ship counts.
 */
export function resolveCombat(
  attackers: number,
  defenders: number
): CombatResult {
  let atk = attackers;
  let def = defenders;
  const totalRounds = attackers + defenders; // upper-bound on rounds
  const roundsPerPhase = Math.max(1, Math.ceil(totalRounds / NUM_PHASES));
  const phases: CombatPhase[] = [];
  let roundsSincePhase = 0;

  while (atk > 0 && def > 0) {
    if (Math.random() < 6 / 10) {
      atk--;
    } else {
      def--;
    }
    roundsSincePhase++;
    if (roundsSincePhase >= roundsPerPhase) {
      phases.push({ atk, def });
      roundsSincePhase = 0;
    }
  }

  // Always push the final state
  phases.push({ atk, def });

  return {
    survivingAttackers: atk,
    survivingDefenders: def,
    attackerWon: atk > 0 && def === 0,
    phases,
  };
}

// ─── Per-Player Turn End ──────────────────────────────────────────────────────

/**
 * Marks a single player as "done" for this year.
 * When ALL players have ended their turn, advances the game year.
 */
export async function endPlayerTurn(
  gameId: string,
  uid: string
): Promise<void> {
  const gameRef = doc(db, 'games', gameId);
  const gameSnap = await getDoc(gameRef);
  if (!gameSnap.exists()) throw new Error('Game not found');

  const game = { id: gameSnap.id, ...(gameSnap.data() as Omit<Game, 'id'>) };
  const updatedTurnEnded = { ...game.turnEnded, [uid]: true };

  // Check if all players have ended their turn
  const allDone = game.players.every((pid) => updatedTurnEnded[pid] === true);

  if (allDone) {
    // Save the turnEnded state, apply pending events, then advance
    await updateDoc(gameRef, { turnEnded: updatedTurnEnded });
    // Flush all battle/colonization results onto official planet docs
    await applyPendingEventsToOfficialMap(gameId);
    await advanceTurn(gameId, game.currentYear);
    // Reset turnEnded for the new year
    const resetMap: Record<string, boolean> = {};
    for (const pid of game.players) resetMap[pid] = false;
    await updateDoc(gameRef, { turnEnded: resetMap });
  } else {
    // Just mark this player as done
    await updateDoc(gameRef, { turnEnded: updatedTurnEnded });
  }
}

// ─── Turn Advancement ─────────────────────────────────────────────────────────

/**
 * Advances the game by one year:
 * 1. Applies production to all owned planets (FIRST — defenders are fully stocked)
 * 2. Resolves arriving fleets — stores results in combatResults / colonizationResults
 *    but does NOT update planet docs (those remain at post-production state)
 * 3. Increments currentYear
 */
async function advanceTurn(
  gameId: string,
  currentYear: number
): Promise<void> {
  const planetsRef = collection(db, 'games', gameId, 'planets');
  const fleetsRef = collection(db, 'games', gameId, 'fleets');

  const [planetsSnap, fleetsSnap] = await Promise.all([
    getDocs(planetsRef),
    getDocs(fleetsRef),
  ]);

  const planets: Planet[] = planetsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Planet, 'id'>),
  }));

  // 1. Production phase FIRST — all owned planets produce before any fleet arrives
  //    Production is capped at SHIP_CAP; manual reinforcements may still exceed it.
  for (const planet of planets) {
    if (planet.owner) {
      const currentShips = planet.ships ?? 0;
      const production = planet.productionBase ?? 10;
      const headroom = Math.max(0, SHIP_CAP - currentShips);
      const actualProduction = Math.min(production, headroom);
      if (actualProduction > 0) {
        await updateDoc(doc(db, 'games', gameId, 'planets', planet.id), {
          ships: increment(actualProduction),
        });
      }
    }
  }

  // 2. Fleet arrival phase — compute results, store records, but do NOT touch planet docs
  const nextYear = currentYear + 1;
  let sequence = 0;
  const arrivingFleets: Fleet[] = fleetsSnap.docs
    .filter((d) => (d.data() as Fleet).arriveYear <= nextYear)
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Fleet, 'id'>) }));

  // Re-read planets after production so battle math uses post-production ship counts
  const postProdSnap = await getDocs(planetsRef);
  // Build a mutable map so sequential fleet arrivals to the same planet stack correctly
  const planetMap = new Map<string, Planet>();
  for (const d of postProdSnap.docs) {
    const p = { id: d.id, ...(d.data() as Omit<Planet, 'id'>) };
    planetMap.set(p.id, p);
  }

  const sortedIds = planets.map((p) => p.id).sort();

  for (const fleet of arrivingFleets) {
    const targetPlanet = planetMap.get(fleet.toPlanetId);
    if (!targetPlanet) continue;

    if (targetPlanet.owner === fleet.owner) {
      // Reinforce own planet — store a ReinforcementRecord, do NOT update planet doc directly
      const newShips = targetPlanet.ships + fleet.ships;
      planetMap.set(targetPlanet.id, { ...targetPlanet, ships: newShips });

      const reinRef = doc(collection(db, 'games', gameId, 'reinforcementResults'));
      await setDoc(reinRef, {
        fleetOwnerUid: fleet.owner,
        planetId: fleet.toPlanetId,
        ships: fleet.ships,
        year: nextYear,
        sequence: sequence++,
        viewedBy: [],
      });
    } else if (targetPlanet.owner === null) {
      // Colonise — store a ColonizationRecord, do NOT update planet doc
      const colonRef = doc(collection(db, 'games', gameId, 'colonizationResults'));
      await setDoc(colonRef, {
        fleetOwnerUid: fleet.owner,
        planetId: fleet.toPlanetId,
        ships: fleet.ships,
        year: nextYear,
        sequence: sequence++,
        viewedBy: [],
      });
      // Reveal the planet for the fleet owner so Canvas can see through fog
      await updateDoc(doc(db, 'games', gameId, 'players', fleet.owner), {
        revealedPlanets: arrayUnion(fleet.toPlanetId),
      });
      // Update in-memory map so subsequent fleets to same planet see new state
      planetMap.set(targetPlanet.id, {
        ...targetPlanet,
        owner: fleet.owner,
        ships: fleet.ships,
      });
    } else {
      // Combat — compute result, store BattleRecord, do NOT update planet doc
      const result = resolveCombat(fleet.ships, targetPlanet.ships);
      const planetIndex = sortedIds.indexOf(fleet.toPlanetId) + 1;

      const combatRef = doc(collection(db, 'games', gameId, 'combatResults'));
      await setDoc(combatRef, {
        attackerUid: fleet.owner,
        defenderUid: targetPlanet.owner,
        planetId: fleet.toPlanetId,
        planetIndex,
        attackerShips: fleet.ships,
        defenderShips: targetPlanet.ships,
        phases: result.phases,
        attackerWon: result.attackerWon,
        survivingAttackerShips: result.survivingAttackers,
        survivingDefenderShips: result.survivingDefenders,
        year: nextYear,
        sequence: sequence++,
        viewedBy: [],
      });
      // Reveal the planet for the attacker so Canvas can see through fog
      await updateDoc(doc(db, 'games', gameId, 'players', fleet.owner), {
        revealedPlanets: arrayUnion(fleet.toPlanetId),
      });

      // Update in-memory map so subsequent fleets to same planet see post-battle state
      if (result.attackerWon) {
        planetMap.set(targetPlanet.id, {
          ...targetPlanet,
          owner: fleet.owner,
          ships: result.survivingAttackers,
        });
      } else {
        planetMap.set(targetPlanet.id, {
          ...targetPlanet,
          ships: result.survivingDefenders,
        });
      }
    }

    // Remove resolved fleet
    await deleteDoc(doc(db, 'games', gameId, 'fleets', fleet.id));
  }

  // 3. Check for game over (one player owns all planets AND no enemy fleets in transit)
  const planetOwners = new Set<string>();
  let unownedCount = 0;
  for (const p of planetMap.values()) {
    if (p.owner) {
      planetOwners.add(p.owner);
    } else {
      unownedCount++;
    }
  }

  let gameOver = false;
  if (planetOwners.size === 1 && unownedCount === 0) {
    const winnerUid = Array.from(planetOwners)[0];
    // Check if any other player still has fleets in transit
    const remainingFleetsSnap = await getDocs(fleetsRef);
    const enemyFleets = remainingFleetsSnap.docs.filter(
      (d) => (d.data() as Fleet).owner !== winnerUid
    );
    if (enemyFleets.length === 0) {
      gameOver = true;
      await updateDoc(doc(db, 'games', gameId), {
        currentYear: nextYear,
        status: 'ended',
        winnerUid,
      });
    }
  }

  if (!gameOver) {
    // 4. Increment year
    await updateDoc(doc(db, 'games', gameId), { currentYear: nextYear });
  }
}
