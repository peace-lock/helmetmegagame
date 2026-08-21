import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole, getSiloAccess } from "@/lib/factionPermissions";
import {
  setFactionLeader,
  setTreasurer,
  transferFromSilo,
  addCharacterToFaction,
  removeCharacterFromFaction,
} from "./actions";
import PageShell, { PageHeader } from "@/app/components/PageShell";

async function loadFaction(factionId) {
  return prisma.faction.findUnique({
    where: { id: factionId },
    include: {
      parentFaction: { select: { id: true, name: true } },
      characters: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          isLeader: true,
          isTreasurer: true,
        },
      },
    },
  });
}

async function loadSiloHistory(factionId) {
  return prisma.siloTransaction.findMany({
    where: { factionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

// Breadth-first over parentFactionId so a Leader's "Subject Factions" table
// (and the GM overview's indentation) covers the whole subtree, not just
// direct children — the hierarchy is one level deep today but this holds up
// if that changes.
async function getDescendantFactions(rootId) {
  const result = [];
  const seen = new Set([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.faction.findMany({
      where: { parentFactionId: { in: frontier } },
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, isLeader: true } } },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      frontier.push(child.id);
    }
  }
  return result;
}

function FactionTable({ factions, showSilo }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Leader</th>
            {showSilo && <th>Silo ⬢</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {factions.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{f.characters.length}</td>
                <td>{leader?.name ?? "-"}</td>
                {showSilo && <td>{f.silo}</td>}
                <td>
                  <Link href={`/faction?factionId=${f.id}`} className="menu-item">
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
          {factions.length === 0 && (
            <tr>
              <td colSpan={showSilo ? 5 : 4} className="text-center text-muted">
                None.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function buildChildrenMap(factions) {
  const map = new Map();
  for (const f of factions) {
    const key = f.parentFactionId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

// Renders a faction row plus its subject factions indented beneath it,
// recursively — keeps the hierarchy visible in the flat overview table
// instead of needing a separate page per level.
function FactionRows({ factions, childrenMap, depth, showSilo }) {
  return factions.flatMap((f) => {
    const leader = f.characters.find((c) => c.isLeader);
    const children = childrenMap.get(f.id) ?? [];
    return [
      <tr key={f.id}>
        <td style={{ paddingLeft: `calc(10px + ${depth * 1.25}rem)` }}>
          {depth > 0 ? "↳ " : ""}
          {f.name}
        </td>
        <td>{f.characters.length}</td>
        <td>{leader?.name ?? "-"}</td>
        {showSilo && <td>{f.silo}</td>}
        <td>
          <Link href={`/faction?factionId=${f.id}`} className="menu-item">
            View
          </Link>
        </td>
      </tr>,
      ...FactionRows({ factions: children, childrenMap, depth: depth + 1, showSilo }),
    ];
  });
}

function FactionOverview({ factions }) {
  const unaffiliated = factions.filter((f) => f.name === "Unaffiliated");
  const rest = factions.filter((f) => f.name !== "Unaffiliated");
  const childrenMap = buildChildrenMap(rest);
  const topLevel = rest.filter((f) => !f.parentFactionId);

  return (
    <PageShell>
      <PageHeader title="Factions" />
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Members</th>
              <th>Leader</th>
              <th>Silo ⬢</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {FactionRows({ factions: topLevel, childrenMap, depth: 0, showSilo: true })}
            {unaffiliated.map((f) => {
              const leader = f.characters.find((c) => c.isLeader);
              return (
                <tr key={f.id} style={{ borderTop: "2px solid var(--border)" }}>
                  <td>{f.name}</td>
                  <td>{f.characters.length}</td>
                  <td>{leader?.name ?? "-"}</td>
                  <td>{f.silo}</td>
                  <td>
                    <Link href={`/faction?factionId=${f.id}`} className="menu-item">
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}

function SiloHistoryPanel({ history }) {
  return (
    <section className="panel p-4">
      <h2 className="panel-header">Silo History</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Turn</th>
            <th>Amount</th>
            <th>By</th>
            <th>To</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {history.map((t) => (
            <tr key={t.id}>
              <td className="whitespace-nowrap">
                {t.turnNumber != null ? `#${t.turnNumber} (${t.turnPhase})` : "-"}
              </td>
              <td>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
              <td>{t.actorName}</td>
              <td>{t.toName ?? "-"}</td>
              <td className="max-w-xs truncate">{t.note ?? ""}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center text-muted">
                No Silo activity yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function TransferFromSiloPanel({ faction, members }) {
  return (
    <section className="panel p-4">
      <h2 className="panel-header">Transfer from Silo</h2>
      <form action={transferFromSilo} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="factionId" value={faction.id} />
        <label className="field">
          <span className="field-label">To</span>
          <select name="toCharacterId" required defaultValue="">
            <option value="" disabled>
              Choose a member...
            </option>
            {members.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Amount</span>
          <input type="number" name="amount" min="1" max={faction.silo} required className="text-input" style={{ width: "6rem" }} />
        </label>
        <label className="field">
          <span className="field-label">Note</span>
          <input type="text" name="note" placeholder="optional" className="text-input" />
        </label>
        <button type="submit" className="btn">
          Transfer
        </button>
      </form>
    </section>
  );
}

export default async function FactionPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const [{ isGm: gm }, myCharacter, allFactions] = await Promise.all([
    getGmSession(),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      select: { id: true, factionId: true, resources: true },
    }),
    prisma.faction.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const params = await searchParams;
  const requestedFactionId = params?.factionId?.toString() || "";

  if (!gm) {
    if (!myCharacter?.factionId) {
      return (
        <div className="mx-auto max-w-2xl p-6 sm:p-8">
          <p className="text-muted">You aren&apos;t assigned to a faction yet.</p>
        </div>
      );
    }

    const ownRole = await getMyFactionRole(session.discordUserId, myCharacter.factionId);

    // A parent faction's Leader/Treasurer can look into a subject faction's
    // roster and Silo — getSiloAccess walks the ancestor chain, so this only
    // succeeds when that's actually true. Anything else falls back to their
    // own faction rather than exposing factions outside their reach.
    let viewFactionId = myCharacter.factionId;
    let viewCanManageSilo = ownRole.canManageSilo;
    let viewingSubject = false;
    if (requestedFactionId && requestedFactionId !== myCharacter.factionId) {
      const access = await getSiloAccess(session.discordUserId, requestedFactionId);
      if (access.canManageSilo) {
        viewFactionId = requestedFactionId;
        viewCanManageSilo = true;
        viewingSubject = true;
      }
    }

    const faction = await loadFaction(viewFactionId);
    if (!faction) return null;

    // Unaffiliated is the DB's placeholder home for characters with no real
    // faction — players should experience it identically to having none at
    // all: no title, no member roster, no Silo.
    if (faction.name === "Unaffiliated") {
      return (
        <div className="mx-auto max-w-2xl p-6 sm:p-8">
          <p className="text-muted">You aren&apos;t assigned to a faction yet.</p>
        </div>
      );
    }

    const leader = faction.characters.find((c) => c.isLeader);
    const siloHistory = viewCanManageSilo ? await loadSiloHistory(faction.id) : [];

    // Membership administration (Assign/Revoke Treasurer) never extends to
    // subject factions — only Silo access does.
    const canManageMembers = !viewingSubject && ownRole.isLeader;

    const subjectFactions =
      !viewingSubject && ownRole.isLeader ? await getDescendantFactions(myCharacter.factionId) : [];

    return (
      <PageShell width="narrow">
        {viewingSubject && (
          <Link href="/faction" className="btn-quiet">
            &larr; Back to your faction
          </Link>
        )}

        <PageHeader
          title={faction.name}
          subtitle={
            viewingSubject && faction.parentFaction
              ? `Subject of ${faction.parentFaction.name}`
              : null
          }
        />

        <section className="panel p-4">
          <ul className="flex flex-col gap-1 text-sm">
            <li>Leader: {leader?.name ?? "None"}</li>
            <li>Faction Silo ⬢: {faction.silo}</li>
            {!viewingSubject && <li>Your Resources ⬢: {myCharacter.resources}</li>}
          </ul>
        </section>

        <section className="panel p-4">
          <h2 className="panel-header">Members ({faction.characters.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Fate</th>
                {canManageMembers && <th></th>}
              </tr>
            </thead>
            <tbody>
              {faction.characters.map((c) => {
                const treasurer = c.isTreasurer;
                return (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {c.isLeader ? " (Leader)" : ""}
                      {treasurer ? " (Treasurer)" : ""}
                    </td>
                    <td>{c.status}</td>
                    {canManageMembers && (
                      <td>
                        <form action={setTreasurer}>
                          <input type="hidden" name="characterId" value={c.id} />
                          <input type="hidden" name="factionId" value={faction.id} />
                          <input type="hidden" name="grant" value={(!treasurer).toString()} />
                          <button type="submit" className="btn-quiet">
                            {treasurer ? "Revoke Treasurer" : "Assign Treasurer"}
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {viewCanManageSilo && (
          <>
            <TransferFromSiloPanel
              faction={faction}
              members={faction.characters.filter((c) => c.status === "ALIVE")}
            />
            <SiloHistoryPanel history={siloHistory} />
          </>
        )}

        {subjectFactions.length > 0 && (
          <div>
            <h2 className="panel-header">Subject Factions</h2>
            <FactionTable factions={subjectFactions} showSilo />
          </div>
        )}
      </PageShell>
    );
  }

  // GM mode
  if (!requestedFactionId) {
    const factions = await prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    });
    return <FactionOverview factions={factions} />;
  }

  const [faction, unassignedCharacters] = await Promise.all([
    loadFaction(requestedFactionId),
    prisma.character.findMany({
      where: { status: "ALIVE", factionId: { not: requestedFactionId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!faction) redirect("/faction");

  const isUnaffiliated = faction.name === "Unaffiliated";
  const siloHistory = !isUnaffiliated ? await loadSiloHistory(faction.id) : [];
  const subjectFactions = await getDescendantFactions(faction.id);

  return (
    <PageShell width="narrow">
      <Link href="/faction" className="btn-quiet">
        &larr; All Factions
      </Link>

      <PageHeader
        title={faction.name}
        subtitle={faction.parentFaction ? `Subject of ${faction.parentFaction.name}` : null}
        actions={
          <form method="get" className="flex items-end gap-2">
            {/* Wrapped in .field: a bare select falls back to unstyled native
                browser chrome and visibly breaks the theme. */}
            <label className="field">
              <span className="field-label">Faction</span>
              <select name="factionId" defaultValue={faction.id}>
                {allFactions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">
              View
            </button>
          </form>
        }
      />

      <section className="panel p-4">
        <ul className="flex flex-col gap-1 text-sm">
          <li>Leader: {faction.characters.find((c) => c.isLeader)?.name ?? "None"}</li>
          {!isUnaffiliated && <li>Faction Silo ⬢: {faction.silo}</li>}
        </ul>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Members ({faction.characters.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Fate</th>
              <th></th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {faction.characters.map((c) => {
              const treasurer = c.isTreasurer;
              return (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    {c.isLeader ? " (Leader)" : ""}
                    {treasurer ? " (Treasurer)" : ""}
                  </td>
                  <td>{c.status}</td>
                  <td>
                    {!isUnaffiliated && !c.isLeader && (
                      <form action={setFactionLeader}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <button type="submit" className="btn-quiet">
                          Make leader
                        </button>
                      </form>
                    )}
                  </td>
                  <td>
                    {!isUnaffiliated && (
                      <form action={setTreasurer}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <input type="hidden" name="grant" value={(!treasurer).toString()} />
                        <button type="submit" className="btn-quiet">
                          {treasurer ? "Revoke Treasurer" : "Assign Treasurer"}
                        </button>
                      </form>
                    )}
                  </td>
                  <td>
                    {!isUnaffiliated && (
                      <form action={removeCharacterFromFaction}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <button type="submit" className="btn-quiet">
                          Remove
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {faction.characters.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {!isUnaffiliated && (
        <>
          <TransferFromSiloPanel
            faction={faction}
            members={faction.characters.filter((c) => c.status === "ALIVE")}
          />
          <SiloHistoryPanel history={siloHistory} />
        </>
      )}

      {subjectFactions.length > 0 && (
        <div>
          <h2 className="panel-header">Subject Factions</h2>
          <FactionTable factions={subjectFactions} showSilo />
        </div>
      )}

      <section className="panel p-4">
        <h2 className="panel-header">Add Member</h2>
        <form action={addCharacterToFaction} className="flex gap-2">
          <input type="hidden" name="factionId" value={faction.id} />
          <select name="characterId" required defaultValue="">
            <option value="" disabled>
              Choose a character...
            </option>
            {unassignedCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Add
          </button>
        </form>
      </section>
    </PageShell>
  );
}
