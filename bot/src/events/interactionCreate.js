const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { prisma, concealedAlias } = require("@lifeweb/db");
const { isUnaffiliated } = require("@lifeweb/db/lib/factionConstants");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  loadConcealment,
  loadForcedName,
  presentedIdentity,
} = require("@lifeweb/db/lib/presentedIdentity");
const {
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
  freeMovesLeft,
  stowedMounts,
  performMove,
} = require("../lib/locationTravel");
const { dragCandidates } = require("@lifeweb/db/lib/locationTravel");
const {
  travelOptions,
  canToggleGate,
  gateOperable,
  endpoints,
  linksFor,
  isHeldOpen,
  KEYED_OPEN_MS,
} = require("@lifeweb/db/lib/locationGraph");
const { reconcileNarrowcastAccess } = require("@lifeweb/db/lib/locationMove");
const {
  syncCharacterRoomAccess,
  accessibleRooms,
  roomAccessKeys,
  heldTagSlugs,
} = require("@lifeweb/db/lib/roomAccess");
const { settleCarry, deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { sendDm } = require("../lib/dm");
const { buildMoveModal } = require("../lib/moveModal");
const { confirmMove } = require("../lib/moveConfirm");
const { buildSpeakModal, buildSpeakPicker } = require("../lib/speakModal");
const { listSpeakTargets, canSpeakInTarget, canSpeakInChannel, isNavValue } = require("../lib/speakTargets");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../lib/interactionGuild");
const { postAsCharacterTo } = require("../lib/proxy");
const { resolveLaborRate, qualityWord } = require("@lifeweb/db");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { HEALTH_CATEGORY } = require("@lifeweb/db/lib/medicalVision");
const { moveWindow, epochSeconds } = require("@lifeweb/db/lib/turnClock");
const { rollDie } = require("@lifeweb/db/lib/moveEffects");
const { messageLink } = require("../lib/mentions");
const { startPrivateThread, addThreadMember, removeThreadMember } = require("@lifeweb/db/lib/discordRest");
const {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
} = require("@lifeweb/db/lib/locationAnchorRow");
const { refreshLocationAnchor } = require("@lifeweb/db/lib/syncZones");
const { describeLocation, hasAttribute } = require("@lifeweb/db/lib/locationAttributes");
const { loadDepot, depotPowered, fuelTurnsLeft } = require("@lifeweb/db/lib/depotState");
const { structuresAt, HOLDS_EDGE } = require("@lifeweb/db/lib/structures");
const {
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
} = require("@lifeweb/db/lib/roomStarterRow");
const { INTERCOM_ROOM_SLUG, broadcastIntercom } = require("@lifeweb/db/lib/intercom");
const { INTERCOM_MODAL_PREFIX, buildIntercomModal } = require("../lib/intercomModal");
const {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  buildTurretModal,
  turretWordMatches,
} = require("../lib/turretModal");
const {
  GATEHOUSE_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
  gatehouseTurretArmed,
} = require("@lifeweb/db/lib/gatehouseTurret");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { handleRoomStorage } = require("../lib/roomStorage");
const {
  buildConverseModal,
  CONVERSE_MODAL_PREFIX,
  CONVERSE_NAME_FIELD,
} = require("../lib/converseModal");
const { resolveChannelContext } = require("../lib/channels");
const { ack, respond, scheduleDismiss } = require("../lib/respond");
const { handleReportOpen, handleReportClose } = require("../lib/reportChannel");
const { BIRD_REPLY_PREFIX, BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { handleBirdReplyOpen, handleBirdReplyPick } = require("../lib/birdReply");
const { NOTICEBOARD_PREFIX } = require("@lifeweb/db/lib/locationAnchorRow");
const {
  READ_PREFIX: NOTICE_READ_PREFIX,
  TEAR_PREFIX: NOTICE_TEAR_PREFIX,
  PIN_PREFIX: NOTICE_PIN_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
} = require("../lib/noticeboardPanel");
const { OFFER_ACCEPT_PREFIX, OFFER_DECLINE_PREFIX } = require("@lifeweb/db/lib/offerRow");
const { handleOfferAccept, handleOfferDecline } = require("../lib/offers");
const {
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
} = require("@lifeweb/db/lib/threats");
const { handleThreatSpawnAccept, handleThreatSpawnDecline } = require("../lib/threatSpawn");
const {
  OPEN_PREFIX: EDIT_OPEN_PREFIX,
  MODAL_PREFIX: EDIT_MODAL_PREFIX,
  handleEditOpen,
  handleEditSubmit,
} = require("../lib/editModal");
const { OPEN_BUTTON_ID: REPORT_OPEN_ID, CLOSE_BUTTON_ID: REPORT_CLOSE_ID } = require("@lifeweb/db/lib/reportChannelAccess");

// The conversation-room select, the one custom id in this flow that isn't
// defined next to the component that carries it (the modal's lives in
// bot/src/lib/converseModal.js, the anchor buttons' in
// db/lib/locationAnchorRow.js, the travel flow's in
// bot/src/lib/locationTravel.js).
const CONVERSE_ROOM_PREFIX = "conv:room:";

// "a young man" / "an old woman" — the alias as it reads mid-sentence.
function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  await ack(interaction);

  const content = interaction.options.getString("message", true);
  const attachment = interaction.options.getAttachment("attachment");

  try {
    await interaction.channel.send({ content, files: attachment ? [attachment.url] : [] });
  } catch (err) {
    console.error("Failed to send /gm message:", err);
    await respond(interaction, "» *That didn't send. Check the bot can post here, and try again.*");
    return;
  }
  await respond(interaction, "» *Sent.*", { fleeting: true });
}

// /dm: DM a chosen server member as the bot itself, logged via
// bot/src/lib/dm.js#sendDm like every other bot-sent DM.
async function handleGmDmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  await ack(interaction);

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`, { authorDiscordUserId: interaction.user.id, source: "gm_slash" });
    await respond(interaction, `» *Sent to ${recipient}.*`, { fleeting: true });
  } catch (err) {
    console.error("Failed to send /dm DM:", err);
    // 50007 is the real closed-DMs code; an over-length message fails the
    // same way and must not be misreported as closed DMs.
    const closed = err.code === 50007 || err.status === 403;
    await respond(
      interaction,
      closed
        ? "» *Couldn't deliver that — they have DMs closed.*"
        : "» *Couldn't deliver that. It wasn't their DM settings; check the logs.*",
    );
  }
}

// /add and /remove work on two things, and the channel decides which.
//
//   - A Conversation (a PlayerThread row): /add records a PlayerThreadInvite
//     and works on any living character wherever they stand, applied at once
//     if they are already here and replayed by applyPendingInvites on arrival
//     (db/lib/threadInvites.js).
//   - A private Room: /add writes a RoomGuest row, which is the ONE way into
//     a private thread without one of its access tags. The target has to be
//     standing here, because the grant is spent the moment they leave
//     (db/lib/roomAccess.js) — inviting somebody far away would hand them a
//     row that dies before they ever saw the door.
//
// A public Room takes neither: everyone standing in the Location can already
// read it.
async function handleThreadMemberCommand(interaction, action) {
  await ack(interaction);

  const channel = interaction.channel;
  if (!channel) {
    await respond(interaction, "» *That only works inside a conversation or a private room.* ‡");
    return;
  }

  const [row, room] = await Promise.all([
    prisma.playerThread.findUnique({
      where: { threadId: channel.id },
      include: { location: { select: { name: true } } },
    }),
    prisma.room.findFirst({
      where: { discordThreadId: channel.id },
      select: {
        id: true,
        name: true,
        kind: true,
        accessTagSlugs: true,
        locationId: true,
        discordThreadId: true,
        location: { select: { name: true } },
      },
    }),
  ]);

  if (room) {
    await handleRoomGuestCommand(interaction, action, room);
    return;
  }
  if (!row) {
    await respond(interaction, "» *That only works inside a conversation or a private room.* ‡");
    return;
  }

  const gm = isGmMember(interaction);
  if (!gm) {
    const member = await channel.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await respond(interaction, "» *You're not in this conversation.* ‡");
      return;
    }
  }

  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
  });
  if (!target) {
    await respond(interaction, "» *That isn't a living character's role.* ‡");
    return;
  }

  if (action === "remove") {
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: channel.id, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err));
    try {
      await channel.members.remove(target.discordUserId);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from thread ${channel.id}:`, err);
      await respond(interaction, "» *Couldn't remove them. The bot may be missing Manage Threads.* ‡");
      return;
    }
    await respond(interaction, `» *${target.name} was removed.* ‡`, { fleeting: true });
    return;
  }

  await prisma.playerThreadInvite
    .upsert({
      where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
      update: {},
      create: { threadId: channel.id, characterId: target.id },
    })
    .catch((err) => console.error("Failed to record thread invite:", err));

  if (target.locationId === row.locationId) {
    try {
      await addThreadMember(channel.id, target.discordUserId);
    } catch (err) {
      console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err);
    }
    await notifyLetIn(interaction, target, row.name, row.location?.name, channel.id);
    await respond(interaction, `» *${target.name} was added.* ‡`, { fleeting: true });
    return;
  }
  await respond(
    interaction,
    `» *${target.name} is invited — they'll see this when they reach ${row.location?.name ?? "this place"}.* ‡`,
    { fleeting: true },
  );
}

// Telling somebody a door opened for them. Discord's own "you were added to a
// thread" notice is easy to miss and says nothing about where, so this carries
// the place and a link — never the content, the same rule notifyMentioned
// keeps (bot/src/lib/mentions.js).
async function notifyLetIn(interaction, target, threadName, placeName, threadId) {
  if (!target.discordUserId) return;
  const where = placeName ? `${placeName} · ${threadName}` : threadName;
  const user = await interaction.client.users.fetch(target.discordUserId).catch(() => null);
  if (!user) return;
  const link = `https://discord.com/channels/${interaction.guildId}/${threadId}`;
  await sendDm(user, `» *You were let into ${where}.* ‡\n${link}`, { source: "system_notice" }).catch(() => {});
}

// The Room half of /add and /remove.
//
// Who may work the door: anyone already inside it, which — because membership
// is pulled from standing here with a key or a guest row — is exactly the set
// the fiction wants. A GM may always.
//
// /remove refuses a key-holder on purpose. Their key is what admits them, and
// the next arrival or tag change would let them straight back in; taking the
// key is the real removal, so say so rather than doing something that undoes
// itself.
async function handleRoomGuestCommand(interaction, action, room) {
  if (room.kind !== "PRIVATE") {
    await respond(interaction, "» *Anyone standing here can already walk in.* ‡");
    return;
  }

  const gm = isGmMember(interaction);
  if (!gm) {
    const member = await interaction.channel.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await respond(interaction, "» *You're not in this room.* ‡");
      return;
    }
  }

  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
  });
  if (!target) {
    await respond(interaction, "» *That isn't a living character's role.* ‡");
    return;
  }
  if (target.locationId !== room.locationId) {
    await respond(interaction, `» *${target.name} isn't here to be let in.* ‡`);
    return;
  }

  if (action === "remove") {
    const held = await heldTagSlugs(prisma, target.id);
    if (room.accessTagSlugs.some((slug) => held.has(slug))) {
      await respond(interaction, "» *Their key admits them. Take the key.* ‡");
      return;
    }
    await prisma.roomGuest
      .deleteMany({ where: { roomId: room.id, characterId: target.id } })
      .catch((err) => console.error("Failed to delete room guest:", err));
    // No account behind the character means there is no thread member to drop.
    // Calling with an undefined id fails, and the catch below would report it
    // as a missing bot permission — a wrong answer to a question nobody asked.
    if (!target.discordUserId) {
      await respond(interaction, `» *${target.name} was shown out.* ‡`, { fleeting: true });
      return;
    }
    try {
      await removeThreadMember(room.discordThreadId, target.discordUserId);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from room ${room.id}:`, err);
      await respond(interaction, "» *Couldn't remove them. The bot may be missing Manage Threads.* ‡");
      return;
    }
    await respond(interaction, `» *${target.name} was shown out.* ‡`, { fleeting: true });
    return;
  }

  const actor = await findAliveCharacter(interaction.user.id);
  await prisma.roomGuest
    .upsert({
      where: { roomId_characterId: { roomId: room.id, characterId: target.id } },
      update: {},
      create: { roomId: room.id, characterId: target.id, invitedById: actor?.id ?? null },
    })
    .catch((err) => console.error("Failed to record room guest:", err));

  try {
    await addThreadMember(room.discordThreadId, target.discordUserId);
  } catch (err) {
    console.error(`Failed to add ${target.discordUserId} to room ${room.id}:`, err);
  }
  await notifyLetIn(interaction, target, room.name, room.location?.name, room.discordThreadId);
  await respond(interaction, `» *${target.name} was let in. They stay until they leave.* ‡`, {
    fleeting: true,
  });
}

// The Council Room's Intercom button, and its modal.
//
// showModal IS the acknowledgement and must be the first thing that happens —
// a deferred interaction can no longer open one, and Discord allows three
// seconds. So the button does no database work at all, and every check waits
// for the submit. That is not a hole: an ephemeral modal outlives the player
// walking out of the Keep, so an open-time check would have to be re-run at
// submit anyway.
async function handleIntercomOpen(interaction, roomId) {
  await interaction.showModal(buildIntercomModal(roomId));
}

// The big red button in the Censor's Office. Opening the modal is not the act
// — the typed word is — so this only has to find out which way the switch is
// currently thrown. showModal IS the acknowledgement, so no ack() here.
async function handleTurretOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await interaction.reply({ content: "» *There's no button here.* ‡", ephemeral: true });
    return;
  }
  await interaction.showModal(buildTurretModal(roomId, await gatehouseTurretArmed(prisma)));
}

async function handleTurretSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "» *There's no button here.* ‡");
    return;
  }
  // Decided at submit, never at open: the modal outlives somebody walking out
  // of the Garrison, and reaching the switch is the only safeguard on it.
  if (character.locationId !== room.locationId) {
    await respond(interaction, `» *You're not standing in the ${room.name} any more.* ‡`);
    return;
  }

  // Re-read rather than trusting what the modal was built against — two people
  // in the office can open it at the same moment, and the word they were asked
  // to type is what says which way they meant to throw it.
  const armed = await gatehouseTurretArmed(prisma);
  if (!turretWordMatches(interaction.fields.getTextInputValue(TURRET_WORD_FIELD), armed)) {
    await respond(interaction, "» *You leave the button alone.* ‡");
    return;
  }

  const next = !armed;
  await prisma.gameConfig.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  // The yard hears it, and that is the only warning anybody in it gets. Best
  // effort — the switch is thrown either way.
  const gatehouse = await prisma.location
    .findUnique({ where: { slug: GATEHOUSE_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (gatehouse?.discordChannelId) {
    const line = next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE;
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(
      (err) => console.error("Gatehouse turret line failed:", err),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: character.id, characterName: character.name },
      },
    })
    .catch((err) => console.error("Gatehouse turret audit log failed:", err));

  await respond(
    interaction,
    next
      ? "» *The button clicks down. Somewhere below, the rotor comes alive.* ‡"
      : "» *The button clicks up, and the yard goes quiet.* ‡",
  );
}

async function handleIntercomSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== INTERCOM_ROOM_SLUG) {
    await respond(interaction, "» *There's no intercom here.* ‡");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `» *You're not standing in the ${room.name} any more.* ‡`);
    return;
  }

  const body = interaction.fields.getTextInputValue("intercom:body").trim();
  if (!body) {
    await respond(interaction, "» *Say something first.* ‡");
    return;
  }

  const { sent, failed } = await broadcastIntercom(prisma, body);

  // The transcript. The old #intercom was a tupper channel, so PA traffic went
  // through the proxy and was archived like any other speech; a bot post is
  // not, so without this the Baron's announcements would be the one kind of
  // public talk missing from /archive. One row for the broadcast, not one per
  // zone — it was one thing said, heard in several places.
  //
  // The speaker IS recorded even though the channel line names nobody: the
  // archive is the record of what happened, and it stays shut to players until
  // the game ends (GameConfig.archiveVisible, ARCHIVE.md).
  await recordArchiveMessage(prisma, {
    character,
    content: body,
    channelKind: "intercom",
  });

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "intercom_broadcast",
        targetCharacterId: character.id,
        details: { body, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch((err) => console.error("Intercom audit failed:", err.message ?? err));

  // Say what actually happened. A PA that reached four zones out of five is
  // not a failure, but the speaker has to know which one nobody heard. One ‡
  // for the whole message, riding the last line rather than the first.
  const note = failed.length > 0 ? `\n-# Nothing came through in ${failed.join(", ")}.` : "";
  await respond(interaction, `» *Your voice goes out across Ravenheart.*${note} ‡`, { fleeting: true });
}

// Custom IDs below are "loc:"-namespaced for the travel flow off the Travel
// button on the #turns console (bot/src/lib/turnsConsole.js, whose button
// keeps its historical "loc:open" id) and off the three buttons on every
// Location channel's anchor; "conv:" is the Conversation flow; "move:" and
// "say:" are the unrelated Move and Speak modals.

// loc:open, and its /location twin. Offers the Locations connected to where
// the character stands — or, on a first placement, every Location outside the
// caves, because arriving is not travel.
async function handleTravelOpen(interaction) {
  await ack(interaction);

  const character = await loadMover(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  let current = null;
  let destinations;
  let shut = [];
  if (!character.locationId) {
    destinations = await prisma.location.findMany({
      where: { zone: { kind: { not: "CAVE_GROUP" } } },
      include: { zone: true },
    });
    destinations.sort(
      (a, b) => (a.zone?.name ?? "").localeCompare(b.zone?.name ?? "") || a.name.localeCompare(b.name),
    );
  } else {
    current = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true },
    });
    // travelOptions has already dropped the hidden ways this character holds
    // no key to, and sorted the rest. A locked or shut one is still offered:
    // seeing the door and being told what opens it is the point of the locked
    // form, as against the hidden one.
    const rows = await travelOptions(prisma, character, character.locationId);
    destinations = rows.filter((row) => row.passable).map((row) => row.location);
    shut = rows.filter((row) => !row.passable);
  }

  if (destinations.length === 0 && shut.length === 0) {
    await respond(interaction, "» *Nowhere to go from here.* ‡");
    return;
  }

  // Never truncate silently: a missing destination reads as a broken map.
  const truncated = destinations.length - Math.min(destinations.length, MENU_OPTION_LIMIT);
  const shutLine =
    shut.length > 0
      ? `-# Closed to you right now: ${shut.map((row) => row.location.name).join(", ")}. ‡`
      : null;
  await respond(interaction, {
    content: [
      destinations.length > 0 ? "Where would you like to go? ‡" : "» *Every way out of here is closed to you.* ‡",
      shutLine,
      truncated > 0 ? `-# ${truncated} More options not shown.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    components: destinations.length > 0 ? [buildLocationSelectRow(destinations, current)] : [],
  });
}

// loc:gate:{linkId} — the Open/Close button on a modular gate's two anchors.
//
// The button is only rendered on the anchor, which anyone standing in the
// location can see, so authority is re-checked here rather than trusted:
// holding one of the gate's opener tags, or playing one of its opener Roles.
// A rendered button is a hint, not a lock.
//
// The flip is a conditional updateMany whose WHERE clause carries the state
// the clicker saw, the same shape the move cooldown and the mount claim use.
// Two watchmen clicking "Close" in the same second means one close and one
// "somebody just did", never a double toggle that lands back open.
async function handleGateToggle(interaction, linkId) {
  await ack(interaction);

  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      role: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const link = await prisma.locationLink.findUnique({
    where: { id: linkId },
    include: {
      a: true,
      b: true,
      // gateOperable needs to know whether anything holds a structural edge
      // — the same HOLDS_EDGE-filtered boolean's-worth LINK_INCLUDE loads.
      structures: { where: { status: { in: HOLDS_EDGE } }, select: { id: true } },
    },
  });
  // Covers "not modular" and "structural with nothing built holding it" —
  // an unheld ford has no mechanism, whatever a stale button claimed.
  if (!gateOperable(link)) {
    await respond(interaction, "» *There's no gate here to work.* ‡");
    return;
  }
  // You have to be standing on one side of it.
  if (character.locationId !== link.aId && character.locationId !== link.bId) {
    await respond(interaction, "» *You aren't standing at that gate.* ‡");
    return;
  }

  const allowed = canToggleGate(link, {
    tagSlugs: (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
    roleSlug: character.role?.slug ?? null,
  });
  if (!allowed) {
    await respond(interaction, "» *The gate's mechanism doesn't answer to you.* ‡");
    return;
  }

  const wantOpen = !link.isOpen;
  // The permission verdict above read a snapshot, and the flip must not
  // trust it across time: a structural gate's mechanism EXISTS only while a
  // structure holds it, and a destroy or a build-undo can revert the edge
  // to the very isOpen the clicker saw — so a bare (id, isOpen) claim would
  // let a stale button work a gate that is no longer there. Lock the row,
  // re-read the holder-filtered state, and re-run both predicates.
  let outcome = "flipped";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LocationLink" WHERE "id" = ${link.id} FOR UPDATE`;
    const fresh = await tx.locationLink.findUnique({
      where: { id: link.id },
      include: { structures: { where: { status: { in: HOLDS_EDGE } }, select: { id: true } } },
    });
    if (!gateOperable(fresh)) {
      outcome = "gone";
      return;
    }
    if (fresh.isOpen !== link.isOpen) {
      outcome = "raced";
      return;
    }
    await tx.locationLink.update({ where: { id: link.id }, data: { isOpen: wantOpen } });
  });
  if (outcome === "gone") {
    await respond(interaction, "» *There's no gate here to work.* ‡");
    return;
  }
  if (outcome === "raced") {
    await respond(interaction, "» *Somebody just beat you to it.* ‡");
    return;
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: wantOpen ? "gate_opened" : "gate_closed",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], isOpen: wantOpen },
    },
  });

  // Both sides: the gate has a button on each anchor, and shutting it from
  // one must not leave the other advertising "Open".
  for (const locationId of [link.aId, link.bId]) {
    await refreshLocationAnchor(prisma, locationId).catch((err) =>
      console.error(`Gate anchor refresh failed for ${locationId}:`, err.message ?? err),
    );
  }

  const farName = endpoints(link, character.locationId).far.name;
  await respond(
    interaction,
    wantOpen
      ? `» *You open the way to ${farName}.* ‡`
      : `» *You shut the way to ${farName}.* ‡`,
  );
}

// loc:keyed:{linkId}:{yes|no} — the answer to "Leave open for the next 24
// hours?" on the DM a keyed crossing raised.
//
// Re-checked rather than trusted: the button was DM'd to a key-holder, but a
// DM is a durable surface and the key can change hands or be lost between the
// crossing and the click. Whoever presses it must still hold the key.
//
// "Leave it open" is a conditional updateMany against the window the clicker
// was shown, so two people propping the same door in the same moment cannot
// stack two windows — the second is told it is already held.
async function handleKeyedPrompt(interaction, payload) {
  await ack(interaction, { update: true });

  const [linkId, answer] = [payload.slice(0, payload.lastIndexOf(":")), payload.slice(payload.lastIndexOf(":") + 1)];

  const link = await prisma.locationLink.findUnique({
    where: { id: linkId },
    include: { a: true, b: true },
  });
  if (!link?.keyed) {
    await respond(interaction, { content: "» *There's no door here to hold.* ‡", components: [] });
    return;
  }
  const between = `${link.a.name} and ${link.b.name}`;

  if (answer === "no") {
    await respond(interaction, { content: `» *You let the way between ${between} fall shut.* ‡`, components: [] });
    return;
  }

  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: { id: true, tags: { select: { tag: { select: { slug: true } } } } },
  });
  const holdsKey = (character?.tags ?? []).some((ct) => ct.tag?.slug === link.requiredTagSlug);
  if (!holdsKey) {
    await respond(interaction, { content: "» *You no longer have what holds that open.* ‡", components: [] });
    return;
  }

  if (isHeldOpen(link)) {
    await respond(interaction, { content: `» *The way between ${between} is already being held open.* ‡`, components: [] });
    return;
  }

  const openUntil = new Date(Date.now() + KEYED_OPEN_MS);
  const claim = await prisma.locationLink.updateMany({
    where: { id: link.id, OR: [{ openUntil: null }, { openUntil: { lte: new Date() } }] },
    data: { openUntil },
  });
  if (claim.count === 0) {
    await respond(interaction, { content: `» *Somebody just beat you to it.* ‡`, components: [] });
    return;
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "keyed_way_held_open",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], openUntil: openUntil.toISOString() },
    },
  });

  await respond(interaction, {
    content:
      `» *You leave the way between ${between} open.* ‡\n` +
      `-# It stands open for 24 hours, and anyone can see and use it until then. ‡`,
    components: [],
  });
}

// One message carries both the passenger list and the confirmation, because
// Discord cannot keep them on two: an ephemeral reply is a single editable
// surface, and a second message would leave the first one lying around with
// live buttons on it.
async function handleTravelPick(interaction) {
  await ack(interaction, { update: true });

  const locationId = interaction.values[0];
  forgetDrag(interaction.user.id);

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  if (!target) {
    await respond(interaction, { content: "» *That place no longer exists.* ‡", components: [] });
    return;
  }
  if (!character) {
    await respond(interaction, { content: "» *You don't have a living character.* ‡", components: [] });
    return;
  }

  const candidates = await dragCandidates(prisma, character);
  const dragRow = buildDragRow(locationId, candidates);
  const overflow = candidates.length - Math.min(candidates.length, MENU_OPTION_LIMIT);

  // The cost model in one line, and — when they are about to walk a day's road
  // with a horse still in their pocket — a warning before the Confirm rather
  // than a regret after it (docs/systemdocs/CARRY.md §2).
  const crossing = Boolean(character.locationId) && character.zoneId !== target.zoneId;
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { freeZoneMovesPerTurn: true },
  });
  const openTurn = crossing ? await prisma.turn.findFirst({ where: { status: "OPEN" } }) : null;
  const left = crossing ? freeMovesLeft(character, config, openTurn) : null;

  const cost = !character.locationId
    ? "-# Arriving costs you nothing. ‡"
    : character.zoneId === target.zoneId
      ? "-# A step inside the zone is free. ‡"
      : left > 0
        ? `-# Crossing into ${target.zone.name} uses 1 of your ${left} free ${left === 1 ? "move" : "moves"} this turn. ‡`
        : `-# You have no free moves left, so crossing into ${target.zone.name} spends your Move. ‡`;

  const stowed = crossing ? stowedMounts(character.tags) : [];
  const stowedLine =
    stowed.length > 0
      ? `-# Your ${listNames(stowed)} ${stowed.length === 1 ? "isn't" : "aren't"} equipped, so ${stowed.length === 1 ? "it does" : "they do"} nothing for you. ‡`
      : null;

  await respond(
    interaction,
    {
      content: [
        `Move to **${target.name}**?`,
        cost,
        overflow > 0 ? `-# ${overflow} more not shown — Discord caps this list at 25. ‡` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      components: [dragRow, buildConfirmRow(locationId)].filter(Boolean),
    },
    { fleeting: false },
  );
}

// The picked passengers, parked until Confirm. deferUpdate rather than an
// `update` payload because the names have to be read first, and the list is
// re-authorized server-side at Confirm anyway — this is a hint, not a lock.
async function handleTravelDrag(interaction, locationId) {
  await interaction.deferUpdate();

  const ids = interaction.values ?? [];
  rememberDrag(interaction.user.id, locationId, ids);

  const chosen =
    ids.length > 0
      ? await prisma.character.findMany({ where: { id: { in: ids } }, select: { name: true } })
      : [];
  const lines = interaction.message.content
    .split("\n")
    .filter((line) => !line.startsWith("-# Bringing:"));
  if (chosen.length > 0) lines.push(`-# Bringing: ${chosen.map((c) => c.name).join(", ")} ‡`);

  await interaction.editReply({ content: lines.join("\n") }).catch((err) =>
    console.error("Failed to show the drag list:", err),
  );
}

async function handleTravelConfirm(interaction, locationId) {
  await interaction.deferUpdate();

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  const dragged = takeDrag(interaction.user.id, locationId);

  if (!character) {
    await respond(interaction, { content: "» *You don't have a living character.* ‡", components: [] });
    return;
  }
  if (!target) {
    await respond(interaction, { content: "» *That place no longer exists.* ‡", components: [] });
    return;
  }

  const result = await performMove(character, target, dragged);
  if (!result.ok) {
    await respond(interaction, { content: `» *${result.reason}*`, components: [] });
    return;
  }

  const brought = result.moved
    .filter((entry) => entry.character.id !== character.id)
    .map((entry) => entry.character.name);
  const parts = [`» Moved to **${target.name}**.`];
  if (result.spentTurn) parts.push("Your Move is spent.");
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.freeMovesLeft} free ${result.freeMovesLeft === 1 ? "move" : "moves"} left this turn.`
        : "That was your last free move this turn.",
    );
  }
  if (brought.length > 0) parts.push(`Bringing ${listNames(brought)}.`);

  await respond(interaction, { content: `${parts.join(" ")} ‡`, components: [] });
}

async function handleTravelCancel(interaction) {
  forgetDrag(interaction.user.id);
  await interaction.update({ content: "» *Canceled.* ‡", components: [] });
  scheduleDismiss(interaction);
}

// The green "Who's here?" button on a Location's anchor. Named characters
// first, with their Role for a fellow member of a real faction — the same
// rule the 🔍 inspect gate uses, because Role is same-faction knowledge and
// not Silo authority (FACTIONS.md §4a). Concealed characters are listed
// separately and only as what a stranger could tell at a glance. A forced
// name (Tag.forcedName) outranks both: it goes in the Here: list with no
// Role — a Role is as identifying as a name — and never in the concealed
// line even if Character.concealed is still on underneath.
async function handleWhosHere(interaction, locationId) {
  await ack(interaction);

  const [viewer, present] = await Promise.all([
    prisma.character.findFirst({
      where: { discordUserId: interaction.user.id, status: "ALIVE" },
      select: { factionId: true },
    }),
    prisma.character.findMany({
      where: { status: "ALIVE", locationId },
      select: {
        name: true,
        roleTitle: true,
        factionId: true,
        concealed: true,
        age: true,
        gender: true,
        faction: { select: { name: true, slug: true } },
        tags: {
          where: {
            OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
          },
          select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
        },
      },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    }),
  ]);

  if (present.length === 0) {
    await respond(interaction, "» *Nobody is here.* ‡");
    return;
  }

  // Concealed the same way the proxy decides it, not straight off the column:
  // a row still flagged concealed after the mask came off is speaking under its
  // own name, and listing it here as a stranger would be a lie the room can
  // check.
  const rows = present.map((c) => {
    const piece = concealmentFrom(c.tags);
    return { ...c, forcedName: forcedNameFrom(c.tags), concealed: Boolean(piece && (piece.forced || c.concealed)) };
  });
  const named = rows
    .filter((c) => !c.concealed || c.forcedName)
    .map((c) => {
      if (c.forcedName) return c.forcedName;
      const sameFaction =
        viewer?.factionId &&
        c.factionId === viewer.factionId &&
        !isUnaffiliated(c.faction) &&
        c.roleTitle;
      return sameFaction ? `${c.name}, ${c.roleTitle}` : c.name;
    });
  // No title on a concealed line: a Role is as identifying as a name.
  const hidden = rows
    .filter((c) => c.concealed && !c.forcedName)
    .map((c) => withArticle(concealedAlias(c).toLowerCase()));

  const lines = [];
  if (named.length > 0) lines.push(`**Here:** ${named.join(" | ")}`);
  if (hidden.length > 0) lines.push(`**Also here:** ${hidden.join(" | ")}`);
  await respond(interaction, `${lines.join("\n")} ‡`);
}

// "Secret rooms?": the doors this character can open here that nobody else
// can see they can. Private Rooms come from the key tags they hold
// (db/lib/roomAccess.js); Conversations come from having opened one or been
// invited to it.
// The Examine button on a Location anchor. Information only — it files
// nothing, costs nothing and can be pressed as often as you like.
//
// It answers one question, "what is this place?", in three parts: what can be
// worked here, what the place IS, and what the ways out are doing. The labor
// half is the old Labor? button unchanged — the LIVE coefficient
// (LocationYield.current) as a word rather than a number, because working out
// that Bountiful beats Ample is the player's job and the numbers move anyway
// (db/lib/laborYield.js). The rest comes from db/lib/locationAttributes.js.
//
// Deliberately readable by anyone standing here, whether or not they hold a
// Laboring tag — scouting a place is the point, and a scout reporting back to
// a hunter is a conversation the game wants.
async function handleExamine(interaction, locationId) {
  await ack(interaction);

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      name: true,
      indoors: true,
      attributes: true,
      yields: { select: { kind: true, current: true } },
    },
  });
  if (!location) {
    await respond(interaction, "» *That place is gone.* ‡");
    return;
  }

  // The gate state is read through the graph rather than off the anchor's
  // buttons, because a GM can flip an edge without anyone refreshing a
  // message and Examine must never be the stale one.
  const links = await linksFor(prisma, locationId);
  const gates = links
    .filter((link) => link.modular)
    .map((link) => ({
      isOpen: link.isOpen,
      farName: endpoints(link, locationId).far.name,
      // A shut structural edge with no holding structure (LINK_INCLUDE's
      // HOLDS_EDGE-filtered `structures`) Examines as unbuilt, not closed.
      unbuilt: Boolean(link.structural && !link.isOpen && !(link.structures?.length > 0)),
    }));

  const byKind = new Map(location.yields.map((row) => [row.kind, row.current]));
  const laborLine = LABOR_QUERY_KINDS.map(
    ({ kind, label }) => `**${label}**: ${qualityWord(byKind.get(kind) ?? null)}`,
  ).join(" | ");

  // The Depot's machinery is live state, so it is loaded here and handed to
  // describeLocation as ctx rather than being authored on the Location. Only
  // for the one room that has any — every other place gets no depot ctx and
  // prints no depot lines.
  let depot = null;
  if (hasAttribute(location, "depot")) {
    const row = await loadDepot(prisma);
    depot = {
      generatorOn: row.generatorOn,
      powered: depotPowered(row),
      fuelTurnsLeft: fuelTurnsLeft(row),
      turretArmed: row.turretArmed,
      shuttleDocked: row.shuttleState === "DOCKED",
    };
  }

  // Structures are live state — built, rising or ruined — so they are loaded
  // here and handed to describeLocation as ctx rather than being authored on
  // the Location, the same reasoning as depot above.
  const structures = await structuresAt(prisma, locationId);

  const lines = [
    `» *${location.name}.*`,
    laborLine,
    ...describeLocation(location, { gates, depot, structures }),
  ];
  await respond(interaction, lines.join("\n"));
}

// Fixed order, so the readout looks the same in every channel and a player can
// learn the shape rather than reading the labels every time.
const LABOR_QUERY_KINDS = [
  { kind: "HUNTING", label: "Hunting" },
  { kind: "FARMING", label: "Farming" },
  { kind: "FISHING", label: "Fishing" },
];

async function handleSecretRooms(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const [rooms, keys, invites] = await Promise.all([
    prisma.room.findMany({
      where: { locationId, kind: "PRIVATE", discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true, discordThreadId: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, character.id),
    prisma.playerThreadInvite.findMany({
      where: { characterId: character.id },
      select: { threadId: true },
    }),
  ]);

  const mine = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds);
  const conversations = await prisma.playerThread.findMany({
    where: {
      locationId,
      OR: [
        { creatorCharacterId: character.id },
        { threadId: { in: invites.map((i) => i.threadId) } },
      ],
    },
    select: { threadId: true },
    orderBy: { createdAt: "asc" },
  });

  const lines = [];
  if (mine.length > 0) {
    lines.push(`**Private Rooms:** ${mine.map((r) => `<#${r.discordThreadId}>`).join(" | ")}`);
  }
  if (conversations.length > 0) {
    lines.push(`**Conversations:** ${conversations.map((c) => `<#${c.threadId}>`).join(" | ")}`);
  }
  if (lines.length === 0) {
    await respond(interaction, "» *No secrets found here.* ");
    return;
  }
  await respond(interaction, `${lines.join("\n")} ‡`);
}

// "Converse": the only thread a player can still open. It is linked to a
// Room, and every 15 minutes that Room hears somebody is whispering
// (bot/src/lib/whisperPoll.js) — which is what keeps a private thread from
// being a place nobody can tell is happening.
async function handleConverseOpen(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }
  if (character.locationId !== locationId) {
    await respond(interaction, "» *You're not at that location any more.*");
    return;
  }

  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId, discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, character.id),
  ]);
  const options = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds).slice(0, MENU_OPTION_LIMIT);
  if (options.length === 0) {
    await respond(interaction, "» *There's no room here to hold a conversation in.* ‡");
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${CONVERSE_ROOM_PREFIX}${locationId}`)
    .setPlaceholder("Which room is this linked to? ‡")
    .addOptions(
      options.map((room) => ({
        label: room.name.slice(0, 100),
        value: room.id,
        ...(room.kind === "PRIVATE" ? { description: "Private ‡" } : {}),
      })),
    );

  await respond(interaction, {
    content: "Which room is this linked to? ‡\n-# People in that room will hear anonymous whispering.",
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// nothing is awaited here — every gate runs on submit.
async function handleConverseRoomPick(interaction) {
  await interaction.showModal(buildConverseModal(interaction.values[0]));
}

async function handleConverseCreate(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { location: true },
  });
  if (!room) {
    await respond(interaction, "» *That room no longer exists.* ‡");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `» *You're not in ${room.location.name} any more.* ‡`);
    return;
  }
  if (!room.location.discordChannelId) {
    await respond(interaction, "» *That place has no channel yet — tell a GM.* ‡");
    return;
  }

  const name = interaction.fields.getTextInputValue(CONVERSE_NAME_FIELD).trim().slice(0, 90);
  if (!name) {
    await respond(interaction, "» *Give it a name.* ‡");
    return;
  }

  // The thread hangs off the LOCATION channel, not the room thread: Discord
  // has no threads inside threads. The room is the link the whisper poll
  // reads, nothing more.
  let thread;
  try {
    thread = await startPrivateThread(room.location.discordChannelId, name);
    await addThreadMember(thread.id, interaction.user.id);
  } catch (err) {
    console.error(`Failed to open a conversation in ${room.location.name}:`, err);
    await respond(interaction, "» *Couldn't open that — try again, or tell a GM.* ‡");
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  await prisma.playerThread.create({
    data: {
      threadId: thread.id,
      name,
      locationId: room.locationId,
      roomId: room.id,
      creatorCharacterId: character.id,
      creatorDiscordUserId: character.discordUserId,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId,
        actionType: "conversation_opened",
        targetCharacterId: character.id,
        details: { threadId: thread.id, name, room: room.name, location: room.location.name },
      },
    })
    .catch((err) => console.error("Conversation audit log failed:", err));

  await respond(interaction, `» *Opened.* ‡\n<#${thread.id}>`, { fleeting: true });
}

// /conceal: a standing state, not a per-message prefix. While it is on, every
// message proxies under the alias with the unknown silhouette, and Who's here
// lists the alias instead of the name. A held forcesName tag refuses the
// toggle outright — that identity is fixed, and there is nothing to hide.
async function handleConcealCommand(interaction) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const forcedName = await loadForcedName(prisma, character.id);
  if (forcedName) {
    await respond(interaction, `» *You are ${forcedName} now. There is no hiding that.* ‡`);
    return;
  }

  // Concealment is a property of what you are wearing, not a free action. With
  // a bare face there is nothing to toggle; under something that forces it,
  // there is no choice to make in either direction. The column is left alone in
  // that second case, so whatever the player last chose is what they go back to
  // when the thing comes off.
  const concealment = await loadConcealment(prisma, character.id);
  if (!concealment) {
    await respond(interaction, "» *Your face is bare. Put something over it first.* ‡");
    return;
  }
  if (concealment.forced) {
    await respond(interaction, "» *Not while you are wearing that. Take it off first.* ‡");
    return;
  }

  const concealed = !character.concealed;
  await prisma.character.update({ where: { id: character.id }, data: { concealed } });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "character_conceal_toggled",
        targetCharacterId: character.id,
        details: { concealed },
      },
    })
    .catch((err) => console.error("Conceal audit log failed:", err));

  await respond(
    interaction,
    concealed
      ? `» *You now speak as **${withArticle(concealedAlias(character).toLowerCase())}**. Nobody will see your real name until you use /conceal again.*`
      : "» *You speak under your own name again.* ‡",
  );
}

// Moves close MOVE_LOCK_HOURS before the turn ends (db/lib/turnClock.js).
// Returns the refusal text, or null when Moves are still open.
async function moveLockNotice() {
  const [openTurn, config] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { autoTurnAdvanceDisabled: true } }),
  ]);
  if (!openTurn) return null;
  const { locked, cutoffAt, endsAt } = moveWindow(openTurn, {
    autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
  });
  if (!locked) return null;
  return `» *Moves for this turn locked at <t:${epochSeconds(cutoffAt)}:t>. The next turn opens <t:${epochSeconds(endsAt)}:R>.*`;
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// this is the only read before it — with an 800ms race so a slow pool
// doesn't cost the player the modal. Submit re-checks the cutoff.
async function handleMoveOpen(interaction) {
  const notice = await Promise.race([
    moveLockNotice().catch((err) => {
      console.error("Move lock check failed:", err);
      return null;
    }),
    new Promise((resolve) => setTimeout(() => resolve(null), 800)),
  ]);
  if (notice) {
    await respond(interaction, notice);
    return;
  }
  await interaction.showModal(buildMoveModal());
}

async function handleMoveSubmit(interaction) {
  // FIRST: this handler does easily enough DB work to pass three seconds
  // under load, and a late ack would make a committed Move look unsent.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) {
    await respond(interaction, "» *No turn is currently open — your submission wasn't recorded.*");
    return;
  }

  // Re-checked here, not only at move:open — a modal can sit open across
  // the cutoff. Before the Action row so a refusal costs no turn.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { autoTurnAdvanceDisabled: true },
  });
  const { locked, cutoffAt, endsAt } = moveWindow(openTurn, {
    autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
  });
  if (locked) {
    await respond(
      interaction,
      `» *Moves for this turn locked at <t:${epochSeconds(cutoffAt)}:t>. The next turn opens <t:${epochSeconds(endsAt)}:R>.*`,
    );
    return;
  }

  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (alreadyActed) {
    await respond(interaction, "» *You've already locked in a Move this turn — your submission wasn't recorded.*");
    return;
  }

  const raw = interaction.fields.getTextInputValue("move:body").trim();
  if (!raw) {
    await respond(interaction, "» *Write something first.*");
    return;
  }

  const moveKind = interaction.fields.getRadioGroup("move:kind");
  const description = raw;

  // Labor is its own kind now, not a checkbox riding along with a Routine —
  // so picking it IS forgoing the day's other business, and the old
  // Labor+Gambit refusal is structurally impossible rather than enforced.
  let resourceRollExpression = null;
  let laborRate = null;
  if (moveKind === "LABOR") {
    laborRate = await resolveLaborRate(prisma, character.id);
    if (!laborRate.ok) {
      await respond(interaction, `» *${laborRate.reason}*`);
      return;
    }
    resourceRollExpression = laborRate.expression;
  }

  // @@unique([characterId, turnId]) is the real gate; a retried interaction
  // at rollover must not become a second Move.
  let action;
  try {
    action = await prisma.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "PENDING_TYPE",
        moveKind,
        description,
        resourceDelta: null,
        resourceRollExpression,
        zoneId: character.zoneId ?? null,
        // Stamped at filing time. A free zone move costs no Action, so by the
        // time a Labor pays at turn close they may be standing somewhere else
        // (Action.locationId in schema.prisma).
        locationId: character.locationId ?? null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") {
      await respond(interaction, "» *You've already acted this turn.*");
      return;
    }
    throw err;
  }

  await touchCharacterActivity(prisma, character.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id, kind: moveKind, tier: laborRate?.tier ?? null },
    },
  });

  const loaded = await prisma.action.findUnique({
    where: { id: action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });

  const { lines } = await confirmMove(loaded, interaction.user.id, { laborRate });
  await respond(interaction, lines.join("\n"));
}

// setRequired(false) fields may be absent from the submitted payload, and
// fields.getX() throws on a component it can't find.
function optionalText(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId) ?? "";
  } catch {
    return "";
  }
}

async function handleSpeakOpen(interaction) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  if (!guild || !member) {
    await respond(interaction, "» *Couldn't reach the server.*");
    return;
  }

  const { options, truncated } = await listSpeakTargets(guild, member);
  if (options.length === 0) {
    await respond(interaction, "» *There's nowhere you can speak right now.*");
    return;
  }

  const { rows, note } = buildSpeakPicker(options, truncated);
  await respond(interaction, {
    content: ["Where would you like to speak?", note].filter(Boolean).join("\n"),
    components: rows,
  });
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// nothing is awaited here — the permission re-check lives on submit.
async function handleSpeakPick(interaction) {
  const targetId = interaction.values[0];
  if (isNavValue(targetId)) {
    await interaction.deferUpdate();
    return;
  }

  const cached = interaction.client.channels.cache.get(targetId);
  await interaction.showModal(buildSpeakModal(targetId, cached ? `#${cached.name}` : null));
}

async function handleSpeakSubmit(interaction, channelId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  // client.channels, not guild.channels: the destination may be a thread.
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!guild || !channel || !member || !canSpeakInTarget(channel, member)) {
    await respond(interaction, "» *You can't speak there any more.*");
    return;
  }

  const body = optionalText(interaction, "say:body").trim();
  if (!body) {
    await respond(interaction, "» *Write something.*");
    return;
  }

  // Read off the character, never off the modal: concealment (and a held
  // forcesName tag) are standing state, and a checkbox here would be a
  // second answer to a settled question.
  const forcedName = await loadForcedName(prisma, character.id);
  const concealment = await loadConcealment(prisma, character.id);
  const identity = presentedIdentity(character, { forcedName, concealment });

  let posted;
  try {
    posted = await postAsCharacterTo(channel, character, {
      content: body,
      discordUserId: interaction.user.id,
      identity,
    });
  } catch (err) {
    console.error("Failed to post a Speak message:", err);
    await respond(interaction, "» *Couldn't post that.*");
    return;
  }

  await recordArchiveMessage(prisma, {
    discordMessageId: posted.webhookMessage.id,
    content: posted.content,
    character,
    concealedAlias: identity.alias,
    ...resolveChannelContext(channel),
  });
  await touchCharacterActivity(prisma, character.id);

  await respond(interaction, `» *Sent.*\n${messageLink(guild.id, channel.id, posted.webhookMessage.id)}`);
}

// /message: inside a channel the player can already speak in, skip the
// picker and post there directly.
async function handleMessageCommand(interaction) {
  const channel = interaction.channel;
  if (interaction.inGuild() && interaction.member && channel && canSpeakInTarget(channel, interaction.member)) {
    await interaction.showModal(buildSpeakModal(channel.id, `#${channel.name}`));
    return;
  }
  await handleSpeakOpen(interaction);
}

// GM-only, and deliberately not the player medic path
// (web/app/(app)/character/requestActions.js#healCharacterRequest), which
// charges a payer and requires co-location. Category is the only filter.
async function handleHealCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  await ack(interaction);

  const role = interaction.options.getRole("character", true);
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, "» *That isn't a living character's role.*");
    return;
  }

  const afflictions = target.tags.filter((ct) => ct.tag.category === HEALTH_CATEGORY);
  if (afflictions.length === 0) {
    await respond(interaction, `» *${target.name} has nothing to treat.*`);
    return;
  }

  // Discord caps a select menu at 25 options, and max_values must track the
  // slice or the whole component is rejected.
  const shown = afflictions.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`heal:pick:${target.id}`)
    .setPlaceholder("What to clear…")
    .setMinValues(1)
    .setMaxValues(shown.length)
    .addOptions(shown.map((ct) => ({ label: ct.tag.name, value: ct.tagId })));

  const truncated = afflictions.length > shown.length;
  await respond(interaction, {
    content:
      `Clear what from **${target.name}**?` +
      (truncated ? `\n-# Showing the first ${shown.length} of ${afflictions.length}.` : ""),
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleHealPick(interaction, characterId) {
  if (!isGmMember(interaction)) {
    await interaction.update({ content: "» *GMs only.*", components: [] });
    scheduleDismiss(interaction);
    return;
  }
  await interaction.deferUpdate();

  const tagIds = interaction.values;
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, { content: "» *That character no longer exists.*", components: [] });
    return;
  }

  const cleared = target.tags.filter((ct) => tagIds.includes(ct.tagId)).map((ct) => ct.tag.name);

  await prisma.$transaction(async (tx) => {
    for (const tagId of tagIds) {
      await dropCharacterTag(tx, characterId, tagId);
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "gm_heal",
      targetCharacterId: characterId,
      details: { tagIds, tagNames: cleared },
    },
  });

  // Clearing an affliction can change both narrowcast access and which
  // private Rooms this character belongs in — a key tag is a tag like any
  // other, and #cerberon is gated on tags too.
  await reconcileNarrowcastAccess(prisma, target.id, target.discordUserId).catch((err) =>
    console.error(`Heal: narrowcast reconcile failed for ${target.name}:`, err.message ?? err),
  );
  // Carry first (a cured tag can't change a cap, but the order is the rule
  // — CARRY.md), then the room doors.
  const carry = await settleCarry(prisma, target.id).catch((err) => {
    console.error(`Heal: carry settle failed for ${target.name}:`, err.message ?? err);
    return null;
  });
  await syncCharacterRoomAccess(prisma, target).catch((err) =>
    console.error(`Heal: room access sync failed for ${target.name}:`, err.message ?? err),
  );
  if (carry?.drop) await deliverCarryDrop(prisma, carry).catch(() => {});

  await respond(interaction, {
    content: `» *Cleared ${cleared.join(", ")} from ${target.name}.*`,
    components: [],
  });
}

// The one die a player rolls for themselves; posted as a plain bot message
// rather than a public interaction reply, which would carry Discord's
// "@account used /roll" header and out the player behind the character
// (PROXYING.md).
async function handleRollCommand(interaction) {
  await ack(interaction);
  const value = rollDie(6);
  const posted = await interaction.channel?.send(`» *A die is cast* — **${value}**`).catch(() => null);
  await respond(interaction, posted ? `» *You rolled a ${value}.*` : "» *Could not post a roll here.*");
}

// /play: the Instrument tag's one verb. Two lines, and which one you get is
// decided by whether the player holds Musician — an instrument in the hands of
// somebody who never learned is the joke the tag exists for.
//
// WHY THE ROOM LINE IS FULL SIZE. CLAUDE.md says a line the WORLD says into a
// channel is `-#` subtext, and the location half below obeys that. The room
// half deliberately does not, at Bascinet's direction: the room is where the
// performance is happening, so it is an event in the scene rather than
// scenery under it. The Location channel only OVERHEARS it, and that half is
// subtext exactly as the rule says. Don't "fix" the asymmetry — it is the
// feature.
const INSTRUMENT_SLUG = "instrument";
const MUSICIAN_SLUG = "musician";
const NOTE_GLYPHS = ["♫", "♩", "♪", "♬"];

// In-memory, keyed by character id, volatile across a bot restart — the same
// shape as the ticket guard in bot/src/lib/reportChannel.js. A restart
// clearing a flavour cooldown costs nothing, and the alternative is a schema
// column and a migration for a joke.
const PLAY_COOLDOWN_MS = 5 * 60_000;
const lastPlayed = new Map();

// Three glyphs, repeats allowed — "a random combination of 3", not three
// distinct ones, so ♩♩♪ is a legal result.
function noteFlourish() {
  return Array.from({ length: 3 }, () => NOTE_GLYPHS[Math.floor(Math.random() * NOTE_GLYPHS.length)]).join("");
}

async function handlePlayCommand(interaction) {
  await ack(interaction);

  // findAliveCharacter returns a bare row; the tag gate needs the tags, so
  // this reads them in the one query rather than making a second.
  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const held = (slug) => character.tags.some((ct) => ct.tag?.slug === slug && ct.quantity > 0);
  if (!held(INSTRUMENT_SLUG)) {
    await respond(interaction, "» *You have nothing to play.* ‡");
    return;
  }

  // Where: a Room or a Conversation is a THREAD under its Location's channel,
  // so resolveChannelContext resolving to a location covers the open street
  // and every thread hanging off it in one check — and refuses a zone
  // #summary or #cerberon, which are not places anyone is standing.
  const channel = interaction.channel;
  const context = channel ? resolveChannelContext(channel) : null;
  if (!channel || context?.channelKind !== "location") {
    await respond(interaction, "» *There's nobody here to hear it.* ‡");
    return;
  }

  const since = Date.now() - (lastPlayed.get(character.id) ?? 0);
  if (since < PLAY_COOLDOWN_MS) {
    const minutes = Math.max(1, Math.ceil((PLAY_COOLDOWN_MS - since) / 60_000));
    await respond(interaction, `» *Let the last one finish — about ${minutes} more minute${minutes === 1 ? "" : "s"}.* ‡`);
    return;
  }

  const line = held(MUSICIAN_SLUG)
    ? `You hear an instrument playing, beautifully. ${noteFlourish()}`
    : `You hear an instrument playing, badly. ${noteFlourish()}`;

  // The room first, and its result is what decides whether this counted. A
  // failed overhear must not cost the player their cooldown or swallow the
  // performance.
  const posted = await channel.send(`${line} ‡`).catch(() => null);
  if (!posted) {
    await respond(interaction, "» *Couldn't play here.* ‡");
    return;
  }
  lastPlayed.set(character.id, Date.now());

  // ...and the street outside hears it, small. Only when the room WAS a
  // thread — run on the open street, the channel above already is the
  // Location, and a second copy under the first would just be the same line
  // twice.
  if (channel.isThread() && channel.parent) {
    await channel.parent.send(ambientLine(line)).catch(() => null);
  }

  await respond(interaction, "» *You play.* ‡");
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "dm") return void (await handleGmDmCommand(interaction));
        if (interaction.commandName === "heal") return void (await handleHealCommand(interaction));
        if (interaction.commandName === "add" || interaction.commandName === "remove") {
          return void (await handleThreadMemberCommand(interaction, interaction.commandName));
        }
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location") return void (await handleTravelOpen(interaction));
        if (interaction.commandName === "conceal") return void (await handleConcealCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "roll") return void (await handleRollCommand(interaction));
        if (interaction.commandName === "play") return void (await handlePlayCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleTravelOpen(interaction));
        if (interaction.customId === CANCEL_ID) return void (await handleTravelCancel(interaction));
        if (interaction.customId.startsWith(CONFIRM_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(CONFIRM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(WHOS_HERE_PREFIX)) {
          return void (await handleWhosHere(interaction, interaction.customId.slice(WHOS_HERE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_STORAGE_PREFIX)) {
          return void (await handleRoomStorage(interaction, interaction.customId.slice(ROOM_STORAGE_PREFIX.length)));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleIntercomOpen.
        if (interaction.customId.startsWith(ROOM_INTERCOM_PREFIX)) {
          return void (await handleIntercomOpen(interaction, interaction.customId.slice(ROOM_INTERCOM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_TURRET_PREFIX)) {
          return void (await handleTurretOpen(interaction, interaction.customId.slice(ROOM_TURRET_PREFIX.length)));
        }
        if (interaction.customId.startsWith(SECRET_ROOMS_PREFIX)) {
          return void (await handleSecretRooms(interaction, interaction.customId.slice(SECRET_ROOMS_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EXAMINE_PREFIX)) {
          return void (await handleExamine(interaction, interaction.customId.slice(EXAMINE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(CONVERSE_PREFIX)) {
          return void (await handleConverseOpen(interaction, interaction.customId.slice(CONVERSE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(GATE_PREFIX)) {
          return void (await handleGateToggle(interaction, interaction.customId.slice(GATE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(KEYED_PREFIX)) {
          return void (await handleKeyedPrompt(interaction, interaction.customId.slice(KEYED_PREFIX.length)));
        }
        if (interaction.customId === "move:open") return void (await handleMoveOpen(interaction));
        if (interaction.customId === "say:open") return void (await handleSpeakOpen(interaction));
        // Arrive in a DM on a consent offer (docs/systemdocs/LESSONS.md), so
        // guild/member are null. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(OFFER_ACCEPT_PREFIX)) {
          return void (await handleOfferAccept(interaction, interaction.customId.slice(OFFER_ACCEPT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(OFFER_DECLINE_PREFIX)) {
          return void (await handleOfferDecline(interaction, interaction.customId.slice(OFFER_DECLINE_PREFIX.length)));
        }
        // Arrives in a DM on a threat spawn offer (docs/systemdocs/THREATS.md),
        // so guild/member are null — and the clicker has no character yet,
        // which is the whole point. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(THREAT_SPAWN_ACCEPT_PREFIX)) {
          return void (await handleThreatSpawnAccept(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_ACCEPT_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(THREAT_SPAWN_DECLINE_PREFIX)) {
          return void (await handleThreatSpawnDecline(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on a Bird's letter, so guild/member are null.
        if (interaction.customId.startsWith(BIRD_REPLY_PREFIX)) {
          return void (await handleBirdReplyOpen(interaction, interaction.customId.slice(BIRD_REPLY_PREFIX.length)));
        }
        // The board on a Location's anchor. Shown only where docs/zones.yaml
        // declared one (db/lib/noticeboard.js).
        if (interaction.customId.startsWith(NOTICEBOARD_PREFIX)) {
          return void (await handleNoticeboardOpen(interaction, interaction.customId.slice(NOTICEBOARD_PREFIX.length)));
        }
        if (interaction.customId === REPORT_OPEN_ID) return void (await handleReportOpen(interaction));
        if (interaction.customId === REPORT_CLOSE_ID) return void (await handleReportClose(interaction));
        // Arrives in a DM; must NOT be acked first since it opens a modal.
        if (interaction.customId.startsWith(EDIT_OPEN_PREFIX)) return void (await handleEditOpen(interaction));
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === PICK_ID) return void (await handleTravelPick(interaction));
        if (interaction.customId.startsWith(DRAG_PREFIX)) {
          return void (await handleTravelDrag(interaction, interaction.customId.slice(DRAG_PREFIX.length)));
        }
        // Must NOT be acked first: it opens a modal.
        if (interaction.customId.startsWith(CONVERSE_ROOM_PREFIX)) {
          return void (await handleConverseRoomPick(interaction));
        }
        if (interaction.customId === "say:pick") return void (await handleSpeakPick(interaction));
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
        // Answering a bird: which letter in your hands goes back.
        if (interaction.customId.startsWith(BIRD_REPLY_PICK_PREFIX)) {
          return void (await handleBirdReplyPick(interaction, interaction.customId.slice(BIRD_REPLY_PICK_PREFIX.length)));
        }
        // The three verbs on a noticeboard. Read is free to anyone standing
        // here; whether they can make anything of it is a separate question
        // the handler asks (db/lib/reading.js).
        if (interaction.customId.startsWith(NOTICE_READ_PREFIX)) {
          return void (await handleNoticeRead(interaction, interaction.customId.slice(NOTICE_READ_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_TEAR_PREFIX)) {
          return void (await handleNoticeTear(interaction, interaction.customId.slice(NOTICE_TEAR_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_PIN_PREFIX)) {
          return void (await handleNoticePin(interaction, interaction.customId.slice(NOTICE_PIN_PREFIX.length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (interaction.customId.startsWith(CONVERSE_MODAL_PREFIX)) {
          return void (await handleConverseCreate(interaction, interaction.customId.slice(CONVERSE_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCOM_MODAL_PREFIX)) {
          return void (await handleIntercomSubmit(
            interaction,
            interaction.customId.slice(INTERCOM_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(TURRET_MODAL_PREFIX)) {
          return void (await handleTurretSubmit(
            interaction,
            interaction.customId.slice(TURRET_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith("say:send:")) {
          return void (await handleSpeakSubmit(interaction, interaction.customId.slice("say:send:".length)));
        }
        if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) return void (await handleEditSubmit(interaction));
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
      await respondToFailure(interaction);
    }
  },
};

async function respondToFailure(interaction) {
  if (!interaction.isRepliable?.()) return;
  await respond(interaction, { content: "» *Something went wrong — that didn't go through.*", components: [] });
}
