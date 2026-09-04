// The per-turn Default Move pass, run from db/index.js#resolveNeeds(): files
// a Move for every ALIVE character with a saved DefaultEffort who filed
// nothing on the closing turn.
//
// Files a Routine, resolved like bot/src/lib/moveConfirm.js#confirmMove:
// status CONFIRMED, moveReviewStatus PASSED, resources applied and
// snapshotted onto Action.appliedEffects so a GM can revert it, gmNotes
// tagged "auto:default_move". Never rolls a Gambit.
const { applyMoveEffects, describeMoveEffects } = require("./moveEffects");
const { resolveLaborRateFrom, formatLaborBonusNote } = require("./laborAccess");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");
const { INCAPACITATING_SLUGS } = require("./incapacitation");

// Reproduces the #turns submission pipeline's Labor resolution, so a ticked
// Default Move pays what the same submission by hand would. Takes a
// pre-built labor context (not a characterId) since this runs in bulk per turn.
function resolveDefaultMove(def, ctx, coefficient) {
  const description = def.description;

  if (!def.labor) {
    return {
      description,
      resourceRollExpression: null,
      resourceRollValue: null,
      resourceDelta: null,
      gateNote: null,
      laborBonus: 0,
      laborHalved: false,
    };
  }

  const rate = ctx ? resolveLaborRateFrom(ctx, coefficient) : { ok: false, reason: null };
  if (!rate.ok) {
    return {
      description,
      resourceRollExpression: null,
      resourceRollValue: null,
      resourceDelta: null,
      gateNote: rate.reason ?? "You couldn't labor from where you were standing.",
      laborBonus: 0,
      laborHalved: false,
    };
  }

  // Rolled here, not left for later: applyMoveEffects reads resourceDelta
  // only, so an unrolled expression would file the Move and pay nothing.
  const rollResult = rollResourceRange(rate.expression);
  return {
    description,
    resourceRollExpression: rate.expression,
    resourceRollValue: rollResult?.value ?? null,
    resourceDelta: rollResult?.value ?? null,
    gateNote: null,
    // Inside `rate.expression` already — carried out so the DM can name it.
    laborBonus: rate.bonus ?? 0,
    laborHalved: rate.halved ?? false,
  };
}

async function runDefaultMovePass(prisma, turn) {
  const defaults = await prisma.defaultEffort.findMany({
    where: { character: { status: "ALIVE" } },
    include: {
      character: {
        select: {
          id: true,
          name: true,
          discordUserId: true,
          zoneId: true,
          updatedAt: true,
          // zone slug + seat feed the labor gate (db/lib/laborAccess.js);
          // discordSummaryChannelId is where the summary post goes; id + name
          // stamp the archive row for that post.
          zone: {
            select: {
              id: true,
              name: true,
              slug: true,
              discordSummaryChannelId: true,
              seatZone: { select: { slug: true } },
            },
          },
        },
      },
    },
  });
  // An object, not null: db/index.js gates markDone on truthiness and treats
  // null as "this pass FAILED, retry next advance". Returning null for
  // "nothing to do" would leave a game with no saved Default Moves stuck
  // re-running this pass on every advance forever.
  if (defaults.length === 0) {
    return { turnNumber: turn.number, filed: 0, shareable: 0, characterIds: [], posts: [], dms: [] };
  }

  // One query for the whole turn's filings rather than one per character —
  // this is the check that decides who gets skipped, and it has to scale.
  // Any Action at all counts, including an auto-resolved zone change: moving
  // zones spends the turn, so it already used up the slot a Default Move
  // would have filled.
  const acted = await prisma.action.findMany({
    where: { turnId: turn.id, characterId: { in: defaults.map((d) => d.characterId) } },
    select: { characterId: true },
  });
  const actedIds = new Set(acted.map((a) => a.characterId));

  // Every un-acted default needs its tags loaded, not only Labor-ticked ones:
  // the incapacitation check below runs on all of them. One bulk query for
  // the whole set, same posture as the `acted` query above.
  const candidateIds = defaults.filter((d) => !actedIds.has(d.characterId)).map((d) => d.characterId);

  const tagsByCharacter = new Map();
  let coefficient = 1;
  if (candidateIds.length > 0) {
    const [tagRows, config] = await Promise.all([
      prisma.characterTag.findMany({
        where: { characterId: { in: candidateIds } },
        select: { characterId: true, tag: { select: { slug: true } } },
      }),
      prisma.gameConfig.findUnique({ where: { id: 1 }, select: { productionCoefficient: true } }),
    ]);
    for (const row of tagRows) {
      if (!tagsByCharacter.has(row.characterId)) tagsByCharacter.set(row.characterId, new Set());
      tagsByCharacter.get(row.characterId).add(row.tag.slug);
    }
    coefficient = config?.productionCoefficient ?? 1;
  }

  const filed = [];

  for (const def of defaults) {
    if (actedIds.has(def.characterId)) continue;

    const tagSlugs = tagsByCharacter.get(def.characterId) ?? new Set();

    // Tied to a chair, bleeding out, stunned or long gone quiet — a Default
    // Move is "what I'd have done if I couldn't be here", not "what I'd have
    // done if I couldn't act". Silent on purpose: they didn't ask for this
    // turn, and the tag itself is the explanation.
    if ([...tagSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) continue;

    const ctx = def.labor === true
      ? {
          zoneSlug: def.character.zone?.slug ?? null,
          seatZoneSlug: def.character.zone?.seatZone?.slug ?? def.character.zone?.slug ?? null,
          tagSlugs,
        }
      : null;
    const resolved = resolveDefaultMove(def, ctx, coefficient);

    try {
      const action = await prisma.$transaction(async (tx) => {
        const row = await tx.action.create({
          data: {
            characterId: def.characterId,
            turnId: turn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "ROUTINE",
            moveReviewStatus: "PASSED",
            description: resolved.description,
            resourceDelta: resolved.resourceDelta,
            resourceRollExpression: resolved.resourceRollExpression,
            resourceRollValue: resolved.resourceRollValue,
            zoneId: def.character.zoneId ?? def.zoneId ?? null,
            gmNotes: "auto:default_move",
          },
        });
        const applied = await applyMoveEffects(tx, row);
        return tx.action.update({ where: { id: row.id }, data: { appliedEffects: applied } });
      });

      filed.push({ def, action, gateNote: resolved.gateNote, laborBonus: resolved.laborBonus, laborHalved: resolved.laborHalved });
    } catch (err) {
      console.error(`Default Move for character ${def.characterId} failed:`, err);
    }
  }

  // `shareable`, not `shared` — /gm/audit expects this exact key for
  // default_moves_resolved.
  if (filed.length === 0) {
    return { turnNumber: turn.number, filed: 0, shareable: 0, characterIds: [], posts: [], dms: [] };
  }

  // Summary posts and DMs aren't sent here: both are per-player Discord
  // round trips, and awaiting them inside resolveNeeds() would hold the Dev
  // Panel's "End turn" request open. Described here, sent by advanceTurn()'s
  // runSideEffects() after the response is already flushed.
  const posts = [];
  for (const { def } of filed) {
    // The channel is resolved from where the character stands NOW, not from
    // the summaryChannelId snapshotted when they saved the panel — travelling
    // should move where their Default Move is narrated. The stored id is the
    // fallback for a character with no current zone. A cave level has no
    // summary channel, so a Default Move down there simply isn't narrated.
    const channelId = def.character.zone?.discordSummaryChannelId ?? def.summaryChannelId;
    if (!def.shareInSummary || !def.summaryMessage || !channelId) continue;
    posts.push({
      channelId,
      character: def.character,
      message: def.summaryMessage,
      // Carried so runSideEffects can stamp the archive row without re-reading
      // the character. Null when the post is falling back to the stored
      // summaryChannelId, since that id doesn't tell us which zone it is.
      zoneId: def.character.zone?.id ?? null,
      zoneName: def.character.zone?.name ?? null,
    });
  }

  // One DM each: the player needs to know a turn passed and something was
  // filed for them, since they weren't there to see it.
  const dms = filed.map(({ def, action, gateNote, laborBonus, laborHalved }) => {
    const effects = describeMoveEffects(action.appliedEffects);
    const bonusNote = formatLaborBonusNote(laborBonus, laborHalved);
    // sendDm applies the `»` prefix to the first line itself — don't write
    // one here or it doubles up.
    const lines = [
      `*Your Default Move was taken for turn ${turn.number}.*`,
      `» ${action.description}`,
      // Why a standing Labor default paid nothing — they weren't there to be
      // told.
      ...(gateNote ? [`*${gateNote} No Resources were gained.*`] : []),
      ...(effects ? [`**Applied:** ${effects}`] : []),
      // Same line the confirm DM writes (bot/src/lib/moveConfirm.js) — keeps
      // the bonus subtext below from describing a number that isn't shown.
      ...(action.resourceRollValue != null
        ? [
            `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${action.resourceRollValue > 0 ? "+" : ""}${action.resourceRollValue} ⬢`,
          ]
        : []),
      // Same reason as the confirm DM: the paid range had the bonus folded in
      // silently, so a Butcher couldn't tell it had applied.
      ...(bonusNote ? [bonusNote] : []),
    ];
    return { discordUserId: def.character.discordUserId, content: lines.join("\n") };
  });

  return {
    turnNumber: turn.number,
    filed: filed.length,
    // "shareable", not "shared": success counts aren't knowable until the
    // posts are attempted.
    shareable: posts.length,
    characterIds: filed.map(({ def }) => def.characterId),
    posts,
    dms,
  };
}

module.exports = { runDefaultMovePass, resolveDefaultMove };
