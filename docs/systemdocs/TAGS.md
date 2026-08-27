# Tag catalog

How the `Tag`/`TagGroup` catalog is structured, master-sourced, and synced.
Not to be confused with `CharacterTag` (an individual character's *holding*
of a tag) or `Location.tags` (free-text flavor strings on a Location,
unrelated to this system).

## 1. Category -> Group -> Tag

Three levels:

- **Category** — a flat string (`Meta`, `General`, `Skills`, `Status`,
  `Items`, `Assets`, plus the two hidden ones, `Demoness` and `Bacchus`).
  Not its own DB table; `docs/tags.yaml`'s top-level `categories:` list is
  validation-only — `syncTagsFromYaml` rejects any tag/group whose
  `category` isn't in that list. Because a category has no row of its own, a
  **hidden** category isn't a category-level field either: it's a group-level
  `requiredTag` on the one group that category contains (§3a). **Items are the portable
  half and Assets the standing half**: a revolver or a meal you carry and
  hand over, versus a Manor, a House, or a Follower you simply have. There is
  deliberately no third `Companions` category — the property-vs-companion
  split inside Assets is carried by the `assets-property` /
  `assets-companions` groups, which keeps `TRANSFERABLE_CATEGORIES` (Transfer
  Tag's filter, `web/lib/tagRequests.js`) a two-item list.
- **Group** (`TagGroup`) — optional, scoped to exactly one category, exists
  purely to color tags for display (e.g. Status's Health/Food/Buffs/Debuffs
  groups). A tag with no group renders uncolored. `TagGroup.color` is a
  freeform hex string (e.g. `"#6fa8ab"`), rendered directly by `TagChip.js`
  — not theme-aware, so pick a value that reads on both the dusk and dawn
  backgrounds. One group, `status-health`, is deliberately **empty**: the
  Health category (§5c) took every tag that used to live in it. Groups sync
  upsert-only and are never deleted, so the row survives; don't reuse the slug
  and don't put anything back in it.
- **Tag** — the catalog entry itself.

## 2. Master sources: `docs/tags.yaml` and `docs/taggroups.yaml`

`docs/tags.yaml` holds categories and tags; `docs/taggroups.yaml` holds the
`TagGroup` catalog (split into its own file so group colors can be freeform
hex rather than a fixed token set). Same posture as `docs/locations.yaml`:
hand-edited, `slug` is the stable match key across syncs, and syncing is
**upsert-only** — removing an entry from either YAML never deletes its row,
it just stops receiving updates. `db/lib/syncTags.js#syncTagsFromYaml(prisma)`
reads both files and does the sync, run by hand via `npm run db:sync-tags`
(`db/prisma/sync-tags.js`) or automatically at the end of `wipeGameData`'s
"Restart Game" flow (`web/app/(app)/gm/dev/actions.js`), right after
`syncLocationsFromYaml`.

The sync is five passes, since tags/groups can reference each other by slug
before every row necessarily exists yet: TagGroup scalars, then Tag scalars
+ `groupId`, then `parentTag`/`requiredTag` links, then `TagGroup.requiredTag`
links, then `requirement.skills`. (`consumesInto` is the exception — it is
validated up front against the YAML's own slug set, before any write, so a
typo fails cleanly instead of half-applying.) Each pass only writes a row when something actually changed (a
diff check, same style as `syncLocationsFromYaml`'s `needsUpdate`).

## 3. Two relations that look similar but aren't

- **`parentTag` (tier chain)** — sequential, replacing. Fighting (Basic) ->
  Fighting (Trained) -> Fighting (Skilled) -> ... Acquiring a tier is meant
  to replace the previous one on the character, not stack alongside it. Also
  used where a specialization *is* the base thing rather than a second copy of
  it: `Follower (Cook)`/`(Laborer)`/`(Goon)` all chain off `Follower`, so
  picking one gives you a follower who cooks — not a follower plus a cook.
- **`requiredTag` (prerequisite)** — non-replacing. The character must
  already hold `requiredTag`, but acquiring this tag does **not** remove or
  replace it. Example in the catalog: `Fighting (Archer)` requires
  `Fighting (Basic)` but coexists with `Fighting (Skilled)` — a character can
  hold both at once. Also the right relation for an origin/membership gate the
  gated tag doesn't consume: `Windlander (Horse)` requires `Windlander`,
  `Manor` requires `Courtier`, `House`/`Shack` require `Ravenhearter`, and the
  `Laborer (…)` specializations require `Laborer` — those stack, several
  specializations on one Laborer, each charged once.
- **`TagGroup.requiredTag`** — the group-level version of the same
  prerequisite: every tag in that group stays gated behind one required tag,
  so a whole category-of-flavor can be hidden behind a single membership tag
  without repeating `requiredTag` on every tag in it. See §3a.

`web/lib/characterCreation.js` is where the logic lives.
`holdsRequirement(requiredTagId, …)` answers "is this one id satisfied by
anything held or selected, at any tier of its chain"; `requirementSatisfied`
calls it for **both** `tag.requiredTagId` and `tag.group.requiredTagId`, and
is the only place the two are combined. `chainOf`/`cumulativeCost`/
`effectiveCost` price a `parentTag` chain as the sum of its hops, and
`chainSiblingsToRemove` collapses a selection down to one member per chain
(the tiers **below** a pick, since `chainOf` only walks upward), and
`heldHigherTiers` is its downward mirror — the held tiers **above** a tag,
i.e. "is this a downgrade". A chain replaces upward and never re-opens
downward: buying or adding a higher tier **deletes the held lower tier in
the same transaction** (the store's `buyTags` and `addTagRequest` both do
this), and every purchase path rejects a tier below one already held. The
removed tier is snapshotted onto the request's `effect.replaced`, so a GM
Undo restores exactly what came off — see `web/lib/requestEffects.js`.

Enforced in five places, all reading those same helpers: `PointBuy.js`
(creation and `/store`), the Add Tag picker in `TagRequestButtons.js`
(mid-game), `createActions.js` and `requestActions.js#addTagRequest` (the
server-side re-checks, since both menus are advisory), and
`web/lib/referenceData.js#getVisibleTags` (§3a). **A GM grant still ignores
both, deliberately** — a GM handing out a tag is the one path that should
never be second-guessed.

Every caller must select `group.requiredTagId` alongside `requiredTagId`.
Miss it and a hidden category silently opens for everyone, with nothing to
show that it has.

## 3a. Hidden categories, and gated groups

Two whole categories are secret: **Demoness** (behind the `demoness` tag) and
**Bacchus** (behind `follower-of-bacchus`, displayed as "Cultist of
Bacchus"). Each contains exactly one `TagGroup` carrying the `requiredTag`,
which is where the whole mechanism lives — the tags inside deliberately do
**not** repeat `requiredTag`, so the gate is written once.

The same field also gates a group **inside a visible category**, which is how
body membership is modelled: `general-watch` ("The Watch", behind `watchman`)
and `general-brigand` ("Brigands", behind `brigand`) sit in `general`, so the
General tab stays because `general-traits` and `general-social` are ungated —
only the group vanishes. Same rule about not repeating the gate on the members.

Note where the two keys live: `watchman` and `brigand` are in
`general-traits`, **outside** the groups they open. A gated group cannot hold
its own key — nobody would ever be able to see it. Both are
`purchasable: false` and arrive from `roles.yaml` `starting_tags`, which is
also why the Add Tag picker has to fold held tags into its `byId` map (below).

Three things make a category actually hidden rather than merely empty:

- **The tabs are derived after the filter, not before.** `unlockedTags()`
  runs first and `menuCategories()` reads its output, so a fully-gated
  category has *no tab*. It used to be the other way round, which left a tab
  reading "Nothing available in this category" — an advertisement.
  `unlockedTags` takes a `keepIds` list for the menu's current picks, since
  selecting a tag doesn't satisfy that tag's own requirement and it would
  otherwise vanish under the cursor.
- **The Add Tag picker folds the character's held tags into its `byId` map.**
  The catalog it gets is purchasable-or-craftable only, so the tags that
  *open* a gate (both are `purchasable: false`, GM-assigned) aren't in it —
  without the fold, the chain walk dead-ends and the category stays shut for
  the one person meant to see it.
- **`getVisibleTags` withholds them.** That loader
  (`web/lib/referenceData.js`, streamed through `TagsProvider` from
  `layout.js`) is the app-wide tag catalog `RichText`/`TagChip` read, and
  its `/api/tags` predecessor used to be unauthenticated and complete,
  so the whole Demoness catalog was one DevTools tab away. It resolves
  the caller's own character and drops any tag whose group is gated. Gating
  is on the **group** gate only, never a tag's own `requiredTag`: Fighting
  (Archer) isn't a secret, and hiding it would break `{tag:fighting-archer}`
  in public documents for everyone who hasn't bought it.

## 4. The point economy

`pointCost` is the price in the point-buy menu, and it is **signed**:
positive costs the player points, negative *grants* them (the drawbacks,
Old at `-2` and Frail at `-3`). Both directions fall out of one subtraction,
so `remaining >= 0` is the only rule for whether a build is legal.

**The display inverts it, and both axes agree.** `formatCost`/`costColor`
(`web/lib/characterCreation.js`) show the effect on the player's *point
pool*, never whether the tag is a good thing to have:

| tag | `pointCost` | shown as | colour |
|---|---|---|---|
| Frail | `-3` | `+3 pts` | `--positive` (pool grows) |
| Fighting (Basic) | `2` | `-2 pts` | `--accent` (pool shrinks) |
| Shack | `0` | `0 pts` | `--muted` |

These two functions are the only place that flip lives — every caller
(`TagChip`, `PointBuy`, `TagRequestButtons`, `CreateCharacterWizard`) passes
the raw signed `pointCost` and lets them decide, so nothing else should ever
negate it. The arithmetic is untouched: `PointBuy`'s affordability check and
`remaining = budget - sum(pointCost)` both still read the raw catalog value.

Before this, the sign was catalog-style while the colour was pool-style, so
Frail read as "`-3`, in green" — two conventions disagreeing on one line.

A character's budget is
`GameConfig.startingTagPoints` (default 12) `+ role.extra_starting_points`
`- 3 if the player is Cursed`, computed by
`web/lib/characterCreation.js#computeBudget`. Anything unspent is kept on
`Character.tagPoints`.

`purchasable` gates whether a tag can ever be bought — role-granted identity
tags (Courtier, Chaplain, Nobility) are `false`, so they arrive with the role
and never through the menu.

`purchasableAfterStart` splits the two menus that share
`web/app/components/PointBuy.js`: character creation offers every
`purchasable` tag, while the mid-game store offers only those still marked
`purchasableAfterStart`. That's what lets a pick like "Secretly an Android"
exist at launch and never afterward. **Every negative-cost tag must be
`purchasableAfterStart: false`** — a drawback buyable mid-game is a point
farm.

That invariant has three enforcement points. `purchasableTags()` honours it
via `PointBuy`'s `afterStartOnly` prop, which **`/store`** mounts — the
mid-game store is routed (`web/app/(app)/store/`), spends
`Character.tagPoints`, and files each cart as one `BUY_TAGS` request
(`REQUESTS.md`). Its server action `buyTags` re-checks the flag per tag,
rejects a tier at or below one already held (`heldHigherTiers` /
`effectiveCost`), replaces the held lower tier when a higher one is bought
(§3), and refuses any negative effective cost — the store never pays the
buyer. The **Add Tag request** is
the other mid-game path, for crafting and resource-acquisitions:
`addableTags()` (and `addTagRequestImpl` server-side) require
`purchasableAfterStart` on the **purchasable branch only**, because most
craftables are deliberately `purchasableAfterStart: false` (43 of 58 — meals,
tonics, explosives): they are made rather than bought, and their gate is the
`requirement` block instead. No drawback is craftable, so nothing slips
through that seam.

The two mid-game paths deal in different currencies and coexist on purpose:
the store spends Tag Points against catalog prices with no GM in the loop
until review; Add Tag spends turns, skills and ⬢ against a `requirement`
block. Armor and weapons showing up under Add Tag is the crafting economy,
not a store leak.

Full writeup of creation, roles, and the wizard: `CHARACTERS.md`.

## 4a. The price scale

**This is the canonical scale. Price a new or repriced tag against it, not
against whatever its neighbours in the file happen to cost.** The catalog
drifted for 260 tags precisely because the scale was unwritten, and the
inconsistencies that turned up on the first pass against it — a revolver at 4
points, Starting Wares at 4 while consuming into 7 points of goods — were the
kind that only look wrong once there is something to check them against.

The scale is **absolute across categories**. A 3-point item and a 3-point
skill are meant to matter about equally, so "expensive for an item" is not a
reason to price one at 5.

| `pointCost` | Band |
|---|---|
| 1 | Minor. A small edge, a small possession, a narrow competence. |
| 2 | Moderate. A real capability; one rung of a skill chain. |
| 3 | Significant. Reliably changes how a scene goes. |
| 4 | Good. A third of the default budget. |
| 5 | Very good. |
| 6 | Character defining. The revolver; Giant. |
| −1 | An inconvenience. |
| −2 | A real cost, situational. |
| −3 | A real cost, most of the time. |
| −4 | Severe. Permanent or near-permanent. |
| −5 | Removes a whole sense or capability, with no realistic cure. |

6 is the ceiling and −5 the floor; nothing should be priced outside them
without a deliberate decision recorded here.

**A character's bought drawbacks may give back at most
`GameConfig.maxDrawbackPoints` points in total — 6 by default, live on
`/gm/dev`.** This is a point total, not a count of tags: one severe drawback
(`-4`) plus an inconvenience (`-1`) is a legal `+5` build under the default
cap, and so is five minor `-1`s. Only what was bought through the point-buy
menu counts (`CharacterTag.source === "POINT_BUY"`): a role's free drawback
(the Meister's Frail, the Headman's Old) arrives as `GM_GRANT`, and so does
anything a GM or a turn effect inflicts, so neither spends any of a player's
budget. A GM grant can still push someone past the cap, deliberately — the
same bypass every other gate has (§3).

The cap has three surfaces. `PointBuy.js` sums it live in the build pane
(`drawbackCap` / `drawbackHeld`), dims a drawback that would *cross* the
limit the same way it dims an unaffordable tag — a pick that stays at or under
the cap still clicks — and, like the budget, lets a click that goes over
through anyway so the pane can say why the build isn't legal.
`CreateCharacterWizard` folds it into `canAdvance` beside `remaining >= 0`.
`createCharacter` re-checks it server-side, because a server action is a
public endpoint. `/store` shows the same line as a **readout only**: every
drawback is `purchasableAfterStart: false`, so the shelf never offers one and
the total can't move there. `drawbackPoints()` in
`web/lib/characterCreation.js` is the shared predicate, over raw `pointCost`
rather than `effectiveCost` — a drawback never sits in a tier chain, so there
is nothing to discount.

**0 is a real price, not a missing one**, and it is the most common value in
the file (142 of 268). Everything unpurchasable — injuries, moods, meals,
role grants — is 0, and every tag must carry the field explicitly. A tag with
no `pointCost` at all is a bug; `intercom` was the one instance and is fixed.

### Rules that follow from the scale

- **Skill chains are flat 2 per rung and charged cumulatively**
  (`cumulativeCost`, §3). Do not price a rung off-ladder to make a chain
  cheaper; shorten the chain.
- **Fighting is the one exception — 3 per tag, rungs and sidegrades alike.**
  The Combat Update raised every Fighting tag to 3. Rungs are still
  cumulative, so Fighting (Legendary) is 15 — unreachable from a 12-point
  creation budget by design; you climb into it in play. Sidegrades (Archer,
  Guerrilla, Shield Wall, Grappler, Firearms, Duelist) use `requiredTag`, so
  they are *not* cumulative and stack with each other and with any rung.
- **Combat items ride a fixed six-tier ladder.** Weapons and armor are priced
  from the tier they sit in, not by feel. See
  [`SMITHING.md`](SMITHING.md) for the table.
- **Every negative tag is `purchasableAfterStart: false`.** Restated from §4
  because it is the one invariant the scale can be used to violate: a
  drawback buyable mid-game is a point farm.
- **Items are `purchasableAfterStart: false` too**, without exception. An
  object enters play by being crafted or found; its route in is `craftable`
  plus a `requirement` block, never points. 18 items violated this before the
  first pass against the scale.
- **A consumable is worth what it consumes into.** If `consumesInto` grants
  7 points of tags, the container is not a 4-point tag.
- **Health-category `pointCost` is not a wound severity.** It answers "what is
  this worth at character creation" — 0 for almost all of them, since they are
  not purchasable. What the condition costs to *treat* is the `requirement`
  block, priced off the seven-rung cure ladder in §5c, which is a separate
  scale that must not be conflated with this one.
- **A skill's price is not adjusted for how much content gates on it.**
  `crafting` (2) gates 3 items where `smithing` (2) gates 23. Both stay at 2;
  the fix for that imbalance is content, not price. Noted here so the gap
  reads as known rather than accidental.

`docs/tag-design.md` is the player-facing statement of this same scale,
written for whoever is drafting entries. It carries the YAML format and
worked examples; this section is the one that governs. **If you change a band
here, change it there too** — they are meant to say the same thing.

## 5. Other fields

- `visibleOnInspect` — shown to another player who 🔍-reacts to this
  character's proxied messages (`bot/src/events/messageReactionAdd.js`).
  Defaults closed. Note it is a property of the tag being *seen*. The two
  tags that widen what an inspect shows are read off the **inspector**
  instead: Seductive reveals the subject's active Desire and Torturer their
  Fear, resolved by `db/lib/inspectVision.js`, which also accepts the
  discounted Demoness twins of each. Like the Silo-gated Resources field, an
  unseen field is absent rather than placeholdered — a placeholder
  advertises that there is something to go after.
- `tradeable` — Items-category flag for a future trade flow; no transfer
  logic exists yet (Transfer Tag filters on `category`, not this).
- `stackable` — whether a character can hold more than one at a time. Live
  code reads this; see §5a.
- `defaultDurationTurns` (spelled `durationTurns` in the YAML) — catalog-level "how many turns does this last once
  granted," for tags that auto-expire (e.g. Drained is 3). The actual
  per-instance expiry lives on `CharacterTag.expiresTurn` (an absolute turn
  number, computed from this default at grant time), swept by
  `resolveNeeds()` in `db/index.js` once the closing turn's number reaches
  it. Live code reads this — Mood (2) and Hunger (1) both compute their
  `expiresTurn` as `turn.number + defaultDurationTurns` — so it is no longer
  catalog-only. Note the ordering it implies: `resolveNeeds()` sweeps *before*
  the Hunger pass grants, so a still-broke character's Hunger is cleared and
  re-granted rather than colliding with `@@unique([characterId, tagId])`. See
  `REQUESTS.md` §4.

  **Every grant path must stamp `expiresTurn`.** The sweep matches
  `expiresTurn <= turn.number`, and `null` never matches — so a timed tag
  granted without a stamp is *permanent*, no matter what `durationTurns` says
  in the YAML. `web/lib/turnFormat.js#expiryFor(tag, openTurn)` is the one
  place that arithmetic lives; use it rather than open-coding
  `turn.number + defaultDurationTurns` again. This was a real bug: `grantTag`
  on `/gm/dev` and `addTagRequest` both left it null, so a GM-granted
  Paralyzed sat on the sheet forever while its tooltip advertised "Lasts 1
  turn".

### How a duration is displayed

`web/lib/turnFormat.js#tagDuration(left, defaultDurationTurns)` is the single
source for both the chip badge and the tooltip row, so the two can never
disagree. `left` is `turnsLeft()` for a held `CharacterTag`, and `null` for a
bare catalog reference (a `{tag:…}` in prose has no `CharacterTag` behind it).

| State | Tooltip row | Chip badge |
|---|---|---|
| Held, counting down | `2 turns left` | `· 2t` |
| Held, final turn | `Expires this turn` | `· last` |
| Catalog reference | `Lasts 1 turn once granted` | `· 1t` |
| No duration at all | *(row omitted)* | *(none)* |

Two details are deliberate. **"once granted"** is what separates a catalog fact
from a live countdown — without it the same tag read two different ways
depending on how it happened to be granted, which is exactly the confusion this
replaced. And the final turn reads **`last`, never `0t`**: the tag is still
active on that turn, so a zero contradicted the tooltip beside it.

`formatTagRequirement` spells its turns out (`1 turn`, not `1t`) for the same
reason — an unlabelled `1t` meaning *turns of work to cure* sat in the same
panel as a `1t` meaning *turns remaining*.

Both formatters are hand-duplicated as `db/lib/turnFormat.js` and
`db/lib/formatTagRequirement.js` for the bot's 🔍 inspect embed, the same
convention as `buildNickname`. Change both copies together; don't collapse them
(the web copies must stay dependency-free so client components can import
them).
- `removable` — whether a player can strip this tag off themselves mid-game
  without a GM. Live: it is the whole filter behind the Remove Tag menu
  (`removableTags()`, `web/lib/tagRequests.js`) and is re-checked by
  `removeTagRequest`.
- `craftable` — whether this tag represents something a player can
  craft/make, as opposed to one that only ever arrives via role, GM grant,
  or automatic game logic. Live too: `addableTags()` offers Purchasable *or*
  Craftable tags in the Add Tag menu.
- `consumable` / `consumesInto` — whether a player can use this tag up, and
  what it becomes. Live; see §5b.
- `expiresInto` — what this tag becomes when its `durationTurns` runs out,
  instead of simply being swept away. Live; see §5c.
- `requirementTurns` / `requirementResources` / `requirementGambit` /
  `requirementSkills` (YAML: nested under `requirement:` as `turnsCost` /
  `resourceCost` / `gambit` / `skills`) — what it costs a character to add
  or remove this tag in play (e.g. curing Arthritis needs Medical (Skilled)
  and some turns; forging the revolver tag costs turns, resources, and
  Smithing). `requirementSkills` is a many-to-many self-relation onto `Tag`
  (multiple skill tags accepted), resolved in `syncTags.js`'s pass 5. This
  is mostly a GM adjudication reference, shown to players, with one
  exception: the Heal request (`HEAL_CHARACTER`, REQUESTS.md §5c) enforces
  the *removal* direction on `Status` tags — `requirementResources` is the ⬢
  it charges and `requirementSkills` is what the medic must hold (any
  equal-or-higher tier up the `parentTag` chain counts). Turns and Gambit
  stay reference-only everywhere, as do all four in the adding direction.
  One shared block covers whichever direction (add or remove) is
  narratively relevant to a given tag, rather than separate blocks per
  direction. Rendered everywhere a tag's description already renders, in a
  minified form, via `formatTagRequirement()` (`db/lib/formatTagRequirement.js`,
  exported from `@lifeweb/db`) — see `TagChip.js`, `PointBuy.js`, and the
  🔍-inspect embed in `bot/src/events/messageReactionAdd.js`.

## 5a. Stacks

Meals, ammunition, anything a crafting Move makes in a batch — a character
needs to hold four Fine Meals and hand them out one at a time. `stackable:
true` in `docs/tags.yaml` sets `Tag.stackable`; the count lives on
`CharacterTag.quantity` (default `1`).

**A stack is one row carrying a count, never N rows.**
`@@unique([characterId, tagId])` stays exactly as it was, which is the whole
point: every presence check in the codebase — `narrowcastAccess.js`,
`gambitModifier.js`, `mood.js`, `labor.js`, the Mortus nav gate — keeps
reading "holds it or doesn't" with no change, and `restoreCharacterTag`'s
upsert stays valid.

Three functions in `web/lib/requestEffects.js` are the only writers that know
about `quantity`; everything else goes through them:

| | |
|---|---|
| `addToStack(tx, characterId, tagId, n, opts)` | create-or-increment. Pins `n` to 1 unless `opts.stackable`, so a caller that forgot to check can't mint a phantom stack. |
| `dropCharacterTag(tx, characterId, tagId, n)` | decrement, deleting the row at 0. `n = null` (the default) drops the whole holding — what an ordinary tag always wants. |
| `restoreCharacterTag(tx, characterId, snapshot)` | undo's inverse. **Increments** on the update branch: `snapshot.quantity` is what the request took away, not what the character should end up holding. |

Add Tag, Remove Tag and Transfer Tag all carry a quantity, clamped
server-side to what the sender actually holds, and record it on
`Request.effect` so Undo stays an exact inverse (`REQUESTS.md` §2). A GM's
Revoke button takes one unit off a stack rather than the whole larder.

**Point-buy never stacks.** `PointBuy.js` is a toggle-set with no quantity
anywhere, so a bought tag lands on `quantity`'s default of 1 and a stackable
tag cannot be point-farmed at creation. Stacks are built in play only.

**`stackable` combines safely with `durationTurns`.** It didn't used to —
the sweep deleted whole rows, stack and all — but `sweepExpiredStacks()`
(`db/index.js`) now sheds a single unit per expiry and rerolls the
remainder's timer, deleting the row only when the last unit goes. So three
of a two-turn tag lose one every two turns.

## 5b. Consuming

`consumable` marks a tag a player can **use up** from their own character
sheet, and `consumesInto` (a list of tag *slugs*) is what it turns into. A
meal is `consumable` with `consumesInto: [ate-meal]`; `ate-meal` carries
`durationTurns: 1` and the Hunger pass consumes it — so the whole chain falls
out of machinery that already existed. Nothing here is meal-specific: the one
rule that *is* about meals (a Fine Meal cheers everyone but a noble) is
expressed as catalog data in `docs/tags.yaml`, not as code.

Five rules carry it:

- **Always exactly one unit.** Consuming from a stack of three meals takes
  one, so there is deliberately no quantity field in this path at all.
- **Slugs, not a relation, specifically so a slug may repeat.** Listing one
  twice is the only way to ask for two of something — and that only
  multiplies for a `stackable` target; a non-stackable repeat collapses to
  one, exactly like §5a's rules elsewhere.
- **A granted tag starts its own clock.** `expiresTurn` is computed as
  `turn.number + defaultDurationTurns` at the moment of the grant — the same
  absolute-turn expression every other writer uses — which is what makes
  chains work (meal -> Ate Meal that the sweep then clears).
- **An already-held non-stackable grant is left completely alone**, expiry
  included: the character's existing one is the live truth, and clobbering it
  would silently extend or cut short something they already had. One
  consequence worth knowing: eating a Lavish Meal while already Happy does
  *not* extend Happy, unlike `setMoodRequest`, which deletes and re-creates the
  tag and so refreshes its clock. Undo depends on `added: 0` meaning "this
  request didn't grant it", so a refresh here would need its own snapshot.
- **A grant may be conditional.** A `consumesInto` entry can be an object
  rather than a bare slug, and is then granted only to a character holding
  *none* of its `unlessTags`:

  ```yaml
  consumesInto:
    - ate-meal
    - slug: happy
      unlessTags: [nobility]
  ```

  `Tag.consumesInto` still stores every target slug in order; the conditions
  live beside it in `Tag.consumesIntoUnless` (`Json`, null for the many tags
  that have none), and `syncTags.js` validates both halves against this file.
  `resolveConsumeGrants()` in `web/lib/consumeGrants.js` applies them, and is
  deliberately pure so the server action and the client "Becomes:" preview
  share it — a preview that promised a noble the Happy they won't get would be
  worse than no preview. Fine Meal is the only conditional entry today:
  it cheers an ordinary person, while Nobility expect one as a matter of
  course.
- **A grant may override the target's expiry.** The same object form takes an
  optional `durationTurns`, which replaces the granted tag's own
  `defaultDurationTurns` for that grant only:

  ```yaml
  consumesInto:
    - happy
    - slug: high
      durationTurns: 3
  ```

  This exists because one status can mean different things depending on what
  produced it. Raw Cave Fungus leaves you High for 2 turns; Bliss, which
  is Cave Fungus properly worked, leaves you High for 3. The alternative —
  `high-2` and `high-3` as separate tags — pushes an implementation detail
  into the player-facing catalog and multiplies with every future drink.

  It is stored in a second sidecar, `Tag.consumesIntoDurations` (`Json`,
  `{ "<slug>": N }`, null for almost every tag), resolved by the same
  `resolveConsumeGrants()` and applied by `grantTagSlugs()`, which prefers the
  override and falls back to the tag's own duration. An override on a target
  that has no duration of its own is legal and simply gives it one — but never
  point one at `ate-meal`, which is deliberately never swept because the
  Hunger pass consumes it explicitly.

Consuming is a **Request** (`CONSUME_TAG`), so it lands immediately, carries
a reason, and a GM can Undo it — see `REQUESTS.md` §3. The undo snapshot
records what was *actually* added per slug (`added: 0` for a grant that was
skipped as already-held), because Undo may only take back what this request
really put there.

`grantTagSlugs()` in `web/lib/requestEffects.js` is the single writer, a
fourth sibling to the three stack primitives in §5a.

**This replaced the old `grantsOnExpiry` field**, which did the same
conversion on a timer instead of on demand: letting a player choose *when* to
unpack a crate is strictly better than making them wait a turn.

`expiresInto` (§5c) is **not** that field coming back, and the distinction is
worth holding onto, because "two near-identical tag-becomes-other-tags
mechanisms" was the exact objection that killed the old one. The difference is
who decides. `consumesInto` is an action a player takes and is filed as an
undoable Request; `expiresInto` is what happens *to* them on the clock,
whether or not anyone wanted it, and is the whole reason an untreated wound is
frightening. A crate you open is not a wound that opens you. Both exist
because those are genuinely different things — but a new field that could be
written either way belongs in `consumesInto`, which is the one a player can
see coming and a GM can take back.

## 5c. Health, the cure ladder, and `expiresInto`

Health is its own **category**, split out of Status. Status is the mood/needs
layer — Hungry, Drained, Tipsy, the moods, all of it granted and cleared by
machinery — while Health is a system with its own pricing, its own
progression, and its own visibility rule. Seven groups carry it:
`health-wounds`, `health-infection`, `health-illness`, `health-maiming`,
`health-mind`, `health-minor`, `health-recovery`. They split by what **kind**
of medicine an affliction wants, never by how bad it is; severity is carried
by the requirement block instead.

### The cure ladder

Every Health tag is priced off one of eight rungs. **Pick a rung and copy its
block. Do not invent numbers.** The whole point of a ladder is that a player
learns it once and can then read any affliction they meet.

| Tier | Reads as | ⬢ | turns | skill | Gambit |
|---|---|---|---|---|---|
| 0 | Untreatable | — | — | — | — |
| 1 | Very minor — first aid | 1 | 0 | Basic | no |
| 2 | Minor | 2 | 0 | Basic | no |
| 3 | Moderately severe | 2 | 1 | Skilled | no |
| 4 | Severe | 4 | 1 | Skilled | no |
| 5 | Very minor surgery | 6 | 1 | Skilled | no |
| 6 | Severe surgery | 8 | 1 | Expert | no |
| 7 | Complex surgery | 8 | 1 | Expert | yes |

Four things about it are deliberate.

**The top three rungs are the surgical ones, and they carry the whole
balance.** A Serpent closes an arterial bleed and cuts away dead flesh without
rolling — that is tier 5, and it is all the surgery they get. Anything that
means opening a chest or a belly is Esculap's work at tier 6; a Serpent may
still attempt it, but they roll. Tier 7 is the rung even Esculap rolls for,
which is why it shares tier 6's price: what separates the two is the Gambit,
not the bill. Only eleven tags sit above tier 5, and that scarcity is the point —
Esculap's time should be a thing players negotiate over.

**Realism sets the rung, not severity.** Severity and duration matter, but the
question that decides a tier is *what would it actually take a person to fix
this*. A dislocated shoulder is agonising and completely disabling, and it is
tier 1, because someone who has done it before puts it back in a moment. That
is why the table's left column is written as a description of the *work*
rather than of the injury.

**Tier 0 is a rung, not an omission.** Something realistically untreatable,
quick, and harmless — Vomiting, a Migraine, a Concussion, being Hungover —
gets **no `requirement:` block at all**. `hasCureCost()`
(`web/lib/healRequests.js`) keys off exactly that, so a tier-0 tag never
appears in the Heal picker and the action refuses it. This is a design rule
before it is a mechanic: charging a player 2 ⬢ and a doctor's afternoon to
shorten a bout of vomiting is silly, and pretending medicine can do it is
worse.

**Above your tier is still possible.** Nothing about the skill requirement
stops a player from *trying* — it is a Gambit, and a failed Gambit can leave
the patient worse than it found them. The requirement names what a character
does **as routine**, which is why the three Medical descriptions are phrased
that way and why the Medical document says so outright. A Serpent
(Medical (Skilled)) can attempt the tier-6 surgery a punctured lung needs;
they just roll for it, while Esculap (Medical (Expert)) does not.

Only `requirementResources` and `requirementSkills` are enforced — by the Heal
request, which charges the ⬢ and checks the tier chain. `requirementTurns` and
`requirementGambit` stay GM adjudication reference, as everywhere else (§5).

### `expiresInto`

An ordinary timed tag is swept away when its `expiresTurn` comes due. One
carrying `expiresInto` turns **into** something else on the way out. This is
the untreated-wound chain, and it is the thing that makes a doctor worth
finding:

```
Infected ──3t──▶ Festering ──2t──▶ Feverish ──2t──▶ Sepsis ──2t──▶ Dying
                     └────2t────▶ Necrosis ──2t──▶ Missing Leg *or* Missing Arm
```

The YAML takes a bare slug, several slugs granted together, or an even random
pick:

```yaml
expiresInto: [festering]                    # one
expiresInto: [feverish, necrosis]           # both, at once
expiresInto:
  - oneOf: [missing-leg, missing-arm]       # a coin flip
```

`syncTags.js` normalises every entry to `{ oneOf: [...] }` — a bare slug is a
pick of one — so the stored `Tag.expiresInto` Json, the pass, and `TagChip`'s
"Becomes" row all handle a single shape. It validates three things **before
writing anything**:

- every slug exists in `docs/tags.yaml`;
- the tag has `durationTurns` ≥ 1, or nothing would ever fire it;
- **a tag may not list itself.** The grant happens one statement before the
  sweep that deletes the expired row, so a self-loop would be re-granted and
  immediately deleted, doing nothing. A recurring condition is written as a
  **two-tag loop** instead: Migraine expires into No Migraine, which expires
  back into Migraine, forever. That cycle is deliberate and there is no
  cycle detection beyond the self check.

`db/lib/tagExpiryPass.js` applies it, inside `resolveNeeds()` and **before**
the sweep — the sweep is a blind `deleteMany`, so afterwards there is nothing
left to read (`TURN-ENGINE.md` §2). The pass grants and never deletes. Four
rules match the ones §5b lists for consuming, for the same reasons:

- **A successor a character already holds is left completely alone**, its own
  clock included (`skipDuplicates`). Re-granting would silently reset a
  condition they were most of the way through.
- **A successor starts its own clock**, `turn.number + defaultDurationTurns`,
  the same absolute-turn expression every other writer uses. A successor with
  no catalog duration is granted permanent — which is what Dying, Missing Leg
  and Scarred all want.
- **Nothing can fire twice in one pass.** Every duration is at least 1 and the
  sweep matches `expiresTurn <= turn.number`, so a tag granted while closing
  turn N cannot also expire on turn N.
- **A dead character's sheet stops moving.** Their rows still get swept; they
  just don't progress into anything.

**Nothing in the pass kills anyone.** Every terminal chain lands on the
`dying` tag and stops there. A turn advance that can silently end someone's
month-long game with no human in the loop is not a trade this game wants —
`dying` is permanent, visible, and carries a tier-7 cure so a heroic save is
still on the table. A GM confirms the death by hand through the existing path
(`web/app/(app)/gm/turns/actions.js`).

### Visibility, and the doctor's eye

`visibleOnInspect` on a Health tag is a question about **realism, not
severity**: could a bystander tell? A gaping wound, a missing arm, Paralyzed
and Severe Burns are obvious. Appendicitis, cracked ribs, parasites, chronic
pain and Shell Shocked are not, and are `visible: false`.

That would make the internal cases invisible to the one person who should
notice them, so there is a second rule: **if you could treat it as routine,
you can see it.** `db/lib/medicalVision.js#medicallyVisibleTags` unions the
subject's `visibleOnInspect` tags with the Health tags the *inspector* is
qualified for, and the 🔍 embed marks the second kind `· your diagnosis` —
because the patient isn't showing it to the room, and a medic who repeats it
as common knowledge has said something nobody else could know.

Routine is doing real work in that sentence. A tag whose cure needs a Gambit
stays hidden **even from an Expert**, since guessing isn't diagnosing; and a
tier-0 tag has no `requirementSkills` at all, so it is nobody's professional
business. The skill-tier walk (`buildSkillAncestry`/`satisfiedSkillIds`) lives
in `db/lib/medicalVision.js` rather than `web/lib/healRequests.js` precisely
so the bot's inspect and the web's Heal request cannot drift on the question
of who is qualified; `healRequests.js` re-exports it.

### Adding a health tag

1. Pick the group by what kind of medicine it wants.
2. Pick a ladder rung by what the work would really take, and copy its block
   verbatim. Tier 0 means no `requirement:` at all.
3. Set `visible` by whether a bystander could tell.
4. If it worsens, give it `durationTurns` and `expiresInto` — **and say so in
   the description**, naming what it becomes. The tooltip's "Becomes" row is
   reinforcement; the sentence is what makes someone act in time.
5. Negative `pointCost` (a drawback bought at creation) requires
   `purchasableAfterStart: false`, per §4.
6. `npm run db:sync-tags`.

## 5d. GM-authored tags

A tag can also be written in the UI, at `/gm/dev/tags`, instead of in
`docs/tags.yaml`. Such a row carries `Tag.custom = true` and lives only in the
database.

The two halves of the catalog behave differently on purpose:

|  | From `docs/tags.yaml` | GM-authored |
|---|---|---|
| Editable in the UI | No — the next `db:sync-tags` would revert it | Yes |
| Touched by `db:sync-tags` | Upserted every run | Never (the sync is keyed by slug and has no entry for it) |
| Touched by `db:prune-tags` | Deleted if unreferenced and no longer in the YAML | Never — skipped explicitly |
| Deletable in the UI | No | Superadmin only, and only if nothing references it |

**Slugs are generated, never typed**: `custom-${slugify(name)}`. A GM naming a
tag "Arthritis" would otherwise collide with the YAML slug, and the next sync
would upsert straight over their row — silently converting their homebrew into
a YAML tag and clobbering every field. The prefix also guarantees a custom slug
can never appear in the prune script's YAML slug set by accident.

What a GM can set is the tag's own behaviour — cost, category, group,
description, and the `stackable`/`equippable`/`consumable`/`removable`/
`purchasable`/`visibleOnInspect` flags plus a duration. What they cannot set is
catalog *structure*: `parentTag`, `requiredTag`, `requirementSkills` and
`consumesInto` all wire tags to each other, and that belongs in the YAML where
it can be reviewed alongside the tags it connects.

## 6. Things that used to be tags and aren't anymore

`Leader` and `Treasurer` were retired as tags in the same rework that
introduced this system (and were finally removed from `docs/roles.yaml`'s
`starting_tags` too, in favor of per-role `leader:`/`treasurer:` booleans) — both are now plain booleans on `Character`
(`isLeader`, `isTreasurer`), assigned dynamically by a GM (Leader) or by a
GM/the faction's own Leader (Treasurer) from `/faction`
(`web/app/(app)/faction/actions.js`), exactly as before — only the storage
mechanism changed, not who can assign what. `Courtier` survived too, and still gates `Manor` via that tag's `requiredTag` (§3). `Mortus` survived the
"Role" category's retirement as an ordinary General tag since it drives real
logic elsewhere — it gates `/lifeweb` nav visibility. `Hunter` survived
alongside it for the same reason, but has since been retired: hunting joined
the Laborer ladder, so the production-tier check in `bot/src/lib/labor.js`
reads `laborer-hunting` like every other specialisation and no `hunter` entry
remains in `docs/tags.yaml`.

## 7. Where the code lives

`db/lib/syncTags.js` (the sync itself), `db/prisma/sync-tags.js` (terminal
entry point, `npm run db:sync-tags`), `docs/tags.yaml` /
`docs/taggroups.yaml` (content), `web/lib/referenceData.js#getVisibleTags`
(the catalog backing `{tag:slug}`/`{tag:id}` references, and the gate from
§3a),
`web/app/components/RichText.js`/`TagsProvider.js`, `TagChip.js` (the
hover-tooltip chip that renders group color, and the "Becomes" row from §5c),
`db/lib/inspectVision.js` (Seductive/Torturer, §5),
`db/lib/medicalVision.js` (the cure-skill walk and the doctor's eye, §5c),
`db/lib/tagExpiryPass.js` (the `expiresInto` progression, §5c), and
`web/lib/healRequests.js` (what a medic may treat, `REQUESTS.md` §5c).

**Tag descriptions carry `{tag:…}`/`{resource:…}`/`{partysize:…}` tokens
too**, not just documents — that's how a True Form names the {tag} it inflicts. The three
places a description renders all forbid an *interactive* chip, though: a
`TagChip` nested in a hover tooltip could never be hovered to reach its own
tooltip, and the point-buy / Add Tag rows are `<button>` elements. So they
render through `ChipText.js`, which resolves the same tokens to a plain
`ChipLabel`. `RichText.js` stays the full-fat renderer for prose the reader
can point at (documents, a character's appearance). Both share the parser in
`richTokens.js` — which exists in its own file precisely because `RichText`
renders `TagChip` and `TagChip` renders `ChipText`, so importing one from
the other would close an import cycle.

There are four token kinds. `{tag:slug|id}` and `{resource:field:tier}` are
described above; `{partysize:N}` is the Cult of Bacchus's party thresholds
(`PARTY-SIZE.md`), a 1-indexed
tier resolving to a headcount scaled live by `GameConfig.playerCount`; and
`{document:key}` names another paper by its `Document.key` (`DOCUMENTS.md`),
rendering as a chip that links to it. The
parser in `richTokens.js` is kind-agnostic — `{(\w+):([^}]+)}` — so a new kind
never touches it or `remarkTokens.js`. What a new kind *does* touch is the
three renderers, which is the whole edit surface: `RichText.js`'s
`BUBBLE_KINDS` map (the only real dispatch table), and the hardcoded if-chains
in `ChipText.js` and `DocumentMarkdown.js`'s `RichTokenRenderer`. Miss
`ChipText` and the token renders literally in a tag tooltip and in the
`/documents` card preview; miss `DocumentMarkdown` and it renders literally in
an open document. Every kind falls through to the raw `{…}` text when it can't
resolve, so a bad reference is visible rather than silently dropped.

A kind whose data the browser doesn't already hold also needs a read API and a
provider mounted in `layout.js`, the way `{tag:…}` has `getVisibleTags` +
`TagsProvider`. `{document:…}` is the case to copy if the data is
access-controlled: `/api/documents` ships every document's *name* but a body
only to a reader who may open it, so a chip for a paper you have not been
handed renders inert rather than either vanishing or leaking.

`hunger`, `hungerless` and `ate-meal` are the first tags granted and consumed
by automatic game logic rather than by a player, a GM, or a starting package —
`db/lib/hungerPass.js` is their only writer, and `db/lib/gambitModifier.js`
their only reader. `db/lib/constants.js` holds the slugs so neither file
hardcodes a string. The Health chain (§5c) is the second such system, and it
deliberately holds **no** slugs in `constants.js`: the whole chain is catalog
data, so `tagExpiryPass.js` never names a tag and a new chain needs no code
at all.

## `equippable` / `concealsIdentity`

`equippable: true` marks a tag as something a character can wear or carry
readied, and so occupies one of `GameConfig.equipSlots` (default 6). The state
lives on `CharacterTag.equipped`, not on a join table: equipping is a property
of holding the tag, so `@@unique([characterId, tagId])` stays and every
"holds it or doesn't" check in the codebase is unaffected. A `stackable` tag
takes one slot however many units are held.

`CharacterTag.equipped` is **cleared on death** — `killCharacter` runs an
`updateMany` over the corpse's held tags. A corpse doesn't wield things, and
a Revive later shouldn't walk back in with gear locked to slots that may
have moved. It also keeps the loot panel (`CHARACTERS.md` §5) from rendering
an item as if it's still worn.

`concealsIdentity: true` marks gear that hides who the wearer is — a mask, a
hood, a closed helm. It is currently **inert**: `/conceal` is open to every
character with nothing equipped (`PROXYING.md` §5), and the field is kept only
so that gate can be restored without a migration. It is only meaningful
alongside `equippable`, and `syncTagsFromYaml` **throws** if it is set without
it rather than syncing a tag that could never do anything — the kind of quiet
failure that is miserable to debug from inside the game.

Neither field interacts with `visible` (`Tag.visibleOnInspect`), which does
double duty here: a concealed character's 🔍 embed lists only their
`visibleOnInspect` equipped gear and their `visibleOnInspect` health statuses,
so a hidden cuirass stays hidden even while worn.

### The equipment panel

`EquipmentPanel.js` on `/character` is **click-to-toggle**, not drag-and-drop —
drag would need a touch fallback that is exactly this anyway — and is its own
surface rather than an affordance on `TagChip`, whose click already opens the
Consume dialog.

Equipping is **instant and writes neither a `Request` nor an `AuditLog` row**,
unlike everything in `REQUESTS.md`. It costs nothing, the player undoes it in
one tap, and at 100+ players a row per toggle would drown `/gm/audit`.

`toggleEquip` (`web/app/(app)/character/equipActions.js`) resolves the character
from the session rather than trusting a posted id, re-checks `tag.equippable`,
and counts the slots inside a transaction — **but the count alone is not
sufficient.** Prisma runs at READ COMMITTED, so two tabs both read the same free
slot and both write. The transaction opens with

```sql
SELECT id FROM "Character" ... FOR UPDATE
```

which serializes equips per character. Without it, a burst of 8 concurrent
equips all land against a cap of 6 (verified).
