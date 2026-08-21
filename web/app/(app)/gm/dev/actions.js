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
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import {
  ensureCharacterRole,
  syncCharacterLocationAccess,
  deleteCharacterRole,
  updateGuildNickname,
  syncCharacterNarrowcastAccess,
  killCharacter,
  listGuildMembers,
  removeCursedRole,
  getGmSession,
} from "@/lib/discordGuild";
import { getFactionAncestorIds } from "@/lib/factionPermissions";
import { addToStack } from "@/lib/requestEffects";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

// The character editor at /gm/dev/characters/[characterId] is reachable by
// any in-game GM (not just superadmins) via character-name links elsewhere
// in the app — these three actions back that page, so they gate on isGm
// rather than requireSuperadmin like the rest of this file.
async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId || !gm) {
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
      messageWipeEnabled: formData.get("messageWipeEnabled") === "on",
      tupperAutocorrectEnabled: formData.get("tupperAutocorrectEnabled") === "on",
      productionCoefficient: floatOrDefault(formData, "productionCoefficient", 1),
      startingTagPoints: intOrZero(formData, "startingTagPoints"),
      // Guarded at 1 because it's the denominator of every weighted role's
      // seat cap — a 0 here would collapse the whole role picker.
      playerCount: Math.max(1, intOrZero(formData, "playerCount")),
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
  // Both knobs feed the character-creation wizard's budget and seat caps.
  revalidatePath("/character");
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
// Discord provisioning pointers (turnsAnnouncementChannelId/MessageId,
// locationPromptChannelId/MessageId): those self-heal on their own.
const DEFAULT_GAME_CONFIG = {
  lifewebBlood: 100,
  lifewebDecayPerTurn: 10,
  messageWipeEnabled: false,
  tupperAutocorrectEnabled: true,
  productionCoefficient: 1,
  startingTagPoints: 12,
  playerCount: 100,
};

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row (characters, tags-on-characters, Moves, default efforts, notes, DM
// log, audit log, silo history), resets GameConfig's balance knobs to their
// schema defaults, clears every Discord channel this game has actually
// written to (#archive, #turns, and every Location's plain/public/private
// channel — messages, forum posts, and threads, public or private), and
// opens a fresh Turn 1/DAWN. Then re-syncs every YAML master, in dependency
// order, so the game starts from the canonical sets:
//   locations (docs/locations.yaml) -> tags (docs/tags.yaml) -> roles (docs/roles.yaml)
// Roles resolve a starting Location and validate starting_tags, so that
// order is load-bearing, not cosmetic. The #radio/#intercom channel ids on
// GameConfig are left untouched (same "self-heals, provisioning is one-time"
// treatment as turnsAnnouncementChannelId) rather than reset here.
//
// The three syncs do NOT share one contract, which is worth knowing before
// relying on any of them: syncLocationsFromYaml is fully destructive (a
// Location dropped from the YAML has its Discord category+channels deleted
// and its row removed), syncRolesFromYaml prunes only rows nothing
// references, and syncTagsFromYaml is a pure upsert that never deletes.
// Faction silos reset to 0, same "back to day one" treatment as the Turn
// counter, rather than carrying over stale economy numbers.
//
// Requires typing the literal string "WIPE" in the confirm field — this is
// the most destructive action in the Dev Panel and has no undo.
export async function wipeGameData(formData) {
  const session = await requireSuperadmin();

  if (str(formData, "confirm").trim() !== "WIPE") {
    throw new Error('Type "WIPE" (all caps) to confirm.');
  }

  const [characters, members] = await Promise.all([
    prisma.character.findMany({ select: { discordUserId: true, discordRoleId: true } }),
    listGuildMembers(),
  ]);
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  const cursedMemberIds = cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [];

  // Best-effort Discord cleanup first, while the Character rows (and their
  // discordRoleId/discordUserId) still exist to look up. Channel wiping is
  // its own slow, sequential pass (see fullWipe.js) so it runs alongside
  // the per-character role/nickname cleanup rather than blocking it. A full
  // restart should not leave anyone still cursed from the last game, so
  // every member currently holding the Cursed role gets it stripped too.
  await Promise.all([
    ...characters.flatMap((c) => [
      c.discordRoleId ? deleteCharacterRole(c.discordRoleId).catch(() => {}) : null,
      updateGuildNickname(c.discordUserId, null).catch(() => {}),
    ]).filter(Boolean),
    ...cursedMemberIds.map((id) => removeCursedRole(id)),
    runFullChannelWipe(prisma).catch((err) => console.error("Full channel wipe failed:", err)),
  ]);

  // Deletes ordered so dependents go before the Character/Turn rows they
  // reference (Prisma doesn't cascade by default here).
  await prisma.$transaction([
    prisma.note.deleteMany({}),
    prisma.defaultEffort.deleteMany({}),
    prisma.action.deleteMany({}),
    prisma.characterTag.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.character.deleteMany({}),
    prisma.turn.deleteMany({}),
    prisma.siloTransaction.deleteMany({}),
    prisma.directMessage.deleteMany({}),
    prisma.faction.updateMany({ data: { silo: 0 } }),
    prisma.gameConfig.update({
      where: { id: 1 },
      data: { ...DEFAULT_GAME_CONFIG, nextWeather: null, nextTurnNote: null },
    }),
  ]);

  await prisma.turn.create({
    data: { number: 1, phase: "DAWN", weather: "CLEAR", status: "OPEN", gameDate: new Date() },
  });

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

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_game_wipe",
      details: { locationSync, tagSync, roleSync },
    },
  });

  revalidatePath("/", "layout");
}

export async function updateCharacterRaw(formData) {
  await requireGm();

  const characterId = str(formData, "characterId");
  if (!characterId) return;

  const existing = await prisma.character.findUnique({ where: { id: characterId } });

  const factionId = str(formData, "factionId").trim() || null;
  const locationId = str(formData, "locationId").trim() || null;
  const appearance = str(formData, "appearance").trim() || null;
  const roleId = str(formData, "roleId").trim() || null;

  // Picking a Role from the dropdown restamps the display title from the
  // catalog; roleTitle stays hand-editable for off-catalog cases.
  const role = roleId ? await prisma.role.findUnique({ where: { id: roleId } }) : null;
  const roleTitle = role ? role.name : str(formData, "roleTitle").trim() || null;

  // zoneId mirrors location.zoneId whenever a Location is set (see the
  // Location model comment in schema.prisma) — a raw zoneId field is only
  // meaningful for a character with no specific Location yet.
  let zoneId = str(formData, "zoneId").trim() || null;
  if (locationId) {
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    zoneId = location?.zoneId ?? zoneId;
  }

  const status = str(formData, "status");

  const updated = await prisma.character.update({
    where: { id: characterId },
    data: {
      name: str(formData, "name").trim(),
      roleTitle,
      roleId,
      factionId,
      zoneId,
      locationId,
      isLeader: formData.get("isLeader") === "on",
      isTreasurer: formData.get("isTreasurer") === "on",
      status,
      resources: intOrZero(formData, "resources"),
      tagPoints: intOrZero(formData, "tagPoints"),
      appearance,
    },
  });

  // Death is the one status change with side effects: killCharacter deletes
  // the personal Discord role (which takes its Location and narrowcast
  // overwrites with it), clears the nickname, and grants the Cursed role.
  // Everything below is skipped for a dead character — re-syncing the role of
  // a corpse is exactly the bug this replaces.
  if (status === "DEAD" && existing?.status !== "DEAD") {
    await killCharacter(updated).catch((err) => console.error("killCharacter failed:", err));
  } else if (status === "ALIVE") {
    await ensureCharacterRole(updated).catch(() => {});
    if (existing?.locationId !== locationId) {
      await syncCharacterLocationAccess(updated.discordRoleId, existing?.locationId ?? null, locationId).catch(() => {});
      await syncCharacterNarrowcastAccess(characterId).catch(() => {});
    }
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: (await auth()).discordUserId,
      actionType: "superadmin_character_edit",
      targetCharacterId: characterId,
    },
  });

  revalidatePath("/gm/dev/characters");
  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/gm/players");
  revalidatePath("/character");
}

export async function grantTag(formData) {
  const session = await requireGm();

  const characterId = str(formData, "characterId");
  const tagId = str(formData, "tagId");
  if (!characterId || !tagId) return;

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) return;

  // Create-or-increment: granting a stackable tag a second time adds to the
  // stack rather than colliding with @@unique([characterId, tagId]).
  await addToStack(prisma, characterId, tagId, 1, {
    source: "GM_GRANT",
    stackable: tag.stackable,
  });

  // A granted tag may affect narrowcast access (#radio, #intercom).
  await syncCharacterNarrowcastAccess(characterId).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_tag_grant",
      targetCharacterId: characterId,
      details: { tagId, tagName: tag.name },
    },
  });

  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/character");
}

export async function revokeTag(formData) {
  const session = await requireGm();

  const characterTagId = str(formData, "characterTagId");
  const characterId = str(formData, "characterId");
  if (!characterTagId) return;

  // One unit at a time for a stack, the whole row otherwise — so a GM
  // correcting an over-grant doesn't wipe a player's whole larder.
  const ct = await prisma.characterTag.findUnique({
    where: { id: characterTagId },
    include: { tag: true },
  });
  if (!ct) return;
  if (ct.tag.stackable && ct.quantity > 1) {
    await prisma.characterTag.update({
      where: { id: ct.id },
      data: { quantity: ct.quantity - 1 },
    });
  } else {
    await prisma.characterTag.delete({ where: { id: ct.id } }).catch(() => null);
  }

  await syncCharacterNarrowcastAccess(ct.characterId).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_tag_revoke",
      targetCharacterId: characterId || ct.characterId,
      details: { tagId: ct.tagId },
    },
  });

  revalidatePath(`/gm/dev/characters/${characterId || ct.characterId}`);
  revalidatePath("/character");
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
}

