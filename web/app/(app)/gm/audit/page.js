import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import CharacterLink from "../../../components/CharacterLink";
import PageShell, { PageHeader } from "@/app/components/PageShell";

const PAGE_SIZE = 50;
const NO_FACTION_LABEL = "No faction";

// Groups + sorts characters for the Target character <select>: factions
// alphabetical (No faction last), characters alphabetical within each.
function groupCharactersByFaction(characters) {
  const groups = new Map();
  for (const c of characters) {
    const key = c.faction?.name || NO_FACTION_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const factionNames = [...groups.keys()]
    .filter((name) => name !== NO_FACTION_LABEL)
    .sort((a, b) => a.localeCompare(b));
  if (groups.has(NO_FACTION_LABEL)) factionNames.push(NO_FACTION_LABEL);
  return factionNames.map((name) => ({
    name,
    characters: groups.get(name).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export default async function AuditLogPage({ searchParams }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const params = await searchParams;
  const actionType = params?.actionType?.toString().trim() || "";
  const actor = params?.actor?.toString().trim() || "";
  const target = params?.target?.toString().trim() || "";
  const q = params?.q?.toString().trim() || "";
  const from = params?.from?.toString().trim() || "";
  const to = params?.to?.toString().trim() || "";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  const [allCharacters, guildMembers] = await Promise.all([
    prisma.character.findMany({
      select: { id: true, name: true, status: true, discordUserId: true, faction: { select: { name: true } } },
    }),
    listGuildMembers(),
  ]);
  const characterGroups = groupCharactersByFaction(allCharacters);

  // Free-text search: matches action type, actor Discord ID, actor's
  // Discord username / character name(s), or target character name.
  let qClauses = [];
  if (q) {
    const qLower = q.toLowerCase();
    const matchedActorIds = new Set([
      ...allCharacters.filter((c) => c.name.toLowerCase().includes(qLower)).map((c) => c.discordUserId),
      ...guildMembers.filter((m) => m.username?.toLowerCase().includes(qLower)).map((m) => m.id),
    ]);
    qClauses = [
      { actionType: { contains: q, mode: "insensitive" } },
      { actorDiscordUserId: { contains: q, mode: "insensitive" } },
      { targetCharacter: { name: { contains: q, mode: "insensitive" } } },
      ...(matchedActorIds.size ? [{ actorDiscordUserId: { in: [...matchedActorIds] } }] : []),
    ];
  }

  const where = {
    ...(actionType ? { actionType: { contains: actionType, mode: "insensitive" } } : {}),
    ...(actor ? { actorDiscordUserId: { contains: actor, mode: "insensitive" } } : {}),
    ...(target ? { targetCharacterId: target } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
          },
        }
      : {}),
    ...(qClauses.length ? { OR: qClauses } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { targetCharacter: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const usernameById = new Map(guildMembers.map((m) => [m.id, m.username]));
  const characterByDiscordUserId = new Map();
  for (const c of allCharacters) {
    const existing = characterByDiscordUserId.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByDiscordUserId.set(c.discordUserId, c);
  }

  function pageHref(newPage) {
    const next = new URLSearchParams({ actionType, actor, target, q, from, to, page: String(newPage) });
    for (const key of [...next.keys()]) {
      if (!next.get(key)) next.delete(key);
    }
    return `/gm/audit?${next.toString()}`;
  }

  return (
    <PageShell>
      <PageHeader title="Audit Log" />

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span className="field-label">Search</span>
          <input name="q" defaultValue={q} placeholder="action, actor, character..." />
        </label>
        <label className="field">
          <span className="field-label">Action type</span>
          <input name="actionType" defaultValue={actionType} placeholder="e.g. resource_transfer" />
        </label>
        <label className="field">
          <span className="field-label">Actor Discord ID</span>
          <input name="actor" defaultValue={actor} />
        </label>
        <label className="field">
          <span className="field-label">Target character</span>
          <select name="target" defaultValue={target}>
            <option value="">Any</option>
            {characterGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status !== "ALIVE" ? ` (${c.status.toLowerCase()})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">From</span>
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      {/* Tall, fixed-height scroller with a pinned header — the log is long
          and a GM scans it rather than paging through it. */}
      <div className="panel table-scroll">
        <table className="data-table" style={{ minWidth: "900px" }}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Player</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap">{entry.createdAt.toISOString()}</td>
                <td>{entry.actionType}</td>
                <td className="whitespace-nowrap">
                  {usernameById.get(entry.actorDiscordUserId) ?? entry.actorDiscordUserId}
                  {characterByDiscordUserId.has(entry.actorDiscordUserId) ? (
                    <div className="text-xs text-muted">
                      <CharacterLink
                        characterId={characterByDiscordUserId.get(entry.actorDiscordUserId).id}
                        name={characterByDiscordUserId.get(entry.actorDiscordUserId).name}
                        isGm
                      />
                    </div>
                  ) : null}
                </td>
                <td>
                  <CharacterLink characterId={entry.targetCharacter?.id} name={entry.targetCharacter?.name} isGm />
                </td>
                {/* Only Request-backed entries carry a reason (see
                    web/lib/requests.js#logRequest); everything else is blank. */}
                <td style={{ minWidth: "14rem" }}>{entry.reason ?? ""}</td>
                <td className="max-w-xs truncate">{entry.details ? JSON.stringify(entry.details) : ""}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  No entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          Page {page} of {totalPages} ({total} entries)
        </span>
        <div className="flex gap-3">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="menu-item">
              Previous
            </Link>
          )}
          {page < totalPages && (
            <Link href={pageHref(page + 1)} className="menu-item">
              Next
            </Link>
          )}
        </div>
      </div>
    </PageShell>
  );
}
