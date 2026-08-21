import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import MessagesToolbar from "./MessagesToolbar";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function MessagesPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [messages, guildMembers, aliveCharacters] = await Promise.all([
    prisma.directMessage.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
    listGuildMembers(),
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: { id: true, discordUserId: true, name: true },
    }),
  ]);

  const conversations = new Map();
  for (const m of messages) {
    if (!conversations.has(m.discordUserId)) {
      conversations.set(m.discordUserId, { discordUserId: m.discordUserId, lastMessage: m, count: 0 });
    }
    conversations.get(m.discordUserId).count += 1;
  }

  const usernameById = new Map(guildMembers.map((mem) => [mem.id, mem.username]));
  const discordUserIds = [...conversations.keys()];
  const characters = await prisma.character.findMany({
    where: { discordUserId: { in: discordUserIds } },
    select: { discordUserId: true, name: true, status: true },
  });
  const characterNameById = new Map();
  for (const c of characters) {
    const existing = characterNameById.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterNameById.set(c.discordUserId, c.name);
  }

  const rows = [...conversations.values()].sort(
    (a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt,
  );

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Messages"
        subtitle="Every direct message the bot has sent or received, grouped by player."
      />

      <MessagesToolbar characters={aliveCharacters} />

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Last message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.discordUserId}>
                <td className="whitespace-nowrap">
                  <Link href={`/gm/messages/${row.discordUserId}`} className="menu-item">
                    {characterNameById.get(row.discordUserId) ??
                      usernameById.get(row.discordUserId) ??
                      row.discordUserId}
                  </Link>
                </td>
                <td className="max-w-md truncate">
                  {row.lastMessage.direction === "OUTBOUND" ? "You: " : ""}
                  {row.lastMessage.content}
                </td>
                <td>
                  <Link href={`/gm/messages/${row.discordUserId}`} className="menu-item">
                    Open ({row.count})
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-muted">
                  No direct messages yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
