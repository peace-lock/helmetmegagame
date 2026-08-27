import { redirect } from "next/navigation";
import { prisma, roleCapacity, isDynastyMember } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { dynastyLastName } from "@/lib/dynasty";
import { getOpenTurn } from "@/lib/turn";
import {
  getGuildMember,
  isApprovedPlayer,
  isCursed,
  isLeaderWhitelisted,
} from "@/lib/discordGuild";
import {
  isPlaytestLocked,
  isRoleSelectable,
  DEFAULT_MAX_DRAWBACK_POINTS,
} from "@/lib/characterCreation";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { TRANSFERABLE_CATEGORIES } from "@/lib/tagRequests";
import { parseSelection } from "@/lib/portrait/catalog";
import {
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  missingSkillsFor,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import CharacterSheet from "../../components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";

// Everything the creation wizard needs, shaped as the Zone -> Faction -> Role
// tree it renders. Seat counts are computed here rather than in the client so
// the numbers can't be stale-rendered from a cached page; the server action
// re-counts inside its transaction anyway, since this is only advisory.
async function loadCreationData(discordUserId) {
  const [zones, tags, config, member, takenRows, dynastyName] = await Promise.all([
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      include: {
        factions: {
          orderBy: { sortOrder: "asc" },
          include: {
            roles: { orderBy: { sortOrder: "asc" }, include: { startingLocation: true } },
          },
        },
      },
    }),
    loadPointBuyCatalog(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    prisma.character.groupBy({ by: ["roleId"], where: { status: "ALIVE" }, _count: true }),
    // Shown on the (locked) last-name input if a family seat is picked.
    dynastyLastName(),
  ]);

  const cursed = isCursed(member);
  // Mirrors the bypass in createCharacter so the host sees the wizard rather
  // than the locked-out screen. The server action re-checks regardless — this
  // is presentation, that is enforcement.
  const superadmin = isSuperadmin(discordUserId);
  const gate = {
    open: superadmin || config?.openToPlayers === true,
    approved: superadmin || isApprovedPlayer(member),
  };
  // The whitelist gate itself is a Dev Panel switch (GameConfig). `=== false`
  // rather than a falsy check on purpose: no config row means the gate stays
  // enforced, matching the fail-closed posture in db/lib/roleIds.js.
  const leaderWhitelisted =
    superadmin || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  // No superadmin bypass here, unlike the two gates above: this one holds back
  // an unfinished role, so the host wants it locked too (characterCreation.js).
  const playtestMode = config?.playtestModeEnabled === true;
  const playerCount = config?.playerCount ?? 100;
  const takenByRole = new Map(takenRows.map((r) => [r.roleId, r._count]));

  return {
    gate,
    cursed,
    dynastyName,
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    maxDrawbackPoints: config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS,
    // Already flattened to PointBuy's shape by loadPointBuyCatalog — shared
    // with /store so the two menus can never disagree.
    tags,
    zones: zones
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        factions: zone.factions
          .map((faction) => ({
            id: faction.id,
            name: faction.name,
            roles: faction.roles.map((role) => {
              const cap = roleCapacity(role, playerCount);
              // Locked roles stay in the tree rather than being filtered out,
              // so a player can still read the charter of a role that's simply
              // shut for this run. The card greys itself and says why.
              const playtestLocked =
                playtestMode && isPlaytestLocked({ role, zoneName: zone.name });
              return {
                id: role.id,
                name: role.name,
                intro: role.intro,
                // Some titles are earned by role rather than by tag, and
                // db/lib/titles.js keys on the slug (see the Identity step).
                slug: role.slug,
                difficulty: role.difficulty,
                factionName: faction.name,
                startingLocationName: role.startingLocation?.name ?? null,
                startingResources: role.startingResources,
                extraStartingPoints: role.extraStartingPoints,
                startingTagNames: role.startingTagSlugs,
                grantsLeader: role.grantsLeader,
                // Infinity doesn't survive serialization to the client, so
                // uncapped roles cross the boundary as null and render "∞".
                cap: cap === Infinity ? null : cap,
                taken: takenByRole.get(role.id) ?? 0,
                selectable: isRoleSelectable({ role, cursed, leaderWhitelisted, playtestLocked }),
                playtestLocked,
                // The Baron's family don't choose a surname (db/lib/dynasty.js).
                // Resolved here rather than in the wizard so a client component
                // never imports the barrel and drags PrismaClient into the
                // browser bundle.
                lastNameLocked: isDynastyMember(role.slug),
              };
            }),
          }))
          .filter((f) => f.roles.length > 0),
      }))
      .filter((z) => z.factions.length > 0),
  };
}

export default async function CharacterPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      faction: true,
      zone: true,
      location: true,
      // Only the slug, and only so the Bio panel can grey out the last name
      // for the Baron's family (db/lib/dynasty.js).
      role: { select: { slug: true } },
      // group comes along so TagChip can tint the chip, same as
      // /gm/turns does it — otherwise every Item renders uncoloured.
      // requirementSkills has to be named explicitly: `include` returns every
      // scalar but no unnamed relation, and formatTagRequirement guards with
      // `?.length`, so leaving it off silently drops the skill from the
      // tooltip's cost line rather than failing.
      tags: {
        include: {
          tag: { include: { group: true, requirementSkills: { select: { name: true } } } },
        },
      },
      defaultEffort: true,
    },
  });

  // No living character — this IS the create-a-character screen. Rendered
  // inline rather than redirecting to a separate route, so a player who just
  // died lands somewhere that explains itself instead of bouncing.
  if (!character) {
    const { gate, ...creation } = await loadCreationData(session.discordUserId);
    // Both halves have to hold before the wizard is worth rendering; the
    // server action re-checks them regardless.
    if (!gate.open || !gate.approved) return <CreationClosed open={gate.open} />;
    return <CreateCharacterWizard {...creation} />;
  }

  const [openTurn, otherCharacters, factions, tagCatalog, tierRows, desire, lastEndedDesire, gameConfig] =
    await Promise.all([
      getOpenTurn(),
      prisma.character.findMany({
        where: { status: "ALIVE", id: { not: character.id } },
        orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
        select: { id: true, name: true },
      }),
      prisma.faction.findMany({
        where: { name: { not: "Unaffiliated" } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // The Add Tag menu needs purchasable/craftable, which getVisibleTags (lib/referenceData.js) doesn't
      // select (and which that unauthenticated route shouldn't grow just to
      // serve a picker) — so the catalog comes down as props, same as the
      // creation wizard does it.
      prisma.tag.findMany({
        where: { OR: [{ purchasable: true }, { craftable: true }] },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          pointCost: true,
          purchasable: true,
          // addableTags' purchasable branch requires purchasableAfterStart;
          // without this select it read undefined and silently dropped every
          // purchasable-only tag from the Add Tag menu.
          purchasableAfterStart: true,
          craftable: true,
          stackable: true,
          // Both gates the Add Tag menu enforces — the per-tag prerequisite and
          // the whole-group one behind a hidden category. parentTagId comes
          // along because requirementSatisfied walks the tier chain.
          parentTagId: true,
          requiredTagId: true,
          // The gates' NAMES, for the picker's "Requires: …" line. Safe:
          // gated tags only render for viewers who hold the gate.
          requiredTag: { select: { name: true } },
          group: {
            select: {
              name: true,
              color: true,
              requiredTagId: true,
              requiredTag: { select: { name: true } },
            },
          },
        },
      }),
      // id -> parentTagId for the whole catalog, so a held Medical (Expert)
      // resolves back down its chain to the Medical (Basic) gate. Four columns
      // over a few hundred rows — cheaper than nesting three parentTag includes.
      prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
      prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } }),
      prisma.desire.findFirst({
        where: { characterId: character.id, status: { in: ["FULFILLED", "CANCELLED"] } },
        orderBy: { updatedAt: "desc" },
        select: { endedTurnNumber: true },
      }),
      prisma.gameConfig.findUnique({
        where: { id: 1 },
        select: {
          equipSlots: true,
          avatarUploadsEnabled: true,
          portraitMakerEnabled: true,
          portraitFantasyPartsEnabled: true,
        },
      }),
    ]);

  // Both ends of a transfer list every Silo and every living player,
  // INCLUDING yourself — pulling ⬢ out of a Silo into your own pocket is the
  // common case, and self -> self is already refused by the same-party guard
  // in transferResourcesRequest. See REQUESTS.md §"the source can be anyone".
  const selfEntry = { id: character.id, name: character.name };
  const transferParties = {
    characters: [...otherCharacters, selfEntry].sort((a, b) => a.name.localeCompare(b.name)),
    factions,
  };
  // Healing. The medical gate is resolved here, server-side, so no tier-chain
  // math (and no other character's full sheet) reaches the client bundle —
  // TagRequestButtons gets a finished, presentational shape.
  const ancestry = buildSkillAncestry(tierRows);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const canHeal = Boolean(healSkillId && satisfied.has(healSkillId));

  // Skipped entirely for the great majority who aren't medics, and for anyone
  // a GM hasn't placed yet. locationId is the authoritative "where are you"
  // field; zoneId is only a mirror.
  const coLocated =
    canHeal && character.locationId
      ? await prisma.character.findMany({
          where: { status: "ALIVE", locationId: character.locationId },
          orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
          select: {
            id: true,
            name: true,
            // Deliberately no `resources` — a member's balance stays behind
            // Silo authority (see CLAUDE.md), and the payer menu never shows
            // balances anyway. Affordability is re-checked server-side.
            tags: {
              select: {
                tag: {
                  select: {
                    id: true,
                    name: true,
                    category: true,
                    requirementTurns: true,
                    requirementResources: true,
                    requirementGambit: true,
                    requirementSkills: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        })
      : [];

  // Filtered down to treatable tags HERE rather than in the client, so nobody
  // else's full sheet crosses the wire. A target with nothing to treat drops
  // out of the menu entirely.
  const healTargets = coLocated
    .map((t) => ({
      id: t.id,
      name: t.name,
      healable: t.tags
        .map((ct) => ct.tag)
        .filter(isHealable)
        .map((tag) => ({
          tagId: tag.id,
          tagName: tag.name,
          cost: healCost(tag),
          requirementLabel: formatTagRequirement(tag),
          // Empty means this medic may treat it; otherwise the names the
          // disabled row shows. Re-derived server-side on submit.
          missingSkills: missingSkillsFor(tag, satisfied).map((s) => s.name),
        })),
    }))
    .filter((t) => t.healable.length > 0);

  // Everyone standing here, plus EVERY faction Silo regardless of authority —
  // the same reach TRANSFER_RESOURCES has, per REQUESTS.md.
  const healParties = { characters: coLocated.map(({ id, name }) => ({ id, name })), factions };

  // Corpses to loot. Only DEAD characters at the same locationId, and only
  // Items/Assets get lifted off them — the same category gate the transfer
  // system enforces. Filtered here rather than in the client so nobody else's
  // full sheet crosses the wire.
  //
  // This is the single player-facing surface that reveals a death: every
  // other list (faction roster, transfer target picker) shows the row as
  // normal. Someone standing in the room has intentionally looked, so
  // surfacing the name here is the whole point.
  const corpses = character.locationId
    ? (
        await prisma.character.findMany({
          where: { status: "DEAD", locationId: character.locationId },
          orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
          select: {
            id: true,
            name: true,
            resources: true,
            tags: {
              where: { tag: { category: { in: TRANSFERABLE_CATEGORIES } } },
              select: {
                tagId: true,
                quantity: true,
                tag: { select: { name: true, category: true, stackable: true } },
              },
            },
          },
        })
      )
          .map((c) => ({
            id: c.id,
            name: c.name,
            resources: c.resources,
            lootableTags: c.tags.map((ct) => ({
              tagId: ct.tagId,
              tagName: ct.tag.name,
              category: ct.tag.category,
              stackable: ct.tag.stackable,
              quantity: ct.quantity ?? 1,
            })),
          }))
          .filter((c) => c.lootableTags.length > 0 || c.resources > 0)
    : [];

  const avatarSrc = `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;

  return (
    <CharacterSheet
      character={character}
      mode="self"
      openTurn={openTurn}
      avatarSrc={avatarSrc}
      transferParties={transferParties}
      tagCatalog={tagCatalog}
      otherCharacters={otherCharacters}
      desire={desire}
      desireCooldownUntilTurn={lastEndedDesire?.endedTurnNumber ?? null}
      canHeal={canHeal}
      equipSlots={gameConfig?.equipSlots ?? 6}
      avatarUploadsEnabled={gameConfig?.avatarUploadsEnabled ?? false}
      portraitMakerEnabled={gameConfig?.portraitMakerEnabled ?? false}
      portraitFantasyPartsEnabled={gameConfig?.portraitFantasyPartsEnabled ?? false}
      // Re-validated here rather than trusted from the column: a stored index
      // can outlive a catalog change, and a fantasy part can outlive the
      // switch that allowed it.
      portraitSelection={parseSelection(character.portrait, {
        allowFantasy: gameConfig?.portraitFantasyPartsEnabled ?? false,
      })}
      hasCustomAvatar={Boolean(character.avatarMimeType)}
      healTargets={healTargets}
      healParties={healParties}
      corpses={corpses}
      lastNameLocked={isDynastyMember(character.role?.slug)}
    />
  );
}
