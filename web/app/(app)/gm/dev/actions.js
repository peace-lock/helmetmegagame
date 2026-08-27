"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  prisma,
  advanceTurn as advanceTurnInDb,
  runFullChannelWipe,
  syncLocationsFromYaml,
  syncTagsFromYaml,
  syncRolesFromYaml,
  syncDocumentsFromYaml,
} from "@lifeweb/db";
// By path, not the barrel: it takes prisma as a parameter, the db/lib/dm.js
// convention that keeps it off the barrel (ARCHITECTURE.md §2).
import { postTurnsAnnouncement } from "@lifeweb/db/lib/turnAnnouncement";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import {
  deleteCharacterRole,
  revokeAccessForCharacters,
  updateGuildNickname,
  listGuildMembers,
  removeCursedRole,
  setTurnPingRole,
  setRomanceOptOutRole,
} from "@/lib/discordGuild";
import { getFactionAncestorIds } from "@/lib/factionPermissions";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

function str(formData, key) {
  const v = formData.get(key);
  return v == null ? "" : v.toString();
}

function intOrNull(formData, key) {
  const v = str(formData, key).trim();
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function intOrZero(formData, key) {
  return intOrNull(formData, key) ?? 0;
}

function floatOrDefault(formData, key, fallback) {
  const v = str(formData, key).trim();
  if (v === "") return fallback;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

export async function updateGameConfig(formData) {
  await requireSuperadmin();

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      lifewebBlood: Math.max(0, Math.min(100, intOrZero(formData, "lifewebBlood"))),
      lifewebDecayPerTurn: intOrZero(formData, "lifewebDecayPerTurn"),
      openToPlayers: formData.get("openToPlayers") === "on",
      leaderWhitelistEnabled: formData.get("leaderWhitelistEnabled") === "on",
      playtestModeEnabled: formData.get("playtestModeEnabled") === "on",
      autoTurnAdvanceDisabled: formData.get("autoTurnAdvanceDisabled") === "on",
      avatarUploadsEnabled: formData.get("avatarUploadsEnabled") === "on",
      portraitMakerEnabled: formData.get("portraitMakerEnabled") === "on",
      portraitFantasyPartsEnabled: formData.get("portraitFantasyPartsEnabled") === "on",
      messageWipeEnabled: formData.get("messageWipeEnabled") === "on",
      tupperAutocorrectEnabled: formData.get("tupperAutocorrectEnabled") === "on",
      nicknameSyncEnabled: formData.get("nicknameSyncEnabled") === "on",
      archiveVisible: formData.get("archiveVisible") === "on",
      archiveTravelEvents: formData.get("archiveTravelEvents") === "on",
      productionCoefficient: floatOrDefault(formData, "productionCoefficient", 1),
      startingTagPoints: intOrZero(formData, "startingTagPoints"),
      // Guarded at 1 because it's the denominator of every weighted role's
      // seat cap — a 0 here would collapse the whole role picker.
      playerCount: Math.max(1, intOrZero(formData, "playerCount")),
      equipSlots: Math.max(1, intOrZero(formData, "equipSlots")),
      // 0 is a real setting here — "no drawbacks at all" is coherent, only a
      // negative cap is nonsense.
      maxDrawbackPoints: Math.max(0, intOrZero(formData, "maxDrawbackPoints")),
      // Where the staged push posts PUBLIC declarations (db/lib/stagedPush.js).
      // Empty means composed posts are skipped at push, recorded on their
      // rows' deliveryFailures — never lost.
      turnSummaryChannelId: str(formData, "turnSummaryChannelId").trim() || null,
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
  // These knobs feed the character-creation wizard's budget, seat caps and
  // drawback limit…
  revalidatePath("/character");
  // …and the store shows the same drawback readout.
  revalidatePath("/store");
}

// Directly overrides the current turn's day/phase (creating one if none is
// open) rather than routing through Needs resolution — a raw superadmin
// correction, not a normal turn advance.
export async function updateCurrentTurn(formData) {
  await requireSuperadmin();

  const day = intOrNull(formData, "day");
  const phase = str(formData, "phase") || "DAWN";
  const weather = str(formData, "weather") || "CLEAR";
  if (day == null || day < 1) return;

  const number = (day - 1) * 2 + (phase === "DAWN" ? 1 : 2);

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurnRecord) {
    await prisma.turn.update({ where: { id: openTurnRecord.id }, data: { number, phase, weather } });
  } else {
    await prisma.turn.create({ data: { number, phase, weather, status: "OPEN", gameDate: new Date() } });
  }

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// Sets the pending weather/note for the *next* turn, consumed by
// advanceTurn() in @lifeweb/db when the turn actually advances. Leaving
// weather unset (empty string -> null) means "roll randomly" there.
export async function updateNextTurn(formData) {
  await requireSuperadmin();

  const weather = str(formData, "weather").trim() || null;
  const note = str(formData, "note").trim() || null;

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1, nextWeather: weather, nextTurnNote: note },
    update: { nextWeather: weather, nextTurnNote: note },
  });

  revalidatePath("/gm/dev");
}

// advanceTurnInDb() composes every Discord side effect (Hunger DMs, the turn
// announcement, and the Dawn message wipe if GameConfig.messageWipeEnabled is
// on) but hands them back as a thunk rather than running them — REST-based, so
// nothing gateway-specific is needed here.
//
// That thunk goes to after(), never into the request. The Dawn wipe walks every
// Location's channels sequentially and can take minutes; awaiting it here used
// to hold the server action open for the whole time, and a pending action
// blocks client-side navigation — so the Dev Panel appeared to freeze until you
// hard-refreshed. Now the response carries the already-committed new turn and
// Discord catches up behind it.
export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  try {
    const { advanced, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

    // Lost the race to the bot's cron or a second click. The turn did advance,
    // so the panel should still repaint — there's just nothing of ours to log
    // and no side effects of ours to run.
    if (!advanced) {
      revalidatePath("/gm/dev");
      revalidatePath("/", "layout");
      return { ok: true };
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_turn_forced",
        details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase, weather: newTurn.weather },
      },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      runSideEffects().catch((err) => console.error("Turn side effects failed:", err)),
    );

    return { ok: true };
  } catch (err) {
    // There's no error.js boundary in this app, so an uncaught throw here
    // would replace the panel with Next's generic error page and leave the GM
    // unable to tell whether the turn advanced. Report it in place instead.
    console.error("Force advance turn failed:", err);
    return { ok: false, error: "Could not end the turn. Check the server logs." };
  }
}

// Matches GameConfig's schema @default values for the balance-knob fields
// surfaced on the "Game Config" form above — deliberately excludes
// nextWeather/nextTurnNote (handled separately, "Next Turn" section) and the
// Discord provisioning pointer (turnsConsoleChannelId/MessageId), which
// finishGameWipe overwrites for itself: it reposts the console right after
// fullWipe clears #turns, so the pointer it writes is the live message.
//
// Leaving it set is also the safety net. If that repost fails, the stale id
// is exactly what makes the bot repost on its next ready — ensureTurnsConsole
// fetches the tracked message, gets null, and posts a new one. Clearing it
// here would lose nothing and gain nothing.
//
// This comment used to claim the pointer "self-heals" because the next turn
// advance reposts the message. True, but the next turn advance is half a day
// away, and that reading is why a Restart Game left players staring at an
// empty #turns through the whole of Day 1 / Dawn.
const DEFAULT_GAME_CONFIG = {
  lifewebBlood: 100,
  lifewebDecayPerTurn: 10,
  openToPlayers: false,
  leaderWhitelistEnabled: true,
  playtestModeEnabled: false,
  autoTurnAdvanceDisabled: false,
  avatarUploadsEnabled: false,
  portraitMakerEnabled: false,
  portraitFantasyPartsEnabled: false,
  messageWipeEnabled: false,
  tupperAutocorrectEnabled: true,
  nicknameSyncEnabled: false,
  archiveVisible: false,
  archiveTravelEvents: false,
  productionCoefficient: 1,
  startingTagPoints: 12,
  playerCount: 100,
  equipSlots: 6,
  maxDrawbackPoints: 6,
};

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row (characters, tags-on-characters, Moves, default efforts, notes, DM
// log, audit log, silo history, and the /archive transcript), resets
// GameConfig's balance knobs to their schema defaults, clears every Discord
// channel this game has actually written to (#turns, and every Location's
// plain/public/private channel — messages, forum posts, and threads, public
// or private), and opens a fresh Turn 1/DAWN — then reposts the #turns
// console for it, which the channel wipe just deleted.
//
// The transcript is a DATABASE TABLE (ArchiveEntry), not a channel: it is
// recorded at send time and there has been no #archive channel since
// (CHANNELS.md §5). It is cleared by the transaction below, never by any
// Discord pass — this comment used to say otherwise, which read as "archive:
// handled" and is how the deleteMany came to be missing. Then re-syncs every YAML master, in dependency
// order, so the game starts from the canonical sets:
//   locations (docs/locations.yaml) -> tags (docs/tags.yaml) -> roles (docs/roles.yaml)
// Roles resolve a starting Location and validate starting_tags, so that
// order is load-bearing, not cosmetic. The #watch/#intercom channel ids on
// GameConfig are left untouched (same "self-heals, provisioning is one-time"
// treatment as turnsAnnouncementChannelId) rather than reset here.
//
// The four syncs do NOT share one contract, which is worth knowing before
// relying on any of them: syncLocationsFromYaml is fully destructive (a
// Location dropped from the YAML has its Discord category+channels deleted
// and its row removed), syncDocumentsFromYaml is destructive in the same
// sense but with nothing to delete in Discord (a Document is pure reference
// content, so a dropped key just loses its row), syncRolesFromYaml prunes
// only rows nothing references, and syncTagsFromYaml is a pure upsert that
// never deletes.
// Faction silos reset to 0, same "back to day one" treatment as the Turn
// counter, rather than carrying over stale economy numbers.
//
// Requires typing the literal string "WIPE" in the confirm field — this is
// the most destructive action in the Dev Panel and has no undo.
export async function wipeGameData(formData) {
  const session = await requireSuperadmin();

  if (str(formData, "confirm").trim() !== "WIPE") {
    return { ok: false, error: 'Type "WIPE" (all caps) to confirm.' };
  }

  try {
    // Snapshotted BEFORE the deletes, and closed over by the thunk below:
    // by the time the Discord work runs these rows are gone, and their
    // discordUserId/discordRoleId are the only handles on what to clean up.
    const [characters, members] = await Promise.all([
      prisma.character.findMany({
        select: { discordUserId: true, discordRoleId: true, turnPingOptIn: true, romanceOptOut: true },
      }),
      listGuildMembers(),
    ]);
    const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
    const cursedMemberIds = cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [];

    // Deletes ordered so dependents go before the Character/Turn rows they
    // reference (Prisma doesn't cascade by default here). Request and Desire
    // both carry a required FK to Character (Request also has an optional one
    // to Turn), and StagedMessage/StagedEffect both carry a required FK to
    // Turn, so they all have to go before character/turn.deleteMany or those
    // statements throw a Postgres FK violation that rolls back the whole
    // transaction, wiping nothing at all.
    await prisma.$transaction([
      prisma.note.deleteMany({}),
      prisma.defaultEffort.deleteMany({}),
      prisma.action.deleteMany({}),
      prisma.request.deleteMany({}),
      prisma.desire.deleteMany({}),
      prisma.characterTag.deleteMany({}),
      prisma.auditLog.deleteMany({}),
      prisma.character.deleteMany({}),
      prisma.stagedMessage.deleteMany({}),
      prisma.stagedEffect.deleteMany({}),
      prisma.turn.deleteMany({}),
      prisma.siloTransaction.deleteMany({}),
      prisma.directMessage.deleteMany({}),
      // The transcript (/archive). Carries no foreign keys — snapshot columns
      // only, ARCHITECTURE.md §6 — so the ordering rules above do not apply to
      // it and it sits with the other log tables. Its absence here is why a
      // restart used to leave the whole previous game readable at /archive:
      // it is in nobody's dependency chain, so it never came up while that
      // ordering was being worked out.
      prisma.archiveEntry.deleteMany({}),
      prisma.faction.updateMany({ data: { silo: 0 } }),
      prisma.gameConfig.update({
        where: { id: 1 },
        data: { ...DEFAULT_GAME_CONFIG, nextWeather: null, nextTurnNote: null },
      }),
    ]);

    const firstTurn = await prisma.turn.create({
      data: { number: 1, phase: "DAWN", weather: "CLEAR", status: "OPEN", gameDate: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_game_wipe",
        details: { characters: characters.length, cursedMembers: cursedMemberIds.length },
      },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      finishGameWipe(session.discordUserId, characters, cursedMemberIds, firstTurn).catch((err) =>
        console.error("Game wipe side effects failed:", err),
      ),
    );

    return { ok: true };
  } catch (err) {
    // There's no error.js boundary in this app, so an uncaught throw here
    // would replace the panel with Next's generic error page and leave the GM
    // unable to tell whether the wipe happened. Report it in place instead.
    console.error("Game wipe failed:", err);
    return { ok: false, error: "Could not wipe the game. Check the server logs." };
  }
}

// Everything the wipe does outside the database, handed to after() rather than
// awaited — the same split forceAdvanceTurn uses, and for the same reason.
// This walks every channel in the game twice over and then re-syncs four YAML
// masters; awaiting it held the server action open for minutes, and a pending
// server action blocks client-side navigation, so the panel froze.
//
// Every step is best-effort: a Discord failure must not stop the ones after
// it, and the database is already in its final state before any of this runs.
//
// If the container dies partway, the catalogs are untouched (the transaction
// never deletes them) so a GM can re-run the syncs by hand. That is a
// recoverable state; a fifty-minute hanging request is not.
async function finishGameWipe(actorDiscordUserId, characters, cursedMemberIds, firstTurn) {
  // First, while nothing has re-provisioned: strip every character's channel
  // access. One pass over the channels rather than one pass per character —
  // see db/lib/locationAccess.js#revokeAccessForCharacters for why that
  // matters at roster scale.
  const sweep = await revokeAccessForCharacters(characters).catch((err) => {
    console.error("Access sweep failed during game wipe:", err);
    return null;
  });

  // Sequential, not Promise.all. This used to fan out ~2 calls per character
  // plus every cursed role plus the whole channel wipe at once — 240+
  // simultaneous requests at roster scale against two per-guild buckets. Same
  // conversion, and the same reasoning, as deliverGmMessage in
  // web/app/(app)/gm/actions.js.
  //
  // The stakes here are specifically role LEAKAGE: this is the one moment 120
  // roles are deleted at once, a dropped delete leaves a guild role nothing
  // ever reaps, and the guild cap is 250. So a failed delete is retried once
  // and then reported, rather than swallowed into a bare .catch(() => {}).
  const leakedRoleIds = [];
  for (const c of characters) {
    if (c.discordRoleId) {
      try {
        await deleteCharacterRole(c.discordRoleId);
      } catch (err) {
        try {
          await deleteCharacterRole(c.discordRoleId);
        } catch (retryErr) {
          leakedRoleIds.push(c.discordRoleId);
          console.error(`Leaked role ${c.discordRoleId} during wipe: ${retryErr.message}`);
        }
      }
    }
    await updateGuildNickname(c.discordUserId, null).catch(() => {});

    // A restart should not leave anyone still holding last game's turn-ping
    // or no-romance guild role — those are Discord role state, not touched
    // by the DB wipe above.
    if (c.turnPingOptIn) {
      await setTurnPingRole(c.discordUserId, false).catch(() => {});
    }
    if (c.romanceOptOut) {
      await setRomanceOptOutRole(c.discordUserId, false).catch(() => {});
    }
  }

  // A full restart should not leave anyone still cursed from the last game.
  for (const id of cursedMemberIds) {
    await removeCursedRole(id).catch(() => {});
  }

  if (leakedRoleIds.length > 0) {
    console.error(
      `Game wipe leaked ${leakedRoleIds.length} Discord role(s) against a 250-role guild cap. ` +
        `Delete them by hand or re-run the wipe: ${leakedRoleIds.join(", ")}`,
    );
  }

  await runFullChannelWipe(prisma).catch((err) => console.error("Full channel wipe failed:", err));

  // After the wipe, never before it: the line above bulk-deletes every message
  // in #turns, including this one if it were posted first.
  //
  // wipeGameData opens Turn 1 with a plain turn.create rather than through
  // advanceTurn() — there is no turn to close, and no roster to run default
  // moves, hunger or DMs against — so runSideEffects() never fires and the
  // announcement that normally rides it never went out. #turns stayed empty
  // (no Day 1 header, no banner, no Travel/Move/Speak) until the bot next
  // restarted or the game reached Dusk. Same call the turn engine makes,
  // db/index.js#advanceTurn; the note is null because the transaction above
  // already cleared nextTurnNote.
  await postTurnsAnnouncement(prisma, firstTurn, null).catch((err) =>
    console.error("Turns console repost failed during game wipe:", err),
  );

  // Re-sync every YAML master, in dependency order, so the game starts from
  // the canonical sets. Roles resolve a starting Location and validate
  // starting_tags, so that order is load-bearing, not cosmetic.
  const locationSync = await syncLocationsFromYaml(prisma).catch((err) => {
    console.error("Location sync failed during game wipe:", err);
    return null;
  });
  const tagSync = await syncTagsFromYaml(prisma).catch((err) => {
    console.error("Tag sync failed during game wipe:", err);
    return null;
  });
  const roleSync = await syncRolesFromYaml(prisma).catch((err) => {
    console.error("Role sync failed during game wipe:", err);
    return null;
  });
  // Last of the four: its assignment references are validated against the
  // Tag/Role/Faction rows the syncs above create.
  const documentSync = await syncDocumentsFromYaml(prisma).catch((err) => {
    console.error("Document sync failed during game wipe:", err);
    return null;
  });

  // A second row rather than details on the first: none of this is known when
  // the action returns, and claiming it there would be a lie — the same
  // reasoning runDefaultMovePass uses for reporting `shareable`, not `shared`.
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "superadmin_game_wipe_finished",
        details: { sweep, locationSync, tagSync, roleSync, documentSync },
      },
    })
    .catch((err) => console.error("Game wipe completion audit failed:", err));
}

export async function updateFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const before = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!before) return;

  const newSilo = intOrZero(formData, "silo");
  const siloDelta = newSilo - before.silo;

  const parentFactionId = str(formData, "parentFactionId").trim() || null;
  if (parentFactionId) {
    if (parentFactionId === factionId) return;
    // Reject a cycle: the faction being edited can't already be an ancestor
    // of the faction it's about to be parented under.
    const ancestorIds = await getFactionAncestorIds(parentFactionId);
    if (ancestorIds.includes(factionId)) return;
  }

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      silo: newSilo,
      parentFactionId,
    },
  });

  if (siloDelta !== 0) {
    const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    await prisma.siloTransaction.create({
      data: {
        factionId,
        amount: siloDelta,
        actorDiscordUserId: session.discordUserId,
        actorName: "GM (Dev Panel)",
        note: "Manual Dev Panel adjustment",
        turnNumber: openTurn?.number ?? null,
        turnPhase: openTurn?.phase ?? null,
      },
    });
  }

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players");
}

// Reassigns the faction's members to "Unaffiliated" (same pattern as
// removeCharacterFromFaction in faction/actions.js) before deleting the row.
export async function deleteFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || faction.name === "Unaffiliated") return;

  const unaffiliated = await prisma.faction.findFirst({ where: { name: "Unaffiliated" } });
  if (unaffiliated) {
    await prisma.character.updateMany({
      where: { factionId },
      data: { factionId: unaffiliated.id, isLeader: false },
    });
  }

  await prisma.faction.delete({ where: { id: factionId } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_deleted",
      details: { factionId, name: faction.name },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players");
}

