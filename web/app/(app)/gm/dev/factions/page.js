import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateFaction, deleteFaction } from "../actions";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function DevFactionsPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const factions = await prisma.faction.findMany({ orderBy: { name: "asc" } });

  return (
    <PageShell>
      <Link href="/gm/dev" className="btn-quiet">&larr; Back to Dev Panel</Link>
      <PageHeader title={`Factions (${factions.length})`} />

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Parent</th>
              <th>Silo</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {factions.map((f) => (
              <tr key={f.id}>
                <td>
                  <form action={updateFaction} id={`faction-${f.id}`} className="contents">
                    <input type="hidden" name="factionId" value={f.id} />
                  </form>
                  <input name="name" defaultValue={f.name} form={`faction-${f.id}`} className="text-input" />
                </td>
                <td>
                  <select name="parentFactionId" defaultValue={f.parentFactionId ?? ""} form={`faction-${f.id}`}>
                    <option value="">None</option>
                    {factions
                      .filter((other) => other.id !== f.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    name="silo"
                    defaultValue={f.silo}
                    form={`faction-${f.id}`}
                    className="text-input"
                    style={{ width: "6rem" }}
                  />
                </td>
                <td>
                  <button type="submit" form={`faction-${f.id}`} className="btn-quiet">
                    Save
                  </button>
                </td>
                <td>
                  {f.name !== "Unaffiliated" && (
                    <form action={deleteFaction}>
                      <input type="hidden" name="factionId" value={f.id} />
                      <button type="submit" className="btn-quiet">
                        Delete
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {factions.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  No factions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
