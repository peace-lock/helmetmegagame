// How big a Faction's silo starts, computed from its roles' weights instead
// of hand-authored per faction in docs/roles.yaml. Scales with
// GameConfig.playerCount the same way seat caps do (db/lib/roleCapacity.js),
// so a smaller or bigger game gets proportionally sized silos without anyone
// re-tuning docs/roles.yaml by hand.
//
// Used by db/lib/syncRoles.js (both the create-time seed and the opt-in
// re-seed) and its CLI entry (db/scripts/sync/sync-roles.js --seed-silos).

// User-picked constant — see the "Silos" section of the laboring-rework plan
// for the approximated 100-player numbers this produces (Town 32, Court 28,
// Watch 19, each Windlands clan 13, everything else floored at 10).
const SILO_SEED_K = 1.6;

const SILO_SEED_FLOOR = 10;

// A role's weight for silo-seeding purposes: its own numeric `weight` (the
// raw docs/roles.yaml value), `weight: unlimited` counted as 5 (an uncapped
// seat pulls in the most people), and a seat with no weight at all
// (single-seat/leader roles) counted as 1.
function roleWeight(role) {
  if (typeof role?.weight === "number") return role.weight;
  if (role?.weight === "unlimited") return 5;
  return 1;
}

// max(10, round(totalWeight * K * playerCount / 100)).
function factionSiloSeed(totalWeight, playerCount) {
  return Math.max(SILO_SEED_FLOOR, Math.round(totalWeight * SILO_SEED_K * playerCount / 100));
}

module.exports = { roleWeight, factionSiloSeed };
