import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, getGuildMember, isCursed } from "@/lib/discordGuild";
import { updateCharacterRaw, grantTag, revokeTag } from "../../actions";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function DevCharacterEditPage({ params }) {
  const { characterId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [character, factions, zones, ownedTags, allTags, roles] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.faction.findMany({ orderBy: { name: "asc" } }),
    prisma.zone.findMany({ orderBy: { name: "asc" }, include: { locations: { orderBy: { name: "asc" } } } }),
    prisma.characterTag.findMany({ where: { characterId }, include: { tag: true } }),
    prisma.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.role.findMany({ orderBy: [{ sortOrder: "asc" }], include: { faction: true } }),
  ]);
  if (!character) notFound();

  // Cursed is a live Discord role (DISCORD_CURSED_ROLE_ID), not a DB field —
  // read the account's current guild roles rather than the Character row.
  const member = await getGuildMember(character.discordUserId);
  const cursed = isCursed(member);

  const ownedTagIds = new Set(ownedTags.map((ct) => ct.tagId));
  const grantableTags = allTags.filter((t) => !ownedTagIds.has(t.id));

  return (
    <PageShell width="narrow">
      <Link href="/gm/players" className="btn-quiet">&larr; Back to Players</Link>
      <PageHeader title={character.name} />

      <form action={updateCharacterRaw} className="panel flex flex-col gap-3 p-4">
        <input type="hidden" name="characterId" value={character.id} />

        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={character.name} required />
        </label>

        <label className="field">
          <span className="field-label">Role</span>
          <select name="roleId" defaultValue={character.roleId ?? ""}>
            <option value="">(none — keeps the free-text title below)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.faction.name} / {r.name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Role title (ignored when a Role is picked above)</span>
          <input name="roleTitle" defaultValue={character.roleTitle ?? ""} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Faction</span>
            <select name="factionId" defaultValue={character.factionId ?? ""}>
              <option value="">(none)</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Zone (only used when no Location is set)</span>
            <select name="zoneId" defaultValue={character.zoneId ?? ""}>
              <option value="">(none)</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">Location</span>
          <select name="locationId" defaultValue={character.locationId ?? ""}>
            <option value="">(none — grants no location channel access)</option>
            {zones.map((z) => (
              <optgroup key={z.id} label={z.name}>
                {z.locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Status</span>
            <select name="status" defaultValue={character.status}>
              <option value="ALIVE">ALIVE</option>
              <option value="DEAD">DEAD</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-sm" style={{ marginTop: "1.6rem" }}>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isLeader" defaultChecked={character.isLeader} />
              Faction leader
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isTreasurer" defaultChecked={character.isTreasurer} />
              Faction treasurer
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Resources ⬢</span>
            <input type="number" name="resources" defaultValue={character.resources} />
          </label>
          <label className="field">
            <span className="field-label">Unspent tag points</span>
            <input type="number" name="tagPoints" defaultValue={character.tagPoints} />
          </label>
        </div>

        <p className="text-sm">
          <strong>Cursed:</strong> {cursed ? "Yes" : "No"} — granted automatically when this
          character dies, removed automatically once the player rolls a new one. To clear it early
          (body buried / rites read), remove the role directly in Discord.
        </p>

        <label className="field">
          <span className="field-label">Appearance / bio</span>
          <textarea name="appearance" rows={4} defaultValue={character.appearance ?? ""} />
        </label>

        <button type="submit" className="btn self-start">Save</button>
      </form>

      <div className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Tags</h2>

        {ownedTags.length === 0 ? (
          <p className="text-sm text-muted">No tags owned.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ownedTags.map((ct) => (
              <li key={ct.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {ct.tag.name}
                  {ct.quantity > 1 && <> &times;{ct.quantity}</>}{" "}
                  <span className="text-muted">({ct.source})</span>
                </span>
                <form action={revokeTag}>
                  <input type="hidden" name="characterTagId" value={ct.id} />
                  <input type="hidden" name="characterId" value={character.id} />
                  {/* Takes one off a stack; drops the row when that's the last. */}
                  <button type="submit" className="btn-quiet">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {grantableTags.length > 0 && (
          <form action={grantTag} className="flex items-end gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <input type="hidden" name="characterId" value={character.id} />
            <label className="field flex-1">
              <span className="field-label">Grant tag</span>
              <select name="tagId" required defaultValue="">
                <option value="" disabled>Choose a tag...</option>
                {grantableTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.category ? `[${t.category}] ` : ""}{t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">Grant</button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
