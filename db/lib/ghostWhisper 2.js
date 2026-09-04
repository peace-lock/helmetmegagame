// The 🌬️ wind whisper — the one thing a ghost can do.
//
// A Cursed player (dead, not yet buried or engraved) sees most of the map
// read-only via db/lib/cursedAccess.js. This is their only voice: react 🌬️ on
// any message in a Location's summary channel or forum post, and Bascinet
// says one line there. Once every 12 real hours, per ghost.
//
// Twelve hours is wall-clock, not turns. A turn is a day, and a once-a-day
// haunting keyed to the turn would arrive in a predictable clump right after
// Dawn; this drifts, which is the point.
//
// Pure-ish rules + one table, no Discord — the bot handler does the sending
// (bot/src/events/messageReactionAdd.js). prisma is a parameter for the same
// reason db/lib/dm.js takes one: requiring db/index.js back from inside
// db/lib/ resolves to a partial exports object.
const GHOST_COOLDOWN_MS = 12 * 60 * 60 * 1000;

// Sent as the bot itself, in the channel or forum post the reaction landed
// in. Deliberately says nothing about who pressed it — a ghost is anonymous,
// and the line reads as the room noticing rather than a person speaking.
const GHOST_LINE =
  "Something's wrong. You feel like you're being watched. Have the dead been laid to rest?";

// Takes the ghost's charge if they have one. Returns { ok: true } on success,
// or { ok: false, readyAt } with the Date the next one unlocks.
//
// The row is written BEFORE the message is sent, so a send that fails still
// burns the charge. That is the safe direction: the alternative — send, then
// record — lets two fast reactions both pass the read and both post, which is
// exactly the spam the cooldown exists to stop.
async function claimGhostWhisper(prisma, discordUserId) {
  const now = new Date();
  const existing = await prisma.ghostWhisper.findUnique({ where: { discordUserId } });

  if (existing) {
    const readyAt = new Date(existing.lastUsedAt.getTime() + GHOST_COOLDOWN_MS);
    if (readyAt > now) return { ok: false, readyAt };
  }

  await prisma.ghostWhisper.upsert({
    where: { discordUserId },
    update: { lastUsedAt: now },
    create: { discordUserId, lastUsedAt: now },
  });
  return { ok: true };
}

module.exports = { GHOST_LINE, claimGhostWhisper };
