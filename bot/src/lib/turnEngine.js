const { prisma, advanceTurn: advanceTurnInDb } = require("@lifeweb/db");

// Thin wrapper around the shared db.advanceTurn(): adds the audit log entry
// (process-specific — the announcement, Hunger DMs and Dawn wipe are all
// composed inside advanceTurn() itself, REST-based, so this needs no gateway
// client). Called by the twice-daily cron in ready.js, and safe to call
// manually as a GM force-advance since it's idempotent about which turn is
// "current".
//
// The side effects are awaited inline here, unlike the web action which defers
// them past the response: this is a background cron with nobody waiting on it,
// so the straight-line order keeps the logs readable.
async function advanceTurn() {
  const { advanced, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

  // Another caller (a GM on the Dev Panel, most likely) won the race and
  // already advanced the turn. Nothing to log, nothing to announce.
  if (!advanced) return newTurn;

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "turn_advanced",
      details: {
        previousTurnId: previousTurn?.id ?? null,
        newTurnId: newTurn.id,
        number: newTurn.number,
        phase: newTurn.phase,
        weather: newTurn.weather,
      },
    },
  });

  await runSideEffects();

  return newTurn;
}

module.exports = { advanceTurn };
