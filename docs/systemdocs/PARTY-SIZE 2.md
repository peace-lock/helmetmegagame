# Party thresholds (`{partysize:N}`)

The Cult of Bacchus's four party goals are the only game numbers besides role
seat caps that scale with `GameConfig.playerCount`.

## 1. The table

`db/lib/partySize.js` is the single source: a base table of **4 / 8 / 12 / 16
per 100 players**, scaled live. Raising the player-count dial on `/gm/dev`
retargets every goal without touching a line of prose.

## 2. The math is deliberately not `roleCapacity`'s

`db/lib/roleCapacity.js` sits right next to it and does neither of these. Don't
"fix" one into the other.

- **It floors rather than rounds.** A party threshold is a bar you clear, and
  rounding up would make a 50-player game's first goal 3 rather than the 2 that
  "4 per 100, rounded down" means.
- **It keeps `roleCapacity`'s `Math.max(1, …)` clamp**, for `roleCapacity`'s own
  reason: below 25 players `floor` yields 0, and a tier needing nobody would
  unlock itself the moment it was authored.

Tiers are **1-indexed** at every boundary — `{partysize:1}` is the first goal —
over a 0-indexed table.

## 3. How the number reaches a player

As a `{partysize:N}` inline token in `docs/documents.yaml`, resolved exactly the
way `{resource:field:tier}` is:

1. `/api/party-sizes` ships each tier pre-formatted as `display`. It is
   `force-dynamic`, unlike the production-rates route, since `playerCount` is a
   live dial.
2. `PartySizeProvider` fetches it once per page load into context.
3. The three renderers turn it into a `PartySizeChip`.

`PartySizeChip` deliberately carries **no `⬢`** — a party threshold is a count
of people, not a currency.

**Nothing hardcodes a party size in prose.** `docs/threats.md` describes the
ladder and points here rather than printing numbers that would go stale.

## 4. Adding another token kind

The parser in `web/app/components/richTokens.js` is kind-agnostic, so a new
token kind never touches it or `remarkTokens.js`. The edit surface is exactly
three renderers: `RichText.js`'s `BUBBLE_KINDS` map, and the hardcoded
if-chains in `ChipText.js` and `DocumentMarkdown.js`. See `TAGS.md` §5.

## 5. Where the code lives

| Concern | File |
|---|---|
| The table and the math | `db/lib/partySize.js` |
| The sibling that rounds differently | `db/lib/roleCapacity.js` |
| Server-side reference data | `web/lib/referenceData.js` (the old `/api/party-sizes` route folded into it) |
| Context | `PartySizeProvider` |
| Chip | `web/app/components/PartySizeChip.js` |
| Token parser | `web/app/components/richTokens.js` |
| Prose | `docs/documents.yaml`, `docs/threats.md` |
