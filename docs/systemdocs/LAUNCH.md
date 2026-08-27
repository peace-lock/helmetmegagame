# Opening a game: the launch runbook

What to do, in what order, to take the app from "deployed" to "players can
make characters". Written for a Restart Game wipe, which is how a playtest or
a new season starts.

Every step here exists because skipping it breaks something quietly. Nothing
in this list throws a visible error — you find out when a player says the
button isn't there.

Companion to [`SYNC.md`](SYNC.md) §3 (what the wipe re-syncs),
[`DEV-PANEL.md`](DEV-PANEL.md) (the panel itself) and
[`GAMEMASTERS.md`](GAMEMASTERS.md) (zone seats).

## 1. The three that bite

Read these before touching anything, because two of them are invisible until
someone complains and the third is irreversible in the wrong order.

**The wipe closes the doors behind you.** `wipeGameData` writes
`DEFAULT_GAME_CONFIG` (`web/app/(app)/gm/dev/actions.js`) over the config row,
and that constant sets `openToPlayers: false` and `leaderWhitelistEnabled:
true`. So the natural opening move — wipe to a clean slate — leaves a game
nobody can join, with the Leader roles re-locked. It also resets **every
balance knob**: `playerCount`, `startingTagPoints`, `equipSlots`,
`maxDrawbackPoints`, `productionCoefficient`, and the feature switches
(`playtestModeEnabled`, `nicknameSyncEnabled`, `archiveVisible`,
`avatarUploadsEnabled`, `portraitMakerEnabled`, `messageWipeEnabled`). **Screenshot the Game Config
form before you wipe.** The row is updated, not recreated, so anything absent
from `DEFAULT_GAME_CONFIG` survives — including the narrowcast and `#turns`
channel pointers.

**The wipe resets the playtest lock, and the `#turns` repost is best-effort.**
`playtestModeEnabled` — the switch that locks the Merchant and every
Windlands role out of character creation — is reset to `false` by the wipe
like everything else, so a playtest that wants those locked has to re-tick it
afterwards. Separately, `finishGameWipe` now reposts the `#turns` console for
the fresh Turn 1 itself, so the channel is no longer left empty on Day 1 — but
that call is caught and logged, not retried. If it fails, the stale message
pointer is the safety net: the bot reposts on its next `ready`. Check the
channel; restart the bot if it's bare.

**A zone seat costs a GM the threat briefs.** The polarity is inverted from
intuition: a *master GM* is one with **no** zone assignment, and secret
documents are visible only to master GMs (`web/app/(app)/documents/page.js`,
[`DOCUMENTS.md`](DOCUMENTS.md)). Seating a GM in a zone **removes** their
access to every threat brief. There is no way to be seated and see secrets. A
seat decides which zone their tables open on and hides nothing else, so leave
a GM unseated unless you specifically want the default.

## 2. The runbook

**Before the wipe**

1. Screenshot `/gm/dev` → Game Config (§1).
2. `./migrate.sh`, or `npm run db:migrate:deploy`. A wipe against an
   unmigrated database throws mid-transaction and wipes nothing. See
   "Deploy workflow" in `CLAUDE.md` for why this is not automatic.
3. Confirm each GM holds the Discord GM role and has signed into the web app
   with that same Discord account.

**The wipe**

4. `/gm/dev` → Restart Game → type `WIPE`, all caps. Superadmin only.
5. Watch the server logs until the `superadmin_game_wipe_finished` audit row
   lands. The action returns in about a second; the Discord half runs in
   `after()` for minutes. Each of the four YAML re-syncs is individually
   caught and only logs — **the panel reports success even if all four
   failed**. Watch for `sync failed during game wipe` and for
   `Game wipe leaked N Discord role(s)`.

**After the wipe**

6. `npm run db:sync-narrowcast-channels`, then delete the old `#radio`
   channel by hand. This is not optional after the `watch_radio_channels`
   migration, which drops `radioChannelId` and leaves
   `radioCategoryId`/`watchChannelId` NULL. The wipe never provisions them
   (the ids normally persist across a restart, which is why it doesn't).
   Until this runs, `#watch` and `#intercom` do not exist and the radio tags
   do nothing.
7. `npm run db:rebuild-info-channel`. `#info` is never rebuilt automatically
   and still carries the previous game's roles intro.
8. `npm run db:prune-orphan-roles` — dry run. Add `-- --apply` only if it
   lists leaks. The guild cap is 250 roles; past it, `ensureCharacterRole`
   silently stops creating them and new characters are unmentionable.
9. **Do not run `db:prune-tags` here.** A wipe clears every `CharacterTag`
   first, so a prune would find every GM-created tag unheld and delete the
   lot ([`SYNC.md`](SYNC.md) §3b).
10. Check `#turns` shows the Turn 1 announcement and its button row. The
    wipe reposts it, but the call is best-effort — restart the bot if the
    channel is empty (§1).
11. Re-enter Game Config from the screenshot, including
    **Playtest mode** if you want the Merchant and the Windlands locked.
12. **Tick "Open to players" last.** A player also needs the player role —
    the two together are "the doors are open" and "you are on the list".

## 3. What the wipe does not clear

Worth knowing, because none of it is obvious from the confirm dialog.

| Survives | Consequence |
|---|---|
| `#watch`, `#intercom`, `#info` messages | `runFullChannelWipe` only touches `#archive`, `#turns` and Location channels. Last game's radio traffic stays readable. |
| `GmAssignment` zone seats | GMs keep their seats across a restart — which also means they keep *losing* the Secret tab (§1). |
| `GhostWhisper` rows | A returning player can carry a 12-hour whisper cooldown into the new game. |
| The narrowcast and `#turns` channel pointers | Deliberate: provisioning is one-time. |
| `Zone`, `Location`, `Faction`, `Tag`, `Role`, `Document` | Re-synced from YAML rather than deleted. Faction `silo` is zeroed. |

## 4. If you are not wiping

Run the four masters yourself, in dependency order — roles resolve a starting
Location and validate `starting_tags`, so the order is load-bearing:

```
npm run db:sync-locations     # destructive
npm run db:sync-tags          # upsert-only, never deletes
npm run db:sync-roles         # prunes unreferenced
npm run db:sync-documents     # destructive; last
```

Then steps 6–8 above, which the wipe would not have covered either.

## 5. Who can do what

The Discord GM role and superadmin are independent. Superadmin is a hardcoded
list of Discord user IDs in `web/lib/superadmin.js` — adding one is a code
edit and a redeploy, not something you can do from a browser on the day.

A GM-role holder can run the whole game: Moves, Requests, kills, revives,
tags, DMs, the per-character dev panel, and the bot's `/gm` `/dm` `/heal`
(from a guild channel — none of them work in the bot's DMs).

A GM-role holder **cannot**: end a turn early, wipe or restart, edit Game
Config, set next turn's weather or note, edit factions, delete a character or
a custom tag, or open `/gm/audit` and `/gm/gamemasters`. All of those are
superadmin.

The practical one is **ending a turn**. `forceAdvanceTurn` checks only
`isSuperadmin` and never consults the GM role, so if the superadmin is away,
turns roll on the bot's cron alone — 04:00 and 16:00 America/Chicago. Plan
around that or add a second superadmin before the game opens.

## 6. Pre-flight check

- [ ] `#turns` exists, is named exactly `turns`, and shows the console message
      with its button row. Both the announcement and the console find it by
      exact name; a rename loses all three player entry points.
- [ ] `/character` renders the creation wizard, not `CreationClosed`, for a
      test account holding the player role
- [ ] The role tree on step 2 is populated — empty means the role sync failed
- [ ] The point-buy menu on step 3 has tags
- [ ] `/documents` is populated
- [ ] `#watch` and `#intercom` exist under a `radio` category, and the old
      `#radio` is gone
- [ ] Make one throwaway character end to end, then check its Discord channel
      access and its nickname
- [ ] End one turn and confirm the announcement posts
