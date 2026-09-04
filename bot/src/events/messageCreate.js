const { MessageType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("@lifeweb/db/lib/presentedIdentity");
const { sendAsCharacter } = require("../lib/proxy");
const { isDesignatedTupperChannel, resolveChannelContext } = require("../lib/channels");
const { sendDm } = require("../lib/dm");
const { REPORT_CHANNEL_ID } = require("@lifeweb/db/lib/reportChannelAccess");
const {
  canHearPing,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
} = require("../lib/mentions");

// How many character-role mentions one message may relay. Each one is a user
// fetch, a DM channel open, a send and a database insert, strictly serial —
// so an uncapped list is a fan-out anyone can trigger by pasting mentions.
const MAX_MENTION_RELAYS = 10;

module.exports = {
  name: "messageCreate",
  async execute(message) {
    // Discord narrates the bot's own housekeeping into the channels players
    // read: a "pinned a message" line for every Location anchor (57 of them on
    // a fresh provision, plus one per Room thread) and a "started a thread"
    // line wherever a thread is made from a message. Neither is for anybody.
    //
    // Scoped to notices the BOT itself caused, so a human pinning something in
    // #general still leaves the usual trace. And placed ABOVE the bot guard on
    // purpose: these are bot-authored by definition, so the guard below would
    // return before ever seeing them.
    if (
      (message.type === MessageType.ChannelPinnedMessage || message.type === MessageType.ThreadCreated) &&
      message.author?.id === message.client.user.id
    ) {
      await message.delete().catch((err) =>
        console.error(`Failed to clear a system notice in ${message.channelId}:`, err.message),
      );
      return;
    }

    if (message.author.bot || message.webhookId) return;

    if (!message.inGuild()) {
      const attachmentNames = message.attachments.size > 0 ? [...message.attachments.values()].map((a) => a.name) : null;
      const content = message.content || (attachmentNames ? `*(attachment: ${attachmentNames.join(", ")})*` : "");
      // Every inbound DM is mail for the GMs now. Mechanic edits go through a
      // button and a modal (bot/src/lib/editModal.js), so nothing a player
      // types for a mechanic travels as a DM message; web/lib/dmThread.js
      // still filters "prompt_reply" rows out of the read side.
      await prisma.directMessage
        .create({
          data: {
            discordUserId: message.author.id,
            direction: "INBOUND",
            content,
            source: "player",
            discordMessageId: message.id,
            meta: attachmentNames ? { attachments: attachmentNames } : undefined,
          },
        })
        .catch(() => {});
      return;
    }

    // #turns is the console channel: the Travel/Move/Speak buttons live on an
    // anchor message there (bot/src/lib/turnsConsole.js), so everything a
    // player types is simply removed. The report channel is the same kind of
    // surface (bot/src/lib/reportChannel.js's Open Ticket button).
    const channelName = message.channel.name?.toLowerCase();
    if (channelName === "turns" || message.channel.id === REPORT_CHANNEL_ID) {
      await message.delete().catch(() => {});
      return;
    }

    // A Location channel's own anchor sits at the top level of the channel,
    // pinned, and that top level IS the open street — so unlike the retired
    // zone anchors there is nothing here to sweep. Someone talking in a
    // Location channel is simply talking in public.

    if (!isDesignatedTupperChannel(message.channel)) return;

    // Activity clock for Conversations. Informational since Bascinet 2
    // retired inactivity expiry — the Dawn wipe takes them instead — and
    // debounced to one write per thread per turn; runs before the character
    // gate on purpose, so a GM talking in a scene counts too.
    if (message.channel.isThread?.()) {
      touchThreadActivity(message.channel.id).catch((err) =>
        console.error("Thread activity write failed:", err),
      );
    }

    const character = await prisma.character.findFirst({
      where: { discordUserId: message.author.id, status: "ALIVE" },
      // The identity tags ride along on the busiest query the bot runs, rather
      // than costing a second round trip per message. Two kinds: the one that
      // dictates a name, and the equipped gear that hides one.
      include: {
        tags: {
          where: {
            OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
          },
          select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
        },
      },
    });
    if (!character) return;

    // Which name and face this post goes out under. Precedence is forced >
    // concealed > own (db/lib/presentedIdentity.js): a held forcesName tag
    // overrides concealment, which itself needs something concealing actually
    // EQUIPPED — either forcing it, or letting the standing Character.concealed
    // toggle (/conceal, or the switch on /character) take effect.
    const identity = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
    });

    // Captured BEFORE proxying: sendAsCharacter deletes the original message,
    // and the mention list goes with it.
    const mentionedRoleIds = [...message.mentions.roles.keys()];
    const channel = message.channel;

    // sendAsCharacter owns the failure path now: it deletes the original on
    // every route and DMs the player their text back, so a message that can't
    // be proxied never sits in the channel under their real name. A null means
    // it refused, and there is no proxied message left to relay mentions for.
    let proxied;
    try {
      proxied = await sendAsCharacter(channel, character, message, { identity });
    } catch (err) {
      console.error("Failed to proxy message:", err);
      return;
    }
    if (!proxied) return;

    // A concealed (or forced) message deliberately relays nothing: the whole
    // point is that the room doesn't know who spoke, and a DM naming the
    // location would hand the target a thread to pull on. A forced identity
    // is never concealed, so this only ever fires for a real hood.
    if (identity.concealed || mentionedRoleIds.length === 0) return;

    await handleMentions({ message, channel, proxied, mentionedRoleIds }).catch((err) =>
      console.error("Failed to handle mentions:", err),
    );
  },
};

// In-memory debounce: threadId -> the turn number already recorded. A busy
// thread costs one UPDATE per turn instead of one per message; the sweep also
// re-derives activity from each thread's last_message_id snowflake, so a
// restart losing this map costs nothing.
const activityWritten = new Map();

async function touchThreadActivity(threadId) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const turnNumber = openTurn?.number ?? null;
  if (turnNumber !== null && activityWritten.get(threadId) === turnNumber) return;

  const updated = await prisma.playerThread.updateMany({
    where: { threadId },
    data: { lastActivityTurn: turnNumber ?? undefined, lastActivityAt: new Date() },
  });
  // Only remember threads we actually track — a Room thread has no
  // PlayerThread row, and caching its id would just grow the map.
  if (updated.count > 0 && turnNumber !== null) activityWritten.set(threadId, turnNumber);
}

// Two independent things a character-role mention does: notify the player,
// and — in a Conversation — let them in. Discord won't auto-add a mentioned
// role's members once the role is assigned to nobody, so the bot does both.
async function handleMentions({ message, channel, proxied, mentionedRoleIds }) {
  const context = resolveChannelContext(channel);
  const mentioned = await resolveMentionedCharacters(mentionedRoleIds);

  // The proxy suppresses the role ping itself (allowedMentions parse:
  // ["users"]), so a swallowed mention looks exactly like a delivered one.
  // One line per ping makes it diagnosable from the Railway logs.
  console.log(
    `[mentions] roles=${mentionedRoleIds.join(",")} resolved=${mentioned.length} ` +
      `location=${context.locationId ?? "none"} kind=${context.channelKind ?? "none"}`,
  );
  if (mentioned.length === 0) return;

  // One message can name every character role in the game, and each target
  // costs a user fetch, a DM channel open, a send and a database insert — all
  // serialized, all after the room has already seen the message. Ten is well
  // past any legitimate ping and the refusal names who was dropped, so nothing
  // goes missing silently.
  const relayed = mentioned.slice(0, MAX_MENTION_RELAYS);
  const dropped = mentioned.slice(MAX_MENTION_RELAYS);
  if (dropped.length > 0) {
    console.log(`[mentions] capped at ${MAX_MENTION_RELAYS}, skipped ${dropped.length}`);
    await sendDm(
      message.author,
      `» *That pinged ${mentioned.length} people at once, so only the first ${MAX_MENTION_RELAYS} were told. ` +
        `Not notified: ${dropped.map((t) => t.name).join(", ")}.* ‡`,
      { source: "system_notice" },
    ).catch(() => {});
  }

  const link = messageLink(message.guildId, channel.id, proxied.id);
  // A mention only becomes an invite inside a Conversation. A private Room is
  // a private thread too, but it is gated on a key tag
  // (db/lib/roomAccess.js) — letting a ping hand out a seat there would
  // route straight around the lock.
  const conversation = await prisma.playerThread
    .findUnique({ where: { threadId: channel.id }, select: { locationId: true } })
    .catch((err) => {
      console.error("Conversation lookup failed for a mention:", err);
      return null;
    });

  // Collected rather than sent one-per-target, so the author gets one DM
  // instead of one per absent person named.
  const notHere = [];

  for (const target of relayed) {
    if (conversation) {
      // A mention into a Conversation is an invite, same contract as /add:
      // recorded, applied now if the target already stands in the location,
      // and replayed by applyPendingInvites when they arrive otherwise.
      await prisma.playerThreadInvite
        .upsert({
          where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
          update: {},
          create: { threadId: channel.id, characterId: target.id },
        })
        .catch((err) => console.error("Failed to record thread invite:", err));
      if (target.locationId === conversation.locationId) {
        await channel.members.add(target.discordUserId).catch((err) =>
          console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err),
        );
        await notifyMentioned(message.client, target, context, link);
      } else {
        console.log(`[mentions] ${target.name}: not in ${context.locationName ?? "this location"}, invite recorded`);
        notHere.push(target.name);
      }
      continue;
    }

    const heard = await canHearPing(target, context);
    console.log(`[mentions] ${target.name}: ${heard ? "notified" : "out of earshot, no DM"}`);
    if (heard) {
      await notifyMentioned(message.client, target, context, link);
    }
  }

  if (notHere.length > 0) {
    const where = context.locationName ?? context.zoneName ?? "this place";
    await sendDm(
      message.author,
      notHere.length === 1
        ? `» *${notHere[0]} isn't in ${where} — they're invited, and will see this conversation when they arrive.*`
        : `» *${notHere.join(", ")} aren't in ${where} — they're invited, and will see this conversation when they arrive.*`,
      { source: "system_notice" },
    ).catch(() => {});
  }
}
