import { doc, updateDoc, collection, setDoc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Planet, CombatResult, Fleet } from './types';

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
      // Keep planets within 5–95% so they don't hug the edge
      x: 5 + Math.random() * 90,
      y: 5 + Math.random() * 90,
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
    productionBase: 20,
    isHome: true,
  });

  return chosen.id;
}

// ─── Travel Time Calculation ──────────────────────────────────────────────────

/** Speed: 1 unit of distance = 1 year of travel */
const SPEED = 1;

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

  // Deduct ships from source planet
  await updateDoc(doc(db, 'games', gameId, 'planets', fromPlanet.id), {
    ships: fromPlanet.ships - ships,
  });
}

// ─── Combat Resolution ────────────────────────────────────────────────────────

/**
 * Simulates combat: each attacker fights one defender.
 * Defenders win each engagement with a strict 2/3 (66.6%) probability.
 */
export function resolveCombat(
  attackers: number,
  defenders: number
): CombatResult {
  let atk = attackers;
  let def = defenders;

  while (atk > 0 && def > 0) {
    // Roll for one engagement
    if (Math.random() < 2 / 3) {
      // Defender wins this round
      atk--;
    } else {
      // Attacker wins this round
      def--;
    }
  }

  return {
    survivingAttackers: atk,
    survivingDefenders: def,
    attackerWon: atk > 0 && def === 0,
  };
}

// ─── Turn Advancement ─────────────────────────────────────────────────────────

/**
 * Advances the game by one year:
 * 1. Applies production to all owned planets
 * 2. Resolves fleets that arrive this year
 * 3. Increments currentYear
 */
export async function advanceTurn(
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

  // 1. Production phase
  for (const planet of planets) {
    if (planet.owner) {
      await updateDoc(doc(db, 'games', gameId, 'planets', planet.id), {
        ships: planet.ships + planet.productionBase,
      });
    }
  }

  // 2. Fleet arrival phase
  const nextYear = currentYear + 1;
  const arrivingFleets: Fleet[] = fleetsSnap.docs
    .filter((d) => (d.data() as Fleet).arriveYear === nextYear)
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Fleet, 'id'>) }));

  for (const fleet of arrivingFleets) {
    const targetPlanet = planets.find((p) => p.id === fleet.toPlanetId);
    if (!targetPlanet) continue;

    // Re-read freshest ship count after production
    const tPlanetSnap = await import('firebase/firestore').then(({ getDoc }) =>
      getDoc(doc(db, 'games', gameId, 'planets', fleet.toPlanetId))
    );
    const freshPlanet = { id: tPlanetSnap.id, ...(tPlanetSnap.data() as Omit<Planet, 'id'>) };

    if (freshPlanet.owner === fleet.owner || freshPlanet.owner === null) {
      // Reinforce: same owner or unowned
      const newOwner = freshPlanet.owner ?? fleet.owner;
      await updateDoc(doc(db, 'games', gameId, 'planets', fleet.toPlanetId), {
        ships: freshPlanet.ships + fleet.ships,
        owner: newOwner,
      });
    } else {
      // Combat!
      const result = resolveCombat(fleet.ships, freshPlanet.ships);
      if (result.attackerWon) {
        await updateDoc(doc(db, 'games', gameId, 'planets', fleet.toPlanetId), {
          ships: result.survivingAttackers,
          owner: fleet.owner,
        });
      } else {
        await updateDoc(doc(db, 'games', gameId, 'planets', fleet.toPlanetId), {
          ships: result.survivingDefenders,
        });
      }
    }

    // Remove resolved fleet
    await import('firebase/firestore').then(({ deleteDoc }) =>
      deleteDoc(doc(db, 'games', gameId, 'fleets', fleet.id))
    );
  }

  // 3. Increment year
  await updateDoc(doc(db, 'games', gameId), { currentYear: nextYear });
}
