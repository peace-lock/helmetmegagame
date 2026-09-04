// Party-size thresholds for the Cult of Bacchus's party goals, shared by
// /api/party-sizes (feeds {partysize:N} in docs/documents.yaml) and anything
// else needing this number, so a Cultist's brief and a GM's adjudication
// can't drift.
//
// Base value per 100 players, scaled live by GameConfig.playerCount (same
// posture as roleCapacity.js). Uses Math.floor — a threshold to clear, not a
// seat count — with a Math.max(1, ...) floor so a tier can't unlock at 0.
//
// Tiers are 1-indexed ({partysize:1} is the first goal) over a 0-indexed array.
const PARTY_SIZES_PER_HUNDRED = [4, 8, 12, 16];

function partySize(tier, playerCount) {
  const perHundred = PARTY_SIZES_PER_HUNDRED[tier - 1];
  if (perHundred == null) return null;
  return Math.max(1, Math.floor((perHundred * playerCount) / 100));
}

// The display half lives beside the math for the same reason formatRate and
// formatCapacity do: the string form has one implementation. A party size is
// a headcount, so it deliberately carries no ⬢ — that glyph is Resources
// only (see the Resources glyph section of CLAUDE.md).
function formatPartySize(value) {
  return value == null ? null : String(value);
}

// The tier numbers a caller may ask for, so a route enumerating them never
// re-declares the length of the table.
const PARTY_SIZE_TIERS = PARTY_SIZES_PER_HUNDRED.map((_, i) => i + 1);

module.exports = { PARTY_SIZE_TIERS, partySize, formatPartySize };
