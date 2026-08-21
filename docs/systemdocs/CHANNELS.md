# Discord Channel Schematic

How Discord channels get their behavior in Lifeweb, and how visibility is
controlled. Two independent mechanisms are involved — channel *type/name*
(what the channel is for) and per-character *role permissions* (who can see
it) — and they're easy to conflate, so this doc keeps them separate.

## 1. Tupper / summary opt-in

A channel opts into tupper/summary behavior by being one of a provisioned
Location's three channels (see §2), or one of the two narrowcast channels
(see §6), matched by Discord channel ID — there is no name-based marker, and
channel names are otherwise meaningless to this system. Of a Location's
three: the plain (text) channel is both tupper (auto-proxying, ❌/✏️/⭐
reactions) and summary (adjudication results post there); the public (forum)
and private (text) channels are tupper-only. `#radio`/`#intercom` are
tupper-only as well — never summary, since neither is tied to a place with
its own adjudication results.

Two independent implementations check this: `bot/src/lib/channels.js`
(gateway cache, for the bot) and `web/lib/discordGuild.js`
(`isSummaryChannel`/`isTupperChannel`, REST-based, for the web app). Keep
them in sync if the rule changes.

## 2. Location channel layout

Each `Location` (e.g. "Cathedral", nested under Zone "Town") maps to one
Discord category and three channels underneath it, created once by
`provisionLocationChannels` — either via the GM Panel's "Provision Discord
channels" button (`web/app/(app)/gm/dev/actions.js`) or in bulk by
`npm run db:sync-locations` (`db/prisma/sync-locations.js`, driven by
`docs/locations.yaml`). Both call sites build the exact same layout; keep
them in sync if it changes.

**Category name**: `"{Zone} / {Location}"`, e.g. `Town / Cathedral`. Purely
cosmetic, for grouping in the Discord channel list — categories aren't
channels of type text/forum, so `isTupperChannel`/`isSummaryChannel` never
look at them. After provisioning, `sortLocationCategories`
(`web/lib/discordGuild.js`, mirrored standalone in `sync-locations.js`) runs
automatically to re-sort every Location category alphabetically by this
full name (zone first, then location within it) — it only reassigns
position values among existing Location category IDs, so any non-Location
category keeps its position untouched.

**Channels, created in this order** (which is also their display order,
since Discord assigns position by creation order):

| Channel | Type | Purpose | Slowmode |
|---|---|---|---|
| `cathedral` | text | Summary channel — tupper proxying, turn/adjudication updates post here | 60s |
| `cathedral-public` | forum | Subrooms — players spin up their own posts ("The Inn's Kitchen!"). Posts auto-archive (hidden from the active list, not deleted) after 24h of inactivity (`default_auto_archive_duration: 1440`) | — |
| `cathedral-private` | text | Secret conversations — `@everyone` is denied `ViewChannel`/`SendMessages`/`CreatePublicThreads` but allowed `CreatePrivateThreads`, so it's only ever used to spin up a private thread and ping people into it. The `ViewChannel` deny is already inherited from the category (see §3) — it's set explicitly here too so Discord's own permissions UI shows it as an explicit deny on this channel instead of "inherited/neutral", which reads as unrestricted at a glance |

**Renaming**: editing a `Location.name` in the DB or in `locations.yaml`
after provisioning does **not** rename the live Discord category/channels —
this is deliberate (see the "never touches an already-provisioned Location"
guarantee in the root `CLAUDE.md`). Renaming live channels requires a
one-off script against the Discord REST API.

## 3. Visibility: category is hidden by default, per-character role grants access

The whole point of Locations is that a player only sees the Location their
character currently occupies — not the whole map. This is enforced entirely
at the **category** level (child channels inherit permissions):

- On provisioning, the category denies `ViewChannel` to `@everyone` and
  (if `DISCORD_GM_ROLE_ID` is set) explicitly allows it for the GM role, so
  GMs always see every category regardless of where their character is.
- Every `ALIVE` character has a personal Discord role named after the
  character (`Character.discordRoleId`, see root `CLAUDE.md` §"Zones,
  Locations, and character roles"). When a character's location changes,
  that role gets a single `ViewChannel` permission overwrite added on the
  *new* category and removed from the *old* one — never a static list of
  every character on every category. At any moment a category only carries
  overwrites for the (usually small) set of characters currently standing
  in it, which is also why this doesn't run into Discord's ~100-overwrite-
  per-channel ceiling even at 100+ players.

Three call sites keep a character's role overwrite in sync with
`Character.locationId`, all funneling through the same one-overwrite-per-
active-Location primitive:

| Trigger | Code | Mechanism |
|---|---|---|
| Player self-service travel (`⚜` button in the `location` channel) | `bot/src/lib/location.js#performMove` → `swapLocationAccess` | Gateway `Guild`/`Role` objects (bot already has them cached) |
| GM raw edit (`/gm/dev/characters/[characterId]`) | `web/app/(app)/gm/dev/actions.js#updateCharacterRaw` → `syncCharacterLocationAccess` | REST (`PUT`/`DELETE /channels/{id}/permissions/{roleId}`) — the web app has no gateway connection |
| New character created with a Location already set | `web/app/(app)/character/createActions.js#createCharacter` → `syncCharacterLocationAccess` | REST. Character creation picks up the role's `starting_location`, so every new character now has a Location from the moment they exist |

If a new call site ever sets `Character.locationId` directly, it needs to
call one of these two (or a shared equivalent) — a raw Prisma write alone
leaves the old category overwrite dangling and the new one missing.
`db/prisma/backfill-location-access.js` (`npm run db:backfill-location-access`)
is a one-off catch-up for characters whose `locationId` was set before these
call sites existed (mirrors `backfill-roles.js`'s role-creation catch-up).

## 4. Testing visibility: the guild owner always sees everything

Discord's permission system exempts the **guild owner** from every overwrite
— denies, category-level or channel-level, never apply to them. If the
account you're testing with owns the Discord server (true for whoever ran
the bot setup), every category will look visible to you regardless of what
overwrites are actually set, even with zero bugs in this system. To actually
observe the per-character gating, test from a non-owner account (an alt, or
a real player) — checking the raw permission overwrites via the REST API
(as done to diagnose/backfill this) is the reliable way to verify from the
owner's own account.

## 5. Dawn message wipe + `#archive`

Every time a new `Turn` opens with `phase === "DAWN"` (never Dusk), if
`GameConfig.messageWipeEnabled` is on (a Dev Panel checkbox, default off),
`db/lib/dawnWipe.js#runDawnWipe` clears every Location's roleplay content,
plus the guild-wide `#radio`/`#intercom` narrowcast channels (§6) — after
archiving it first, in order, to a single guild-wide `#archive` text
channel (exact-name match like `#turns`/`#location` — a GM creates it once,
no auto-provisioning). This is wired into `db/index.js#advanceTurn()`
itself (see below), so it fires identically regardless of whether Dawn was
triggered by the bot's twice-daily cron or a GM's manual "End Turn" button.

**Per channel type:**

| Channel | Wipe behavior |
|---|---|
| Plain (summary) | Every message archived, then deleted. |
| Public (forum) | Every post (thread) is archived. Posts **without** the "Persistent" (⏰) forum tag are then deleted entirely — post gone. Posts **with** it survive; only their messages are cleared. |
| Private | Has no top-level messages, only threads (anyone can spin one up, not just GMs). Every thread — active or already auto-archived — is archived, then deleted entirely. No Persistent exception here. |
| Narrowcast (`#radio`/`#intercom`) | Same as plain: every message archived, then deleted. Looked up from `GameConfig.radioChannelId`/`intercomChannelId` (§6) rather than a `Location` row, so it runs once after the per-Location loop rather than per Zone/Location. |

**Archive format**: each line is `` `[label]` **AuthorName**: content `` —
`label` is `Zone / Location` for Location-derived channels/threads, or a
bare `"Radio"`/`"Intercom"` for the narrowcast channels. `AuthorName` is
`message.author.username`, which for tupper-proxied messages is already the
character's name (the webhook's `username` is set to it, see "Character
proxying" in the root `CLAUDE.md`) — no DB join needed, and it works
uniformly for non-proxied messages (e.g. bot-posted adjudication results)
too. Lines are batched into as few `#archive` messages as possible (≤2000
chars each) rather than one API call per line. Order is chronological
within each channel/thread; Locations are processed in the same
`Zone / Location` alphabetical order as `sortLocationCategories` (§2), not a
strict cross-channel global merge; `#radio`/`#intercom` are processed last.

Private-channel content **is** archived (not skipped) — the privacy
tradeoff is handled out-of-band by the GM keeping `#archive` itself hidden
from players until the game ends, not by the code.

**Persistent tag**: added to every public forum channel's `available_tags`
at creation time (both `provisionLocationChannels` call sites) and via a
one-off backfill (`npm run db:backfill-persistent-tag`,
`db/prisma/backfill-persistent-tag.js`) for ones that predate it. Looked up
by name at wipe-time (`getForumTagId` in `db/lib/discordRest.js`) rather
than stored anywhere, so it can't drift if ever recreated.

**Where the code lives**: `db/lib/discordRest.js` (low-level REST helpers —
paginated message fetch, bulk-delete, thread list/delete, forum tag patch,
no `prisma` dependency), `db/lib/dawnWipe.js` (`runDawnWipe(prisma)`, the
per-Location orchestration above), `db/lib/turnAnnouncement.js`
(`postTurnsAnnouncement`, the `#turns` announcement — also consolidated
here as part of the same refactor, see below). All entirely sequential (no
parallel fan-out across locations/channels/threads) to avoid bursting
Discord's rate-limit buckets, and every channel/thread is archived *before*
it's touched for deletion, so a mid-run crash leaves content merely
"not yet wiped," never "wiped without being archived" — an accepted known
limitation (no checkpoint/resume machinery), same framing as the node-cron
catch-up gap already documented in `docs/systemdocs/ARCHITECTURE.md`.

**Consolidation**: `db/index.js#advanceTurn()` owns the turn announcement,
the Hunger DMs and the Dawn wipe (all REST-only, no gateway needed) —
previously each was duplicated per caller (a gateway version in the bot, a
REST version in the web Dev Panel). `bot/src/lib/turnEngine.js` and
`web/app/(app)/gm/dev/actions.js#forceAdvanceTurn` now just call
`advanceTurn()` and write their own `AuditLog` entry (the one thing that
legitimately still differs per caller). Every side effect is best-effort —
wrapped in `.catch()` — so a Discord-side failure can never block or roll
back the turn advance itself.

**But it does not *run* them.** All three are returned as one
`runSideEffects()` thunk, because the wipe is minutes long and awaiting it
inside the Dev Panel's server action held the request open — and a pending
server action blocks client-side navigation, so the entire web app appeared
to freeze until a hard refresh. The bot's cron awaits the thunk inline; the
web action passes it to `next/server`'s `after()`, so the new turn is on
screen before the wipe starts. A GM watching `#archive` fill up several
minutes after the turn flipped is the expected behavior, not a stall.

## 6. Narrowcast channels (`#radio`, `#intercom`, outside the Location layout)

`#radio` and `#intercom` sit outside the Location category structure
entirely, and unlike the tag-gate-role mechanism this replaced, they use the
*exact same* access primitive Locations do: a permission overwrite on the
character's own personal Discord role (`Character.discordRoleId`), added or
removed as their tags or Location/Zone change. There's no separate gate role
for either channel anymore — just the personal role everyone already has.

Each channel's rule is bespoke, not a symmetric "hold a tag" gate, so they're
hardcoded in `db/lib/narrowcastAccess.js`'s `NARROWCAST_RULES` rather than
authored in a YAML:

- **`#radio`** — viewable and speakable by anyone holding the **Radio** tag,
  *unless* their current Location is **Depths**.
- **`#intercom`** — viewable by anyone whose current Zone is **Fortress** or
  **Town**; speakable only by a character holding the **Intercom** tag *and*
  currently standing in the **Keep** (a Location inside Fortress).

`@everyone` is denied `ViewChannel` + `SendMessages` on both by default (set
once at provisioning, see below); a qualifying character's personal role then
gets an `allow` overwrite for whichever of `ViewChannel`/`SendMessages` their
current context grants, or has its overwrite removed entirely if it
qualifies for neither.

Two call sites keep this reconciled, mirroring the Location access split:
`bot/src/lib/location.js`'s `syncCharacterNarrowcastAccess` (gateway, called
from `performMove` after every Move) and `web/lib/discordGuild.js`'s
function of the same name (REST, called from character creation, GM raw
location edits, and `grantTag`/`revokeTag` — tag changes only ever happen
through the web app). Both load the character's current tags/Location via
`db/lib/narrowcastAccess.js#buildNarrowcastContext` and run
`computeNarrowcastAccess` against the rules table. No revoke is needed on
death: `killCharacter` deletes the personal role outright, which drops every
permission overwrite tied to it — Location and narrowcast alike — for free.

Provisioning is a one-off, hand-run script:
`db/lib/syncNarrowcastChannels.js#syncNarrowcastChannels`
(`npm run db:sync-narrowcast-channels`) creates each channel if its id (kept
on `GameConfig.radioChannelId`/`intercomChannelId`) is unset or missing from
the guild, sets a static topic, and applies the `@everyone` deny — then never
touches it again. It is not part of `wipeGameData`'s "Restart Game" flow; the
channel ids persist across a reset, same treatment as
`turnsAnnouncementChannelId`.

Known scaling caveat: `#intercom`'s view condition spans a whole Zone
(Fortress or Town), which can include many simultaneously-present characters
at once — unlike a single Location, this could approach Discord's
~100-permission-overwrite-per-channel ceiling at a large enough roster. This
was a known, accepted tradeoff when the tag-gate-role mechanism was replaced
with personal-role overwrites; revisit if it becomes a real problem in
practice.

Both channels are tupper-only (§1) — `bot/src/lib/channels.js`'s
`refreshLocationChannels` and `web/lib/discordGuild.js`'s
`fetchLocationChannelIds` fold `GameConfig.radioChannelId`/
`intercomChannelId` into the same `tupperOnly` set as a Location's public/
private channels, so a message posted there is auto-proxied as the sending
character exactly like any other tupper channel — never summary, since
neither channel is tied to a place.

Both channels are also included in the Dawn message wipe (§5) —
`db/lib/dawnWipe.js#runDawnWipe` reads the same `GameConfig.radioChannelId`/
`intercomChannelId` fields and archives+clears each channel's messages
exactly like a Location's plain channel, just without a `Zone`/`Location`
pairing for the archive label.

