// Per-turn Hunger upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
//
// At the close of every turn each ALIVE character is checked, in this order:
//   1. Holds Hungerless -> skipped entirely. No resource taken, no Hunger.
//   2. Holds Ate Meal   -> shielded from Hunger, and the tag is consumed
//                          (whether or not they were broke). The ⬢ is still
//                          owed per step 3 — the resource IS what eating
//                          costs, so waiving it would let one meal pay for
//                          itself twice.
//   3. Check FIRST, then pay: at 0 ⬢ you go Hungry and owe nothing; at 1+ ⬢
//      you pay 1 and stay fed. So 1 ⬢ always buys a fed turn, and resources
//      can never go negative — the clamp is structural, not a Math.max.
//
// Shaped for 100+ players: two reads and three bulk writes regardless of
// headcount, and no network call at all — the per-player "you went hungry" DMs
// are returned as a list of Discord user IDs for advanceTurn() to send later.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG } = require("./constants");

const HUNGER_DM = "You went hungry this turn. −1 to Gambits.";

async function runHungerPass(prisma, turn) {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG] } },
    select: { id: true, slug: true, defaultDurationTurns: true },
  });

  const hungerTag = tags.find((t) => t.slug === HUNGER_SLUG);
  if (!hungerTag) {
    // Catalog not synced — refuse to half-run rather than silently charge
    // everyone with no Hunger to hand out.
    console.error(`Hunger pass skipped: no "${HUNGER_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const hungerlessId = tags.find((t) => t.slug === HUNGERLESS_SLUG)?.id ?? null;
  const ateMealId = tags.find((t) => t.slug === ATE_MEAL_SLUG)?.id ?? null;

  const gateIds = [hungerlessId, ateMealId].filter(Boolean);
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      discordUserId: true,
      resources: true,
      // Only the two gating tags come back, not the whole tag set — this is
      // the query that would otherwise scale badly at 100+ characters.
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true } },
    },
  });

  const toPay = [];
  const toStarve = [];
  const shieldedIds = [];
  let skipped = 0;

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tagId));

    if (hungerlessId && held.has(hungerlessId)) {
      skipped += 1;
      continue;
    }

    if (ateMealId && held.has(ateMealId)) {
      shieldedIds.push(character.id);
      if (character.resources >= 1) toPay.push(character.id);
      continue;
    }

    if (character.resources >= 1) toPay.push(character.id);
    else toStarve.push(character);
  }

  // A Hunger granted while closing turn N gets expiresTurn N+1 — the same
  // `turn.number + defaultDurationTurns` arithmetic setMoodRequest uses. It's
  // live for the whole of turn N+1 and deleted by resolveNeeds()' sweep when
  // N+1 closes. That's also what makes Ate Meal's "won't go hungry next turn"
  // copy literally true: eaten during turn N, consumed at N's close, it
  // suppresses the tag that would have bitten during N+1.
  const expiresTurn = turn.number + (hungerTag.defaultDurationTurns ?? 1);

  // One transaction so a character can never be charged without their Ate
  // Meal being consumed. Empty `in: []` matches nothing and createMany with
  // [] is a no-op, so none of these need a guard.
  await prisma.$transaction([
    prisma.character.updateMany({
      where: { id: { in: toPay } },
      data: { resources: { decrement: 1 } },
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: shieldedIds }, tagId: ateMealId ?? "" },
    }),
    prisma.characterTag.createMany({
      data: toStarve.map((character) => ({
        characterId: character.id,
        tagId: hungerTag.id,
        source: "EVENT",
        expiresTurn,
      })),
      // Belt-and-braces against @@unique([characterId, tagId]) — the expiry
      // sweep in resolveNeeds() runs first and should already have cleared
      // last turn's Hunger.
      skipDuplicates: true,
    }),
  ]);

  // The DMs are deliberately NOT sent here. They're the one per-player,
  // network-bound part of the pass, and awaiting them inside the turn advance
  // is what used to freeze the Dev Panel's "End turn" for minutes. The list is
  // handed back instead and sent from advanceTurn()'s runSideEffects(), which
  // the web action runs after the response is already flushed.
  return {
    turnNumber: turn.number,
    paid: toPay.length,
    starved: toStarve.length,
    shielded: shieldedIds.length,
    skipped,
    starvedCharacterIds: toStarve.map((character) => character.id),
    starvedDiscordUserIds: toStarve.map((character) => character.discordUserId),
  };
}

module.exports = { runHungerPass, HUNGER_DM };
