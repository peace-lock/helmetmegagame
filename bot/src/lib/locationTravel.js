const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  performLocationMove,
  dragCandidates,
  freeMovesLeft,
  CHARACTER_SELECT,
} = require("@lifeweb/db/lib/locationTravel");
const { stowedMounts } = require("@lifeweb/db/lib/mounts");
const { applyLocationMoveSideEffects } = require("@lifeweb/db/lib/locationMove");
const { putChannelOverwrite } = require("@lifeweb/db/lib/discordRest");
const { LOCATION_MEMBER_ALLOW } = require("@lifeweb/db/lib/zoneChannelSpec");
const { sendDm } = require("@lifeweb/db/lib/dm");

// The gateway half of the Travel flow. Every rule and every database write
// lives in db/lib/locationTravel.js so the web app runs the identical ones;
// this file is the Discord vocabulary around it — the pickers, the pending
// drag list, and the REST side effects db/lib/locationMove.js owns.
//
// Custom ids, all "loc:"-namespaced (COMMANDS.md): loc:open (the #turns
// console button, unchanged since the zone rework and baked into consoles
// already posted), loc:pick, loc:drag:{locationId}, loc:confirm:{locationId},
// loc:cancel. The anchor buttons loc:who / loc:secret / loc:converse, and
// loc:gate:{linkId} for a modular gate, are defined in
// db/lib/locationAnchorRow.js, because the sync posts them.

// Discord's hard cap on select-menu options, and on max_values with them.
const MENU_OPTION_LIMIT = 25;

const PICK_ID = "loc:pick";
const DRAG_PREFIX = "loc:drag:";
const CONFIRM_PREFIX = "loc:confirm:";
const CANCEL_ID = "loc:cancel";

// discordUserId -> { locationId, draggedIds, at }. The drag multi-select and
// the Confirm button are two separate interactions on one ephemeral message,
// and Discord hands the second one no memory of the first — so the picked
// list is parked here between them. Same posture as recentProxies in
// bot/src/lib/proxy.js: in-memory, bounded by a TTL, and never a gate. A
// missing entry means "nobody picked", not "refuse the move", so a restart
// between the two clicks costs a player their passengers and nothing else.
const DRAG_TTL_MS = 10 * 60_000;
const pendingDrags = new Map();

function pruneDrags(now) {
  for (const [userId, entry] of pendingDrags) {
    if (now - entry.at > DRAG_TTL_MS) pendingDrags.delete(userId);
  }
}

function rememberDrag(discordUserId, locationId, draggedIds) {
  const now = Date.now();
  pruneDrags(now);
  pendingDrags.set(discordUserId, { locationId, draggedIds: [...draggedIds], at: now });
}

// Reads and clears in one step: a confirmed move must not leave a list behind
// for the next one to inherit.
function takeDrag(discordUserId, locationId) {
  const entry = pendingDrags.get(discordUserId);
  pendingDrags.delete(discordUserId);
  if (!entry) return [];
  if (entry.locationId !== locationId) return [];
  if (Date.now() - entry.at > DRAG_TTL_MS) return [];
  return entry.draggedIds;
}

function forgetDrag(discordUserId) {
  pendingDrags.delete(discordUserId);
}

// The mover, loaded with exactly the shape performLocationMove and canDrag
// need — a partial row here would silently mis-authorize a drag.
async function loadMover(discordUserId) {
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: CHARACTER_SELECT,
  });
}

// "A", "A and B", "A, B and C".
function listNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// `from` is the mover's current location (null on a first placement, which is
// arrival rather than travel and costs nothing). The option description is
// the whole cost model in one line: a step inside the zone is free on a
// cooldown, an edge that leaves the zone spends the Move.
function buildLocationSelectRow(locations, from) {
  const shown = locations.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(PICK_ID)
    .setPlaceholder("Choose where to go… ‡")
    .addOptions(
      shown.map((location) => ({
        label: location.name.slice(0, 100),
        value: location.id,
        description: (from
          ? location.zoneId === from.zoneId
            ? "Same zone ‡"
            : `Crosses into ${location.zone?.name ?? "another zone"} — would cost your Move`
          : `${location.zone?.name ?? "Somewhere"} ‡`
        ).slice(0, 100),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Null when nobody can be brought — an empty select menu is rejected by
// Discord, and a disabled one just asks a question with no answer.
function buildDragRow(locationId, candidates) {
  const shown = candidates.slice(0, MENU_OPTION_LIMIT);
  if (shown.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${DRAG_PREFIX}${locationId}`)
    .setPlaceholder("Bring anyone along? ‡")
    .setMinValues(0)
    .setMaxValues(shown.length)
    .addOptions(
      shown.map((candidate) => ({
        label: candidate.name.slice(0, 100),
        value: candidate.id,
        description: `${candidate.reason} ‡`.slice(0, 100),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildConfirmRow(locationId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_PREFIX}${locationId}`)
      .setLabel("Confirm ‡")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel ‡").setStyle(ButtonStyle.Secondary),
  );
}

// Executes a validated move. performLocationMove owns the rules and the
// writes; everything below is the Discord work it deliberately leaves to its
// caller, run per moved character and never allowed to throw — a failed role
// swap must not make a committed move look refused. The channel doctor
// reconciles whatever a miss here leaves.
async function performMove(character, targetLocation, dragged = []) {
  const result = await performLocationMove(prisma, character, targetLocation, { dragged });
  if (!result.ok) return result;

  // Sequential on purpose: each entry is a handful of REST calls, and firing
  // a whole dragged party's worth at once is the shape that trips the
  // invalid-response breaker (db/lib/discordRest.js).
  for (const entry of result.moved) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: entry.character.id,
      fromLocationId: entry.fromLocationId,
      toLocationId: entry.toLocationId,
    }).catch((err) =>
      console.error(`Move side effects failed for ${entry.character.name}:`, err.message ?? err),
    );
  }

  // The Caving Die's "on arrival" trigger — see db/lib/locationTravel.js and
  // docs/systemdocs/CAVING.md. Null on any zone that isn't a cave level, or
  // if the character had already rolled for this turn some other way.
  for (const entry of result.moved) {
    if (!entry.cavingDm) continue;
    await sendDm(prisma, entry.cavingDm.discordUserId, entry.cavingDm.content).catch((err) =>
      console.error(`Caving arrival DM to ${entry.cavingDm.discordUserId} failed:`, err.message ?? err),
    );
  }

  // Being carried off is the one thing that happens to a player without them
  // pressing anything, so it is the one thing that has to be told. Corpses
  // and departed accounts are skipped. db/lib/dm.js#sendDm writes the "»".
  for (const entry of result.moved) {
    if (entry.character.id === character.id) continue;
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(
      prisma,
      entry.character.discordUserId,
      `*${character.name} brought you along to ${targetLocation.name}.* ‡`,
      { source: "system_notice" },
    ).catch((err) =>
      console.error(`Drag DM to ${entry.character.discordUserId} failed:`, err.message ?? err),
    );
  }

  return result;
}

// A rejoining player comes back with every role stripped by Discord AND with
// their Location overwrite swept by the guildMemberRemove path, so this is a
// pure re-grant with nothing to move away from — the same shape Revive uses
// (CHARACTERS.md §5b). Gateway-side because guildMemberAdd already holds the
// member; the Location half is REST, because an overwrite is a channel edit
// rather than a member edit.
async function restoreStandingRoles(member, character) {
  const zoneRoleId = character.zone?.discordRoleId ?? null;
  if (zoneRoleId) {
    await member.roles
      .add(zoneRoleId)
      .catch((err) =>
        console.error(
          `Failed to grant ${member.id} the ${character.zone?.name ?? "zone"} role:`,
          err.message,
        ),
      );
  }

  const channelId = character.location?.discordChannelId ?? null;
  if (channelId) {
    await putChannelOverwrite(channelId, member.id, {
      allow: String(LOCATION_MEMBER_ALLOW),
      type: 1,
    }).catch((err) =>
      console.error(
        `Failed to reopen ${character.location?.name ?? "location"} to ${member.id}:`,
        err.message,
      ),
    );
  }
}

module.exports = {
  MENU_OPTION_LIMIT,
  PICK_ID,
  DRAG_PREFIX,
  CONFIRM_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildDragRow,
  buildConfirmRow,
  rememberDrag,
  takeDrag,
  forgetDrag,
  performMove,
  restoreStandingRoles,
  freeMovesLeft,
  stowedMounts,
};
