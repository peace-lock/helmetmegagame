# Characters: creation, roles, and death

How a player gets a character, what the point-buy economy is, and what
happens when that character dies — plus the four-field name and the two locks
on creation. Companion to `TAGS.md` (the tag catalog), `CHANNELS.md` (the
Discord channel/permission layout) and `PROXYING.md` (nicknames and personal
roles).

## 1. The shape of it

A player signs in and lands on `/character`. If they have no `ALIVE`
character — brand new to the server, or their last one died — that page
renders the **creation wizard** instead of a character sheet. There's no
separate `/character/new` route; one URL, no redirect bounce.

The wizard has six steps:

1. **Role** — the role list, grouped Zone → Faction → Role, with live seat
   counts.
2. **Tags** — the point-buy menu.
3. **Identity** — a title (only what the build has *earned* — see §1c), a
   required first name and an optional last name.

   **Identity comes third, after Role and Tags, and has to.** A title is
   earned from the role taken and the tags held, so there is nothing to offer
   until both are picked. It also fixes the dynasty surname, which is locked
   by the role: while Identity ran first, `lastNameLocked` was read before the
   role that sets it existed, so the input could not be locked in time.

   Age is optional here (18–90). Left blank, it stays editable on `/character`
   until the player saves a number, and locks at that point — a GM can still
   correct it afterwards. It feeds the Young/Old half of a concealed alias
   (`db/lib/concealedIdentity.js`).

   A displayed name is four fields joined by
   `db/lib/characterName.js#formatCharacterName` as
   `Sir Jorren "the Blind" Vask`. The fourth, `title`, renders in quotes
   between the names and is **GM-only** — it has no input in the wizard, and
   the character sheet shows it disabled with a "make your case to a GM"
   tooltip. `Character.name` remains as a denormalized mirror of the join.
   See §1b.
4. **Fear** — the character's Worst Fear. **Optional**: `canAdvance` is
   unconditionally true on this step, so a player may walk straight past it and
   name one later from `/character`. See `REQUESTS.md` §5b.
5. **Antagonists** — twelve checkboxes, all off, naming the antagonist seats a
   GM hands out in secret (Succubus, Cultist, the Judge…). Pure consent data:
   nothing in the game reads `Character.antagonistOptIns`, grants from it or
   gates on it — it exists so a GM choosing who receives one can tell who is
   willing. Also **optional** — ticking nothing is a real answer, so
   `canAdvance` is unconditionally true here too.

   Opt-in rather than opt-out deliberately: a player who clicks through without
   reading has consented to nothing. It is **creation-only** — the list is set
   here and `updateCharacterProfile` never reads the key, the same lock `title`
   uses. There is no GM read/edit surface yet; the values just land on the row.
   The catalog is `db/lib/antagonists.js` (alphabetized, so catalog order *is*
   display order), and `normalizeAntagonistSlugs` is the server-side allowlist —
   a server action is a public endpoint, so the checkboxes are UX and that
   function is the boundary.
6. **Confirm** — a summary, then `createCharacter`.

## 1b. Names

A displayed name is **four fields**, joined by
`db/lib/characterName.js#formatCharacterName`:

```
Sir Jorren "the Blind" Vask
 |    |         |        |
 |    |         |        `-- lastName   String?  optional, player-editable
 |    |         `----------- title      String?  GM-ONLY, renders in quotes
 |    `--------------------- firstName  String   required, player-editable
 `-------------------------- honorific  String?  a title the character EARNED
```

`honorific` is **earned, not chosen** — see §1c.

`title` is the opposite: set **only** from `/gm/dev/characters/[characterId]`.
The character sheet shows it as a `disabled` input with a "make your case to a
GM" tooltip — but the greying is not the lock. A disabled input submits nothing,
and `updateCharacterProfile` never reads the key. It does have to feed the row's
*existing* `title` back into `formatCharacterName`, or a player saving their bio
would silently strip a title a GM had granted.

### `Character.name` is a denormalized mirror

Same posture as `Character.zoneId` (`ARCHITECTURE.md` §6). It's what ~60 readers
want — `orderBy`, `select: { name: true }`, the `/gm/audit` `contains` search,
the proxy webhook username — and Prisma cannot concatenate columns in
`orderBy`/`contains`, so dropping it would force search and sort into
`OR`-over-three-columns for correctness nobody can see.

Keeping it also means the never-backfilled name snapshots
(`Note.characterName`, `SiloTransaction.actorName`/`toName`,
`ArchiveEntry.characterName`, `AuditLog.details`) capture the titled form with
no code change — correct, since those record who did something *as they were
known then*.

**Exactly four writers** keep it honest, and every one goes through the
formatter:

| Writer | When | Title gate |
|---|---|---|
| `character/createActions.js` | Creation | `normalizeEarnedHonorific` |
| `web/lib/characterWrite.js` | GM raw edit, from the dev panel | `normalizeHonorific` (ungated) |
| `web/lib/dynasty.js#propagateDynastyLastName` | The Baron renaming his house | **none — see §1c** |
| `character/requestActions.js#changeNameRequestImpl` | Drinking a Mulligan Potion | `normalizeEarnedHonorific` |

A fifth must do the same. `npm run db:backfill-name-parts` is the drift check
that catches one that doesn't.

### A name is immutable — with one sanctioned exception

There is **no ordinary player-facing rename.** A name is chosen once, in the
creation wizard, and after that `character/actions.js#updateCharacterProfile`
ignores `honorific`, `firstName` and `lastName` outright — the three inputs on
`/character` render `disabled`, but as always the disabled input is the hint
and the server action is the lock. The rest of the Bio form (appearance,
avatar, opt-ins) is untouched.

The sanctioned exception is the **Mulligan Potion** (`docs/tags.yaml`),
consumed by a `CHANGE_NAME` request (`REQUESTS.md` §3): the player picks a new
honorific/first/last name, it applies immediately in the same transaction
that spends the potion, and a GM can Undo it from `/gm/turns` like any other
request. It re-validates the same allowlist/cap/dynasty-lock rules every other
writer of `Character.name` enforces, and runs the same lightweight Discord
fan-out `updateCharacterProfile` used to (`ensureCharacterRole`,
`syncCharacterNickname`, and `propagateDynastyLastName` if the renamer is the
Baron) right after the transaction commits — best-effort and outside it, same
posture as every other request that touches Discord. `REQUESTS.md` §3 has the
one gap worth knowing: Undo reverts the database but not Discord, which
catches up on the player's next Bio save.

### `NAME_LIMITS` (10/24/20/20)

Not cosmetic. Discord caps a webhook username at 80 characters and the proxy
sends `name` as-is, so the **inputs** are capped instead and the composed name
is ≤79 by construction. Both form-fed writers — creation and the GM dev panel
— apply the caps and the title allowlist server-side; both of those forms are
public endpoints. The longest title is 9 characters (Professor, Constable), so
the 10-char cap holds with the catalog as it stands.

## 1c. Titles are earned

`db/lib/titles.js` is the catalog: one frozen table mapping a **word** to the
tags and roles that grant it, and to what the word says about its wearer.

| Word(s) | Earned from |
|---|---|
| Sergeant | tag `sergeant` |
| Constable | tag `watchman` |
| Captain | role `captain` |
| Sir / Dame / Ser | tag `knighted` |
| Lord / Lady / Noble | tag `nobility` |
| Baron / Baroness | roles `baron` / `baroness` |
| Father / Mother / Reverend | tag `chaplain` |
| Brother / Sister / Sibling | tag `mortus` |
| Bishop | role `bishop` |
| Doctor | tag `medical-skilled`, roles `esculap` `serpent` |
| Professor | role `scholastic` |
| Master | roles `metalsmith` `innkeeper` `headman` |

Overlap is deliberate: the `bishop` role grants the `chaplain` tag, so a
Bishop may style themselves Father, Mother or Reverend instead. Same for
Captain (grants `watchman`) and Baron/Baroness (grant `nobility`). **Most of
Ravenheart is untitled** — a peasant earns nothing, and the picker says so
rather than showing an empty control.

Three of these hang off *purchasable* tags (`sergeant`, `knighted`,
`medical-skilled`), so those titles can be bought with points — but each sits
behind a membership gate already (`general-watch` needs `watchman`,
`general-court` needs `courtier`), so nobody buys a title cold.

### One table, two questions

The same `gender` column on each entry decides what `/conceal` calls you and
which name pool Randomize draws from. That used to be two `MAN`/`WOMAN` arrays
in `db/lib/concealedIdentity.js` that had to be edited in lockstep with the
word list — and the guard meant to catch a drift,
`assertHonorificsCovered()`, could never fire: its condition was
`!MAN.includes(h) && !WOMAN.includes(h) && genderWord(h) !== "Person"`, which
is unsatisfiable, since `genderWord` returned `"Person"` exactly when the
first two held. `assertTitlesResolve(prisma)` replaces it, runs at the end of
`db:sync-roles` (after tags, per `SYNC.md`), and actually fails on an unknown
slug.

Rank and profession say nothing about their wearer, so Captain, Doctor and
Master are **neutral** and a concealed Master reads "a young person". Every
gendered set carries a neutral third (Ser, Noble, Sibling, Reverend) so nobody
has to pick a side to be styled at all.

### Losing the tag does not strip the title

A knight who is stripped of `knighted` **keeps wearing "Sir"**. The picker
stops offering the word, so changing away is a one-way door, and only a GM can
put it back or take it off from `/gm/dev/characters/[characterId]`.

That rule is why **only three call sites may normalize a title**, and each
uses the right one:

- `normalizeEarnedHonorific(value, { tagSlugs, roleSlug })` — the two paths
  where the player is *choosing* a title: creation and the Mulligan rename.
- `normalizeHonorific(value)` — membership in the catalog only, no earning
  check. The GM dev panel, matching `TAGS.md` §3's rule that a GM grant is
  never second-guessed. It is also the escape hatch for a title nobody can
  re-select.

Anything else that happens to touch the name must **not** revalidate.
`web/lib/dynasty.js#propagateDynastyLastName` composes straight through
`formatCharacterName` for exactly this reason: if it normalized, every time
the Baron renamed his house it would silently strip the honorific of any
family member who had since lost their granting tag.

Retired with this change: Mr., Mrs., Ms. (a courtesy register that said
nothing about a character) and Marshal (a rank with no seat behind it).
**Master survives**, repurposed from a courtesy word into the craft-master's
title and re-read as neutral.

### Age

`Character.age` (18–90, nullable) follows the same shown-but-locked posture as
`title`, from the other direction: it is the player's to set, **but only once**.
While null the `/character` input is live; the moment a number is saved it
renders `disabled` with an `InfoIcon`, and `updateCharacterProfile` refuses to
overwrite a non-null age however the form is posted. The disabled input is the
hint, not the lock. The wizard takes it optionally, and a GM can always correct
it. Read by `db/lib/concealedIdentity.js` for the Young/Old half of a concealed
alias (`PROXYING.md` §5).

### The dynasty last name

`lastName` is the player's own **except for the Baron's house**. The four Court
seats — `baron`, `baroness`, `heir`, `successor` — are one family, so the Baron
chooses the dynasty name and the other three inherit it: their last name is
never read from a form they posted.

- `db/lib/dynasty.js` (pure, in the barrel) — the slug list and two predicates.
- `web/lib/dynasty.js` — the prisma/Discord half. `dynastyLastName()` reads the
  living Baron (the seat is `multiple: false`, so `findFirst` is exact);
  `propagateDynastyLastName()` restamps the family.

The lock lives in both remaining form-fed writers, GM raw edit included, keyed
on **the role being saved** — so moving someone into a family seat renames them
in the same write. The greyed-out inputs are the hint, not the lock. (Since the
self-service edit no longer writes names at all, a player's own form cannot
reach `lastName` by any route.)

Two consequences worth keeping: a family member created before any Baron exists
simply has no last name until he rolls up; and propagation runs only after a
Baron *write*, never on his death, so a widowed house keeps the name it was
given until a new Baron overwrites it.

`propagateDynastyLastName` fires `ensureCharacterRole` + `syncCharacterNickname`
per renamed character, since the bare name feeds both. **No `AuditLog` row** —
the rename is a consequence of the Baron's own edit, which is already logged.

### Bare names, and sorting

Two surfaces deliberately use the **bare** name (`formatBareName`, first +
last): the personal Discord role's name and colour seed, and the Discord
nickname (`PROXYING.md` §8). The role is an `@`-mentionable access-control
primitive rather than an RP surface, and seeding the colour off the bare name
means granting or changing a title never renames or recolours anyone.

`orderBy: { name: "asc" }` on a Character would file `Sir Jorren` under S, so
the seven Character-model sites use
`[{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }]`. Most
`orderBy: { name }` in the codebase is on Faction/Zone/Tag/Location and is
untouched — **check the model before changing one.** The client-side
`characterName` sort in the GM tables still sorts the titled string, which is
fine: those tables are searched far more than sorted, and the search matches
the same string.

## 2. Roles

`docs/roles.yaml` is the master. `db/lib/syncRoles.js#syncRolesFromYaml`
(`npm run db:sync-roles`) reads its `zones[].factions[].roles[]` nesting into
the `Zone`/`Faction`/`Role` tables, matched by `slug`.

**A role's two prose fields go to different places.** `intro` is the one-line
pitch in the creation picker. `description` is a `String[]` of plain sentences
that a player reads as their **role charter**, pinned first in `/documents`'s
Assigned tab (`DOCUMENTS.md` §2) — joined into a Markdown bullet list there,
one bullet per YAML line. It is plain prose: no Markdown, no `{tag:…}` tokens
in any of the 49 today, and the charter renderer does not promise either.

Worth knowing because it was written and synced for every role and **rendered
nowhere at all** until that card existed — an edit to `description` used to
reach no one.

**Threats are not in `roles.yaml`.** Sympathizer, the Demoness, the Cult of
Bacchus, the Judge, the NPC monsters, the Brigands — those seats are assigned
by hand by a GM and must never appear in the player-facing picker, so they are
prose in `docs/threats.md` rather than data. They used to sit in
`zones[].threats[]`, carrying a full role's worth of fields that no sync ever
read.

It replaced the old `db/lib/factionSync.js`, which read the same file but
only ever used faction `name`/`parent`/`starting_resources`.

### Seat caps

`db/lib/roleCapacity.js#roleCapacity(role, playerCount)` is the single source
of the cap, shared by the picker, the server action, and the GM panel:

| YAML | Column | Cap |
|---|---|---|
| `multiple: false` | `isUnique` | exactly 1, at any game size |
| `weight: unlimited` | `unlimited` | uncapped (`Infinity`) |
| `weight: N` | `weight` | `max(1, round(N * playerCount / 100))` |

`weight` reads as *seats per 100 players*, so `GameConfig.playerCount` is the
live dial: set it to 120 on `/gm/dev` and every weighted role widens by 1.2×.
`multiple: false` is deliberately **not** "1 per 100" — the Baron stays one
Baron in a 300-player game.

A role at capacity renders disabled. That's advisory only: `createCharacter`
re-counts **inside the transaction that creates the character**, so when two
players sit on the last Baron seat and both hit Confirm, the second one gets
told to pick again.

### The Leader Whitelist

A role with `leader: true` needs the **Leader Whitelist** Discord role
(`LEADER_WHITELIST_ROLE_ID` in `db/lib/roleIds.js`, checked by
`web/lib/discordGuild.js#isLeaderWhitelisted`). Without it the card renders
disabled, exactly like a role at capacity, and with no explanation — the
reservation is explained once in `#info`, not repeated on every card.

Same shape as every other gate here: the disabled card is presentation, and
`createCharacter` re-checks before it writes. Superadmins bypass.

The requirement can also be turned off for the whole game:
`GameConfig.leaderWhitelistEnabled` is a Dev Panel switch, **on** by default.
Off, every player may take a Leader seat and the Discord role stops mattering —
both the card and `createCharacter` read the same flag, so a hand-posted request
gets in too. It is on by default because the gate fails closed; a missing config
row still enforces it.

### Playtest mode

`GameConfig.playtestModeEnabled` is a second Dev Panel switch, **off** by
default, that holds part of the roster back for a short test: the **Merchant**
(unfinished) and **every role in the Windlands**. Their cards still render, just
disabled, carrying a "closed for this playtest" chip — a locked role is still
worth reading. Nothing is removed from `docs/roles.yaml`, so flipping the switch
off restores the roster with no sync.

Which roles it covers lives in `web/lib/characterCreation.js`
(`PLAYTEST_LOCKED_ROLE_SLUGS`, `PLAYTEST_LOCKED_ZONE_NAMES`), not in the
database. The Merchant is matched by `Role.slug`; the Windlands are matched by
**zone name**, because nothing marks a role as a Windlander one — `Role` and
`Faction` carry no availability column, and the zone holds three separate clan
factions. `Zone` has no slug, so renaming the zone in `roles.yaml` means moving
that list with it.

Same presentation/enforcement split as everything else here: the card is a
hint, `createCharacter` re-checks. One difference — **a superadmin does not
bypass this one.** The other gates are reservations, so the host walks through
them to roll a test character; this one hides an unfinished role, and bypassing
it would only let the host roll the broken thing.

The GM surfaces are untouched: `/gm/dev/characters/[characterId]` will still
assign a locked role by hand.

### The starting package

Picking a role decides almost everything:

- `factionId` — from the role's faction.
- `locationId` + `zoneId` — from `starting_location` (a Location **slug**).
  This is what gives the character their Discord channel access; see §5.
- `resources` — `starting_resources`.
- `isLeader` / `isTreasurer` — from `leader: true` / `treasurer: true`.
  These were once entries in `starting_tags`; they're booleans on
  `Character`, not Tags (`TAGS.md` §6).
- `starting_tags` — granted free, as `CharacterTag` rows with source
  `GM_GRANT`, on top of anything bought.

The sync **throws** on a `starting_tags` name that isn't in the catalog or a
`starting_location` slug that isn't a Location, rather than half-applying. A
typo can't ship characters missing part of their package.

## 3. The point economy

```
budget = GameConfig.startingTagPoints      (default 12, live on /gm/dev)
       + role.extra_starting_points        (Peasant +2, Outsider +3)
       - 3 if the player is Cursed
```

`web/lib/characterCreation.js` holds this arithmetic, and is imported by the
wizard, the server action, and the GM panel so the number a player is shown
and the number the server enforces cannot drift apart.

`Tag.pointCost` is **signed**. Positive costs points; negative *grants* them
(the drawbacks, Old at `-2` and Frail at `-3`). Summing signed costs means
both directions fall out of one subtraction, and `remaining >= 0` is the only
completion rule. Every negative-cost tag is `purchasableAfterStart: false` —
a drawback you could buy mid-game would be a point farm.

A character's bought drawbacks may give back at most
`GameConfig.maxDrawbackPoints` points in total (default 6, live on `/gm/dev`).
The role's own starting tags land as `GM_GRANT` and never pass through the
purchase path, so the Meister's free Frail and the Headman's Old cost nobody
any of that budget. `TAGS.md` §4a is the full rule.

Leftover points are kept, not lost: they land on `Character.tagPoints`.

Fulfilling a Desire is the only way points are *earned* in play, and a Worst
Fear coming true is the only way they are *spent* — the first and so far only
sink (`REQUESTS.md` §5b). The balance is allowed to go **negative**: clamping it
at 0 would let a broke player take the −3 for free, which is the mechanic.

### Two menus, one component

`web/app/components/PointBuy.js` takes an `afterStartOnly` flag:

- **Creation** passes `false` — every `purchasable` tag is on offer, so a
  launch-only pick like "Secretly an Android" is available exactly once.
- **The mid-game store** passes `true` — only `purchasableAfterStart` tags.
  The component is built and shared; the mid-game route itself isn't wired up
  yet.

Tags sort by cost then name, so point-granting drawbacks lead each category.
Cost renders `+N` in `var(--accent)` (red, it costs you) and `-N` in
`var(--positive)` (green, it pays you) — `costColor()` in
`characterCreation.js`, shared with `TagChip.js`.

## 4. Cursed

`Cursed` is a live Discord role (`DISCORD_CURSED_ROLE_ID`), not a DB field —
it's on the Discord account rather than the `Character` row, so it outlives
the character that earned it. `web/lib/discordGuild.js#isCursed(member)`
reads it off a guild member's current roles, fed by `getGuildMember`
(`isGm`'s exact pattern, just a different role id).

It's granted automatically by `killCharacter` when a character dies, and
removed automatically by `createCharacter` the moment the cursed player
successfully rolls a new one — the curse doesn't outlast the Bum/Migrant it
forced. A GM can also curse someone by hand (narrative punishment) simply by
adding the role in Discord — there's no code path needed for that.

While cursed, a player may still roll a new character — but only as a
**Migrant** or a **Bum**, and with **3 fewer points**
(`web/lib/characterCreation.js`'s `CURSED_ROLE_SLUGS`/`CURSED_POINT_PENALTY`,
enforced by `isRoleSelectable`/`computeBudget`, unchanged by this — only
where the `cursed` boolean they're fed comes from changed). A GM clears the
curse early (body buried / rites read) by removing the role directly in
Discord's member panel — `/gm/dev/characters/[characterId]` only shows a
read-only Cursed status line now, there's no checkbox to toggle it from the
app.

(`CharacterStatus.CURSED` still exists in the enum and is unrelated — it's an
unused leftover, kept only because dropping a Postgres enum value is a risky
migration.)

## 4b. Launch gating

Character creation is behind **two independent locks**, both of which must be
open:

1. `GameConfig.openToPlayers` — a Dev Panel toggle, off by default. "The doors
   are open."
2. The hardcoded `PLAYER_ROLE_ID` (`db/lib/roleIds.js`). "You are on the list."

The enforcement boundary is `createCharacter`
(`web/app/(app)/character/createActions.js`), checked **before** any point-buy
validation. `/character` additionally renders `CreationClosed.js` instead of the
wizard, so the reason is legible up front rather than arriving as an error after
four steps.

A **superadmin bypasses both** (`web/lib/superadmin.js#isSuperadmin`, checked in
`createCharacter` and mirrored in `/character`'s render so the host sees the
wizard). That's host/developer access, not a game permission — it exists so the
host can roll a test character without flipping the live toggle for everyone.
Enforcement still lives in the server action; the page-level check is
presentation.

**The gate covers character creation only.** Everything else — `/documents`
especially — stays readable. That's the point: the site goes up before the game
opens so players can read the rules.

## 5. Death

Setting a character to `DEAD` used to write a column and nothing else — it
even left `ensureCharacterRole` renaming and recoloring the dead character's
Discord role afterward. `web/lib/discordGuild.js#killCharacter`, called from
`updateCharacterRaw` on the transition **to** `DEAD`, now does the cleanup:

1. **Explicitly revokes every viewing grant** (`revokeAllCharacterAccess`),
   before the role is deleted — it needs both the role id and the Discord user
   id to name the overwrites. It sweeps every Location category *and its three
   channels*, plus `#watch`/`#intercom`, clearing an overwrite under either
   key.

   This used to be a free side effect of step 2: Discord drops every overwrite
   tied to a role the moment the role goes. That holds only while access is
   keyed on the role — a **member** overwrite is not tied to the role and
   outlives it, which would leave a dead character's player still seeing the
   room they died in. It also sweeps *every* Location rather than the
   character's last one, since a half-failed `swapLocationAccess` leaves a
   grant on the room they left and death is the wrong moment to trust that
   invariant.
2. Deletes the personal Discord role.
3. Nulls `discordRoleId` — it's `@unique`, and a dangling id would have
   `ensureCharacterRole` PATCHing a deleted role forever.
4. Clears the Discord nickname. Unconditional — note the asymmetry:
   *setting* a nickname is gated behind `GameConfig.nicknameSyncEnabled`
   (off by default), but clearing a dead character's is not.
5. Grants the Cursed role (§4).
6. Writes a `DEATH` row to the transcript (`ARCHIVE.md`).
7. Clears `CharacterTag.equipped` on every held tag. A corpse doesn't wield
   things, and a Revive later shouldn't walk back in with gear locked to
   slots that may have moved. It also keeps the loot panel (below) from
   rendering an item as if it's still worn.

`updateCharacterRaw` skips the role/location sync entirely for a non-`ALIVE`
character.

### The corpse is lootable, the row survives

A dead character is not deleted, and their `CharacterTag` and `⬢` stay on the
row. Anyone standing in the location the character died in can `TRANSFER_TAG`
or `TRANSFER_RESOURCES` **in the `LOOT` direction** to lift Items/Assets or ⬢
off the corpse — see `REQUESTS.md` §5. The `/character` page shows a "Bodies
here" panel to any living character in a location that has a corpse; that
panel is the **only** player-facing surface that spells out that someone
died. Every other list (faction roster, transfer target picker) renders a
DEAD character as a normal row with no status pill, and every GM surface
still shows the raw `status`.

Guild-leave takes the same soft-kill path: `guildMemberRemove.js` no longer
calls `deleteCharacterRow`. It writes `status = DEAD`, unequips, and archives
a `DEATH` entry, so a departing player's gear stays lootable exactly as if
they had died in-game. The Cursed grant is skipped for that path — the
account has left the guild and the grant would 404.

## 5b. Killing and reviving from the GM panel

The Dev Character Panel (`DEV-PANEL.md`) is where a GM does this by hand, and
both directions are **microactions with a confirm**, not a `status` dropdown.

That is deliberate. Death has side effects — the whole §5 list — and a staged
form field would have to replay them at save time, which is how the old editor
ended up able to set a corpse back to `ALIVE` while leaving it with no personal
role, no channel access, and the Cursed role still on the account. Removing
`status` from the form means the panel's Apply never has to reason about a
status transition at all: it reads the live value from the database.

**Revive** is the inverse §5 never had: `removeCursedRole`, then
`ensureCharacterRole`, then the nickname, then
`syncCharacterLocationAccess(uid, null, locationId)` — the old location is
`null` because `killCharacter` already stripped every overwrite, so this is a
pure re-grant with nothing to move away from — then
`syncCharacterNarrowcastAccess`.

**Deleting** a character is a separate, superadmin-only action, and is not the
same thing as killing them. It removes the row and everything pointing at it
through `db/lib/deleteCharacter.js`, which is shared with the
`guildMemberRemove` handler so both agree on the foreign-key order. Two
dependents are detached rather than deleted: `AuditLog.targetCharacterId` and
`Note.characterId` are nulled, because the audit trail must outlive its subject
and `Note.characterName` is already a snapshot.

## 6. Narrowcast channels (`#watch`, `#intercom`)

Access to both is granted the same way Location access is — a per-member
permission overwrite keyed on `Character.discordUserId` — and is reconciled
after every Move and on character creation. The rules themselves (who holds
which radio tag, the Keep gate) live in one place: **`CHANNELS.md` §6**.
They were duplicated here and drifted; don't re-add them.

## 7. Sync order

The three YAML masters have dependencies, so order is load-bearing — this is
the order `wipeGameData`'s "Restart Game" runs them in:

```
locations  ->  tags  ->  roles
```

Roles resolve a starting Location *and* validate `starting_tags`. Their
delete contracts differ and are worth knowing: locations is **fully
destructive** (a dropped Location loses its Discord category and its row),
roles prunes only rows nothing references, and tags is a pure upsert that
never deletes.

## 8. Where the code lives

| Concern | File |
|---|---|
| Masters | `docs/roles.yaml`, `docs/tags.yaml`, `docs/locations.yaml` |
| Role sync | `db/lib/syncRoles.js`, `db/prisma/sync-roles.js` |
| Narrowcast channels | `db/lib/narrowcastAccess.js`, `db/lib/syncNarrowcastChannels.js`, `db/prisma/sync-narrowcast-channels.js` |
| Seat math | `db/lib/roleCapacity.js` |
| Budget/eligibility rules | `web/lib/characterCreation.js` |
| Wizard | `web/app/(app)/character/CreateCharacterWizard.js` |
| Point-buy menu | `web/app/components/PointBuy.js` |
| Creation action | `web/app/(app)/character/createActions.js` |
| Discord access + death | `web/lib/discordGuild.js` |
| Name formatting | `db/lib/characterName.js` |
| Dynasty | `db/lib/dynasty.js`, `web/lib/dynasty.js` |
| Antagonist catalog | `db/lib/antagonists.js` |
| Launch gating | `db/lib/roleIds.js`, `web/lib/superadmin.js` |
