# Producing Resources (the Labor checkbox)

Laboring is how a character turns a Routine Move into Resources. One
checkbox, one ladder, one gate. The roll happens when the player locks in;
**the ⬢ land at the turn-end push**, like every Move payout since the
staged-arbitration rework (`ADJUDICATION.md`) — the reply says so.

## 1. The ladder

`db/lib/production.js` is the sole source. One field (`labor`), four tiers,
**every tier a `{min,max}` range**:

| Tier | Tag | Per turn |
|---|---|---|
| base | — | 0–2 |
| basic | `laborer-basic` (7 pt) | 2–5 |
| skilled | `laborer-skilled` (5 pt, chains from basic) | 7–9 |
| farming | `laborer-farming` (5 pt, requires skilled) | 18–26, **Town only** |

- `computeRate` scales both ends by `GameConfig.productionCoefficient` and
  returns `{min,max}`.
- `formatRate` is the **only** place the en dash in `"0–2"` is written.
- `rollRate` picks the value.

The two-level `{field: {tier}}` table shape survives with a single field on
purpose: it is what lets `{resource:labor:skilled}` bubbles (tag
descriptions, the Producing Resources document) render live
coefficient-adjusted chips with no web changes, and it is the cheapest place
to add a second production kind later.

### The Butcher bonus and the Soft Hands halving

Two tags modify the ladder. Holding `butcher` adds a flat **+2 to both ends**
of the range, on `base`, `basic` and `skilled` but **not** `farming` — the
bonus is for taking an animal apart, and Farming is the one tier that isn't.
It is applied automatically in `resolveLaborRateFrom`, not left as a line in
the tag description for a GM to remember, so a skilled Butcher rolls 9–11
rather than 7–9.

The +2 is folded into `min`/`max` and **never annotated onto `expression`**.
That string is a machine format, parsed back by
`db/lib/resourceDelta.js#rollResourceRange` against `/^(\d+)-(\d+)$/`; anything
appended to it — `"9-11 (+2 Butcher)"` — fails the regex, and a failed parse
rolls null, which pays the character nothing at all.

Because it is folded in silently, the range alone can't be told apart from a
plain one — which is exactly what once got reported as "Butcher isn't
applying". So `resolveLaborRateFrom` also returns `bonus` on its own, and
`formatLaborBonusNote` renders the one shared `-#` subtext line
(`Includes +2 ⬢ from Butcher.`) that both Labor DMs append: the confirm DM
(`bot/src/lib/moveConfirm.js`, passed `laborBonus` by the submit handler,
since the Action row stores only the finished range) and the Default Move DM
(`db/lib/defaultMovePass.js`).

**Soft Hands is the mirror image.** Holding `soft-hands` **halves both ends,
rounded down**, on every tier including Farming. It lands *after* the Butcher
+2, so it is literally "half the Resources you make" — a Soft-Handed Butcher
on `basic` goes `2–5` → `4–7` → **`2–3`**. It rides the same rails as the
bonus for the same reasons: folded into `min`/`max` rather than annotated onto
`expression`, and returned separately as `halved` so `formatLaborBonusNote`
can say it out loud. That function now takes `(bonus, halved)` and composes
one line for either or both — `Includes +2 ⬢ from Butcher, halved by Soft
Hands.` The Butcher-only wording is unchanged.

The rounding bites hardest at the bottom: `base` is `0–2`, so a Soft-Handed
labourer with no skill tag rolls **`0–1`** and will often earn nothing at all.
That is deliberate, and it is why the tag is worth **−4** rather than −3.
Before 2026-09-02 the tag was pure flavour text that no code read.

Both DMs print the **range** alongside the value —
`**Resource roll (9–11):** +9 ⬢` — and so does the `/character` status panel
(`web/app/components/StatusPanel.js`, which en-dashes the stored expression
itself rather than importing `formatRangeExpression` into a client bundle).
The range has to be there, because two invisible things move the floor: the
Butcher +2 folded in here, and `productionCoefficient` (§1a). A bare `+7 ⬢`
gives a player no way to tell a low roll from a missing bonus, which is the
second time that got reported as "Butcher isn't applying".

### 1a. The coefficient moves the whole ladder

`GameConfig.productionCoefficient` is a live GM dial on `/gm/dev`, and
`computeRate` scales **the tier rate only** — the Butcher +2 is added after,
so it never scales. At `0.7`, a skilled Butcher gets `7–9 ×0.7 = 5–6`, then
`+2`, and rolls **7-8**, not 9–11. Nothing announces the dial to players: the
`{resource:labor:tier}` bubbles in tag descriptions are coefficient-aware
(`web/lib/referenceData.js#getProductionRates`) but carry no Butcher bonus, so
the printed rate is never quite the number anyone actually rolls. That is why
the roll line quotes its own range.

Basic→Skilled is a `parentTag` tier chain (holding Skilled replaces Basic);
Farming is a `requiredTag` sidegrade. `resolveLaborTier` checks highest-first
and re-runs the ladder without the farming rung when Skilled isn't actually
held — so a hand-granted Farming with no Skilled behind it doesn't overpay.

## 2. The gate

`db/lib/laborAccess.js`, same pure-rules/async-context split. Two rules:

- **Nothing can be produced in the depths** — the seat-zone test
  (`seatZoneSlug === "caves"`) folds all three cave levels into one equality.
  Everywhere else works, including an unknown zone (the old "can't herd from
  nowhere" rule died with herding; a null zone simply isn't Town, so Farming
  falls back to Skilled on its own).
- **One Labor per day** — the payout grants the `exhausted` tag
  (`durationTurns: 1`, the `exhausted` entry in `db/lib/moveEffects.js`'s
  `MOVE_EFFECTS`), and the gate refuses anyone holding it. Both payout paths
  run while the labored turn closes, so the tag blocks exactly the next turn
  (one turn is half a day) and the expiry sweep clears it at that turn's
  close. A GM Unsolve reverts the exhaustion along with the ⬢.

A refusal always returns **before** `action.create`, so laboring from the
wrong place never costs the player their turn.

## 3. The checkbox

Laboring is declared on the Move itself — a **Labor** checkbox on the
`move:new` modal (`bot/src/lib/moveModal.js`) and on the web Default Move
panel. There is no command and no text notation anymore: `/labor` and the
`/hunt`-family shorthand are gone, and so is the `+N` / `5-12` embedding a
player could once type into a Move body. A Move description is stored
verbatim.

Rules enforced at submit, each refusing before the Action row exists:

- Labor + Gambit refuses — laboring is Routine work, and stacking guaranteed
  income on a die roll would make the risk free.
- Labor in the depths refuses (§2).
- Labor while Exhausted refuses (§2) — the tag from yesterday's labor is
  still on the sheet.
- Labor + Opposed is legal; Opposed is orthogonal.

On success the resolved range goes into `Action.resourceRollExpression`;
`confirmMove` rolls it and replies `**Resource roll (min–max):** +N ⬢` — the
same pattern as the Gambit die line — followed by the Butcher subtext line
when that bonus is in the range (§1).

## 4. Default Moves

`DefaultEffort.labor` is a real column, not parsed text. The pass
(`db/lib/defaultMovePass.js`) resolves the rate per character in bulk, using
the zone the character stands in **at pass time**. A gated default (asleep
in a cave) still files — they did spend the day trying — but pays nothing,
and carries a `gateNote` into the player's DM.

## 5. What survives of the old notation

`Action.resourceRollExpression`/`resourceRollValue` carry `@map` to their
original SQL column names. `db/lib/resourceDelta.js` is reduced to the
stored-expression half — `rollResourceRange` and `formatRangeExpression` —
because a machine-written `"min-max"` string is still how a labor range
waits to be rolled. A leftover `"1d4*3"` row returns `null` and confirms on
its flat delta rather than throwing.

## 6. Where the code lives

`db/lib/production.js` (rates), `db/lib/laborAccess.js` (the gate + tiers),
`db/lib/resourceDelta.js` (stored ranges), `bot/src/lib/moveModal.js` (the
checkbox), `bot/src/events/interactionCreate.js#handleMoveSubmit` (the
rules), `db/lib/defaultMovePass.js` (defaults).
