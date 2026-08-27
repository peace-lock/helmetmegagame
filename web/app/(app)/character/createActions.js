"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  prisma,
  roleCapacity,
  isDynastyHead,
  isDynastyMember,
  normalizeAntagonistSlugs,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { dynastyLastName, propagateDynastyLastName } from "@/lib/dynasty";
import { isSuperadmin } from "@/lib/superadmin";
import {
  syncCharacterNickname,
  ensureCharacterRole,
  syncCharacterLocationAccess,
  syncCharacterNarrowcastAccess,
  getGuildMember,
  isCursed,
  isApprovedPlayer,
  isLeaderWhitelisted,
  removeCursedRole,
} from "@/lib/discordGuild";
import {
  computeBudget,
  isPlaytestLocked,
  isRoleSelectable,
  tagsById as buildTagsById,
  effectiveTotalCost,
  drawbackPoints,
  DEFAULT_MAX_DRAWBACK_POINTS,
  chainSiblingsToRemove,
  heldHigherTiers,
  requirementSatisfied,
  CURSED_ROLE_SLUGS,
} from "@/lib/characterCreation";

import { FEAR_MAX_LENGTH } from "@/lib/constants";
import { recordArchiveEvent } from "@/lib/archive";
import {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  formatCharacterName,
  formatBareName,
  normalizeEarnedHonorific,
} from "@/lib/characterName";

// Creates a character from the wizard's final Confirm step.
//
// Everything the client sent is re-derived and re-checked here. The wizard's
// own gating (full roles greyed out, Next disabled while overspent) is UX
// only — this action is the actual enforcement boundary, and it has to be,
// since a server action is a public HTTP endpoint that anyone can post to
// directly.
//
// The seat-cap recheck also closes a genuine race the UI cannot: two players
// sitting on the last Baron seat both see "0/1" and both hit Confirm. The
// count is taken inside the transaction that creates the character, so the
// second one loses.
export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const part = (key, limit) => formData.get(key)?.toString().trim().slice(0, limit) || null;
  // `title` is deliberately absent: it is GM-granted, set only from
  // /gm/dev/characters/[characterId]. Not reading it here is the lock.
  //
  // The honorific is only READ here. Whether this character has earned it
  // depends on their role and their tags, neither of which is resolved yet —
  // so the gate runs further down, once both are known.
  const rawHonorific = formData.get("honorific");
  const firstName = part("firstName", NAME_LIMITS.firstName);
  // Not const: a Baroness/Heir/Successor wears the Baron's last name rather
  // than one they typed, so this is overwritten once the role is known below.
  let lastName = part("lastName", NAME_LIMITS.lastName);
  // Optional at creation — a player who skips it sets it later from
  // /character, where it locks on that first save instead.
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;
  const roleId = formData.get("roleId")?.toString();
  const tagIds = formData.getAll("tagIds").map((t) => t.toString()).filter(Boolean);
  // Optional — the wizard's Fear step can be walked straight past, and the
  // player names one later from /character instead.
  const fear =
    formData.get("fear")?.toString().trim().slice(0, FEAR_MAX_LENGTH) || null;
  // Consent data — which secretly assigned antagonist seats this player is open
  // to. The checkboxes are UX; the normalizer's allowlist is the boundary that
  // keeps junk slugs out of the column, same as normalizeHonorific above.
  const antagonistOptIns = normalizeAntagonistSlugs(formData.getAll("antagonistOptIns"));

  if (!firstName) return { error: "Your character needs a first name." };
  if (!roleId) return { error: "Pick a role before confirming." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    redirect("/character");
  }

  const [role, config, member, openTurn] = await Promise.all([
    // The zone comes along for the playtest lock below — it matches the
    // Windlands by zone, since no column marks a role as a Windlander one.
    prisma.role.findUnique({
      where: { id: roleId },
      include: { faction: { include: { zone: true } }, startingLocation: true },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
  ]);
  if (!role) return { error: "That role no longer exists." };

  // The launch gate, checked before any of the point-buy work below so a
  // closed game costs nothing to bounce. Both halves have to hold: the game
  // has to be open, and this member has to be on the list. This is the real
  // enforcement boundary — the wizard hides itself too, but a server action
  // is a public endpoint, so the check that matters is this one.
  //
  // A superadmin walks through both halves. This is host/developer access
  // (one hardcoded Discord ID, see web/lib/superadmin.js), not a game
  // permission — it exists so the host can roll a test character before the
  // doors open, which is otherwise impossible without flipping the live
  // openToPlayers toggle for everyone.
  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !config?.openToPlayers) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !isApprovedPlayer(member)) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }

  // Held back for a playtest from /gm/dev. Deliberately outside the `bypass`
  // above: the host is locked out too, because the point is that the role
  // isn't finished, not that it's reserved (see characterCreation.js).
  const playtestLocked =
    config?.playtestModeEnabled === true &&
    isPlaytestLocked({ role, zoneName: role.faction?.zone?.name });
  if (playtestLocked) {
    return { error: "That role is closed for this playtest." };
  }

  // Split from the isRoleSelectable call below so each rejection gets its own
  // message — the shared predicate can only say "no", not why.
  // A GM can turn the whitelist requirement off game-wide from /gm/dev.
  // `=== false` rather than a falsy check: no config row leaves it enforced.
  const leaderWhitelisted =
    bypass || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  if (role.grantsLeader && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }

  const cursed = isCursed(member);
  if (!isRoleSelectable({ role, cursed, leaderWhitelisted })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  // The Baroness, Heir and Successor are the Baron's family: their last name
  // is his, never one they typed. The wizard greys the input out once such a
  // role is picked, but the input is only the hint — not reading what it
  // posted is the lock, same as `title` above. Null when no Baron is alive
  // yet, which is the common case at creation; he propagates his name to them
  // the moment he rolls up (see below).
  if (isDynastyMember(role.slug)) lastName = await dynastyLastName();

  // Selected tags must actually be buyable — a hand-posted request could
  // otherwise name a 0-cost, non-purchasable tag like Nobility.
  const selected = tagIds.length
    ? await prisma.tag.findMany({
        where: { id: { in: tagIds }, purchasable: true },
        // The group's requiredTagId is the hidden-category gate that
        // requirementSatisfied() checks below — without it a hand-posted
        // request could buy straight into the Demoness category.
        include: { group: { select: { requiredTagId: true } } },
      })
    : [];
  if (selected.length !== tagIds.length) {
    return { error: "One of those tags isn't available for purchase." };
  }

  // Role tags come from the catalog by name (roles.yaml authors them as
  // display names, and db:sync-roles has already validated every one).
  const startingTags = role.startingTagSlugs.length
    ? await prisma.tag.findMany({ where: { name: { in: role.startingTagSlugs } } })
    : [];

  // Now both halves of "what did they earn" exist, so the title can be gated.
  // A word this character has no claim to lands as null rather than failing
  // the create: the wizard already filtered the dropdown, so anything else
  // arriving here is a hand-posted request, and silently going untitled is
  // the right answer to one.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: [...selected, ...startingTags].map((t) => t.slug),
    roleSlug: role.slug,
  });
  const name = formatCharacterName({ honorific, firstName, title: null, lastName });

  // The full catalog, not just what's selected/granted, so a chain walk
  // (parentTagId) never dead-ends on an ancestor the client didn't send.
  const allTags = await prisma.tag.findMany({
    select: { id: true, pointCost: true, parentTagId: true, requiredTagId: true },
  });
  const byId = buildTagsById(allTags);
  const grantedIds = startingTags.map((t) => t.id);

  // A hand-posted request could submit two tiers of the same chain at once
  // (the UI never lets that happen — selecting one auto-drops the other),
  // or buy in below a tier the role already grants (a chain replaces upward,
  // it never re-opens downward).
  for (const tag of selected) {
    if (chainSiblingsToRemove(tag, byId, tagIds).length > 0) {
      return { error: "You can only hold one tier of the same skill chain." };
    }
    if (heldHigherTiers(tag, byId, grantedIds).length > 0) {
      return { error: "Your role already grants a higher tier of that skill chain." };
    }
  }

  // Prerequisites: requiredTag — and the group gate behind a hidden category
  // — must be satisfied by something granted or selected alongside it (any
  // tier of that tag's own chain counts).
  const heldOrSelectedIds = [...grantedIds, ...tagIds];
  for (const tag of selected) {
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      return { error: "One of those tags is missing a prerequisite." };
    }
  }

  // The drawback cap (TAGS.md §4a). Only what's bought here counts: the role's
  // own starting tags are granted below as GM_GRANT and never pass through
  // `selected`, so the Meister's free Frail costs nobody a slot.
  const maxDrawback = config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS;
  const drawbacks = drawbackPoints(selected);
  if (drawbacks > maxDrawback) {
    return {
      error: `Your drawbacks give back ${drawbacks} points and the limit is ${maxDrawback}.`,
    };
  }

  const budget = computeBudget({ startingTagPoints: config?.startingTagPoints ?? 0, role, cursed });
  // Discounted by what the role already grants, matching what every row and
  // the build pane showed the player.
  const spent = effectiveTotalCost(selected, byId, grantedIds);
  if (spent > budget) {
    return { error: `That costs ${spent} points and you have ${budget}.` };
  }

  // Deduplicate: a player can pay for a tag the role also grants only if the
  // menu let them, but a direct post could. Union them, and refund nothing —
  // the budget check above already passed.
  //
  // A tag with a catalog duration has to arrive already stamped, or it sits
  // on the sheet forever: resolveNeeds()' sweep only ever looks at
  // expiresTurn, and nothing else backfills it. This is what makes a timed
  // starting pick (a Mood, a Wound) actually run out. Both tag sets are
  // fetched without a `select`, so defaultDurationTurns is already on them.
  // Before the game opens there is no turn to count from, so nothing
  // expires.
  const expiryFor = (tag) =>
    tag.defaultDurationTurns != null && openTurn ? openTurn.number + tag.defaultDurationTurns : null;

  const tagIdsToGrant = new Map();
  for (const tag of startingTags) {
    tagIdsToGrant.set(tag.id, { source: "GM_GRANT", expiresTurn: expiryFor(tag) });
  }
  for (const tag of selected) {
    if (!tagIdsToGrant.has(tag.id)) {
      tagIdsToGrant.set(tag.id, { source: "POINT_BUY", expiresTurn: expiryFor(tag) });
    }
    // A purchased higher tier replaces a role-granted lower tier of the same
    // chain — the plain union would seat both rungs on the new sheet. The
    // discount already happened above (effectiveTotalCost over grantedIds),
    // so the player paid exactly the difference for exactly one rung.
    for (const lowerId of chainSiblingsToRemove(tag, byId, grantedIds)) {
      tagIdsToGrant.delete(lowerId);
    }
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const taken = await tx.character.count({ where: { roleId: role.id, status: "ALIVE" } });
      if (taken >= roleCapacity(role, config?.playerCount ?? 100)) {
        throw new Error("ROLE_FULL");
      }

      const character = await tx.character.create({
        data: {
          discordUserId,
          honorific,
          firstName,
          title: null,
          lastName,
          name,
          age,
          roleId: role.id,
          roleTitle: role.name,
          factionId: role.factionId,
          locationId: role.startingLocationId,
          zoneId: role.startingLocation?.zoneId ?? null,
          resources: role.startingResources,
          tagPoints: budget - spent,
          fear,
          // Display-only stamp, and null before the game opens — the same
          // shape expiryFor() uses above.
          fearSetTurnNumber: fear ? (openTurn?.number ?? null) : null,
          isLeader: role.grantsLeader,
          isTreasurer: role.grantsTreasurer,
          antagonistOptIns,
        },
      });

      await tx.characterTag.createMany({
        data: [...tagIdsToGrant].map(([tagId, { source, expiresTurn }]) => ({
          characterId: character.id,
          tagId,
          source,
          expiresTurn,
        })),
      });

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { error: `${role.name} was taken while you were deciding. Pick another role.` };
    }
    throw err;
  }

  // Discord side effects, best-effort and strictly ordered: narrowcast access
  // reads the location/tags written above.
  //
  // Access no longer depends on the role existing — it is a per-member
  // overwrite keyed on discordUserId (db/lib/locationAccess.js), so the gate
  // here is having somewhere to stand, not having a role. Gating on
  // discordRoleId as this once did would silently deny a character their own
  // room whenever role creation failed.
  await ensureCharacterRole(created).catch(() => {});
  if (created.locationId) {
    await syncCharacterLocationAccess(discordUserId, null, created.locationId).catch(() => {});
  }
  await syncCharacterNickname(discordUserId, formatBareName({ firstName, lastName })).catch(() => {});
  await syncCharacterNarrowcastAccess(created.id).catch(() => {});
  if (cursed) await removeCursedRole(discordUserId).catch(() => {});

  // A new Baron names the dynasty, so any family member already in play takes
  // his last name — including one created back when no Baron existed and so
  // carrying none. Best-effort: it renames other people's characters, and
  // failing it must not cost this player the character they just made.
  if (isDynastyHead(role.slug)) {
    await propagateDynastyLastName(created.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "character_created",
      targetCharacterId: created.id,
      details: {
        role: role.name,
        faction: role.faction?.name ?? null,
        location: role.startingLocation?.name ?? null,
        budget,
        spent,
        purchased: selected.map((t) => t.name),
        fear,
        antagonistOptIns,
      },
    },
  });

  await recordArchiveEvent({
    kind: "CHARACTER_CREATED",
    character: created,
    locationId: created.locationId ?? null,
    locationName: role.startingLocation?.name ?? null,
    turn: openTurn,
    content: `${created.name} arrived in Ravenheart as ${role.name}.`,
  });

  revalidatePath("/", "layout");
  redirect("/character");
}
