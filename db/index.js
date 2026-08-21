// Some launchers export DATABASE_URL with its .env quotes still attached
// (`DATABASE_URL="postgres://..."`), which Prisma rejects with a baffling
// "the URL must start with the protocol postgresql://". Strip one matched
// pair of surrounding quotes. This has to happen BEFORE @prisma/client is
// required — the generated client snapshots its datasource env at module
// load, so fixing it afterwards is too late. This is the single place the
// client is constructed for the bot, the web app, and every script.
function normalizedDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  const unquoted = raw.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  if (unquoted !== raw) process.env.DATABASE_URL = unquoted;
  return unquoted;
}

const databaseUrl = normalizedDatabaseUrl();

const { PrismaClient, Prisma } = require("@prisma/client");
const { rollWeather, buildTurnAnnouncement } = require("./weather");
const { postTurnsAnnouncement } = require("./lib/turnAnnouncement");
const { runDawnWipe } = require("./lib/dawnWipe");
const { runHungerPass, HUNGER_DM } = require("./lib/hungerPass");
const { runDefaultMovePass } = require("./lib/defaultMovePass");
// Required by path, not through the barrel: see the note in db/lib/dm.js about
// why there are three same-named sendDm exports with three signatures.
const { sendDm } = require("./lib/dm");
const { postAsCharacter } = require("./lib/discordRest");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncLocationsFromYaml } = require("./lib/syncLocations");
const { syncTagsFromYaml } = require("./lib/syncTags");
const { syncRolesFromYaml } = require("./lib/syncRoles");
const { NARROWCAST_SLUGS, buildNarrowcastContext, computeNarrowcastAccess } = require("./lib/narrowcastAccess");
const { syncNarrowcastChannels } = require("./lib/syncNarrowcastChannels");

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ?? new PrismaClient(databaseUrl ? { datasourceUrl: databaseUrl } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Below this, the turn announcement gets a vague public omen line (see
// advanceTurn() below) without ever naming the actual number — the Blood
// value itself stays visible only to Mortus-tagged characters and GMs
// (web/app/(app)/lifeweb/page.js).
const LIFEWEB_SPUTTER_THRESHOLD = 20;

// Applies per-turn Needs decay to the turn being closed. Shared between the
// bot's cron-triggered advanceTurn() and the GM dashboard's manual
// close-turn override, so both paths behave identically instead of only the
// automated one actually resolving Needs.
//
// Returns { lifewebBlood, starvedDiscordUserIds, defaultMovePosts,
// defaultMoveDms }. Everything after the first is Discord work this function
// deliberately does NOT perform — the Hunger pass's DM list and the Default
// Move pass's summary posts and DMs. See advanceTurn() below for why.
async function resolveNeeds(turn, config) {
  // Default Moves file FIRST, before anything else here: a Default Move can
  // pay resources in, and the Hunger pass below charges them out, so income
  // has to land before upkeep is taken or a player whose default earns them
  // a meal still goes hungry. It also has to happen while the turn is still
  // the one being closed — it files a real Action against it. Same summary-
  // audit-row shape as the Hunger pass, for the same reason.
  const defaults = await runDefaultMovePass(prisma, turn).catch((err) => {
    console.error("Default Move pass failed:", err);
    return null;
  });
  // Same split as the Hunger pass below: the posts/DMs the pass wants are
  // routing data for runSideEffects(), not part of the turn's record, so they
  // come off before the audit row is written.
  const { posts: defaultMovePosts = [], dms: defaultMoveDms = [], ...defaultSummary } = defaults ?? {};
  if (defaults?.filed) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "default_moves_resolved", details: defaultSummary },
      })
      .catch((err) => console.error("Default Move audit log failed:", err));
  }

  // Sweep any turn-scoped tags (Mood, Drained, last turn's Hunger) whose
  // expiresTurn has been reached — a single bulk delete, independent of
  // everything else here.
  await prisma.characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } });

  // Hunger upkeep runs AFTER the sweep, deliberately: a Hunger granted while
  // closing turn N-1 carries expiresTurn N, so the sweep is what clears it a
  // moment before this pass may grant a fresh one. In the other order a
  // still-broke character's re-grant would collide with
  // @@unique([characterId, tagId]) and be silently dropped, leaving them
  // holding a tag that expires immediately. See db/lib/hungerPass.js.
  //
  // One summary audit row rather than one per character: at 100+ players a
  // per-character row would push 200 entries a day into /gm/audit and drown
  // every human-authored line. Written here rather than by the two advance
  // callers because the whole point of resolveNeeds being shared is that both
  // paths resolve Needs identically.
  const hunger = await runHungerPass(prisma, turn).catch((err) => {
    console.error("Hunger pass failed:", err);
    return null;
  });

  // The DM list is split off the summary before it's logged: it's routing
  // data for runSideEffects(), not part of the turn's record, so the audit
  // details stay exactly the shape they've always been.
  const { starvedDiscordUserIds = [], ...summary } = hunger ?? {};
  if (hunger) {
    await prisma.auditLog
      .create({
        data: { actorDiscordUserId: "system", actionType: "hunger_resolved", details: summary },
      })
      .catch((err) => console.error("Hunger audit log failed:", err));
  }

  // The Lifeweb bleeds out a fixed amount every turn regardless of what fed
  // it last — see donateBlood()/feedLifewebPerson() in
  // web/app/(app)/lifeweb/actions.js for the ways it's topped back up.
  const newBlood = Math.max(0, (config?.lifewebBlood ?? 100) - (config?.lifewebDecayPerTurn ?? 10));
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: newBlood } });
  return { lifewebBlood: newBlood, starvedDiscordUserIds, defaultMovePosts, defaultMoveDms };
}

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one, alternating DAWN/DUSK. Shared by the bot's cron-triggered advance and
// any GM-triggered "End Turn" action so both apply identical turn logic.
//
// This still composes every Discord side effect (the Hunger DMs, the turn
// announcement, and the Dawn message wipe if enabled — all REST-based, see
// db/lib/turnAnnouncement.js and db/lib/dawnWipe.js), but it no longer *runs*
// them: they're returned as a single `runSideEffects()` thunk and the caller
// decides when. That's the fix for the Dev Panel lockup — the wipe walks every
// location, thread and message page sequentially and can take minutes, and
// awaiting it inside a server action froze the whole web app behind a pending
// request. The bot's cron awaits the thunk inline (it's a background process,
// the wait is harmless); the web action runs it via next/server's after(), so
// the response is flushed first. Everything inside is still best-effort:
// individually caught, logged, never thrown.
//
// Returns { advanced, previousTurn, newTurn, note, runSideEffects }. `advanced`
// is false when another caller won the race to close the open turn (see the
// guard below) — this call did nothing, and `newTurn` is then whatever the
// winner opened, or null if it hasn't got that far yet. Callers must check
// `advanced` before logging or dereferencing `newTurn`; a null `previousTurn`
// on its own is ambiguous, since opening the very first turn has one too.
async function advanceTurn() {
  const config = await getConfig();
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  let lifewebBlood = config.lifewebBlood;
  let starvedDiscordUserIds = [];
  let defaultMovePosts = [];
  let defaultMoveDms = [];
  if (openTurn) {
    // Close the turn FIRST, conditioned on it still being OPEN. This is the
    // guard against two advances racing — a GM double-clicking End turn, or
    // clicking it just as the bot's twice-daily cron fires. Postgres
    // serializes the two updateMany's, so exactly one sees count === 1; the
    // loser bails out here instead of resolving Needs a second time and
    // opening a duplicate turn (which needs hand-editing the DB to undo).
    //
    // Closing before resolving (rather than after, as this used to) is what
    // makes the claim atomic. The cost is that a mid-resolve crash leaves the
    // turn RESOLVED with Needs half-applied; the alternative is that a losing
    // racer runs the whole of resolveNeeds() before finding out it lost,
    // double-charging every character's upkeep and double-decaying the
    // Lifeweb. A half-resolved turn is the cheaper failure.
    const closed = await prisma.turn.updateMany({
      where: { id: openTurn.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (closed.count === 0) {
      // The winner may still be mid-advance, so this read can come back null.
      // That's reported as-is rather than waited on — see the return contract.
      const winner = await prisma.turn.findFirst({ where: { status: "OPEN" } });
      return {
        advanced: false,
        previousTurn: null,
        newTurn: winner,
        note: null,
        runSideEffects: async () => {},
      };
    }

    ({ lifewebBlood, starvedDiscordUserIds, defaultMovePosts, defaultMoveDms } = await resolveNeeds(
      openTurn,
      config,
    ));
  }

  const lastTurn = openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  // Weather rolls every turn, as a Markov step off the previous turn's
  // weather through the table for the phase being entered (see
  // rollWeather() in weather.js) — that's what lets a state like STORM
  // persist for several turns straight regardless of phase, while FOG
  // specifically favors DAWN turns and burns off by DUSK. A GM's manual
  // override (config.nextWeather, set from the Dev Panel) always wins.
  const weather = config.nextWeather ?? rollWeather(lastTurn?.weather, phase);
  const lifewebFlavor = lifewebBlood <= LIFEWEB_SPUTTER_THRESHOLD ? "The Lifeweb sputters, failing." : null;
  const note = [lifewebFlavor, config.nextTurnNote].filter(Boolean).join("\n\n") || null;

  const newTurn = await prisma.turn.create({
    data: { number: (lastTurn?.number ?? 0) + 1, phase, weather, gameDate: new Date(), status: "OPEN" },
  });

  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { nextWeather: null, nextTurnNote: null },
  });

  // Everything below this line talks to Discord and nothing above it does, so
  // the turn is fully committed by the time the caller gets this back. This is
  // now the ONLY place in the turn-advance path that makes a network call —
  // both resolveNeeds() passes hand their posts and DMs back rather than
  // sending them. Order matches the narrative: the closing turn's Default Move
  // summaries and DMs, then the Hunger DMs, then the announcement opening the
  // next turn, then the Dawn wipe.
  const runSideEffects = async () => {
    // Default Move summary posts first — they narrate the turn that just
    // closed, so they should land before the announcement opening the next.
    for (const post of defaultMovePosts) {
      await postAsCharacter(post.channelId, post.character, post.message).catch((err) =>
        console.error(`Default Move summary post for ${post.character.id} failed:`, err),
      );
    }

    for (const dm of defaultMoveDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Default Move DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // One DM per hungry player, sequential (discordRequest already backs off
    // on 429) and individually caught. No DM for a quiet -1 ⬢.
    for (const discordUserId of starvedDiscordUserIds) {
      await sendDm(prisma, discordUserId, HUNGER_DM).catch((err) =>
        console.error(`Hunger DM to ${discordUserId} failed:`, err),
      );
    }

    await postTurnsAnnouncement(prisma, newTurn, note).catch((err) =>
      console.error("Failed to post turn announcement:", err),
    );

    if (newTurn.phase === "DAWN" && config.messageWipeEnabled) {
      await runDawnWipe(prisma).catch((err) => console.error("Dawn message wipe failed:", err));
    }
  };

  return { advanced: true, previousTurn: openTurn, newTurn, note, runSideEffects };
}

module.exports = {
  prisma,
  // Re-exported so nothing outside db/ has to reach for @prisma/client
  // directly — only this package declares it as a dependency. Needed for
  // Prisma.DbNull, which is the ONLY way to write a SQL NULL into a
  // nullable Json column (a plain null is a validation error).
  Prisma,
  resolveNeeds,
  advanceTurn,
  runFullChannelWipe,
  syncLocationsFromYaml,
  syncTagsFromYaml,
  syncRolesFromYaml,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  syncNarrowcastChannels,
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./weather"),
  ...require("./lib/constants"),
  ...require("./lib/roleColor"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/production"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/mood"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
};
