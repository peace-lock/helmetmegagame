import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { sendDmReply } from "../../actions";
import MessageList from "./MessageList";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function MessageThreadPage({ params }) {
  const { discordUserId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [messages, guildMembers, character] = await Promise.all([
    prisma.directMessage.findMany({ where: { discordUserId }, orderBy: { createdAt: "asc" } }),
    listGuildMembers(),
    prisma.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (messages.length === 0 && !character) notFound();

  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  const label = character?.name ?? username ?? discordUserId;

  return (
    <PageShell width="narrow">
      <Link href="/gm/messages" className="btn-quiet">
        &larr; Back to Messages
      </Link>
      <PageHeader title={label} />

      <MessageList messages={messages} />

      <form action={sendDmReply} className="panel flex flex-col gap-3 p-4">
        <input type="hidden" name="discordUserId" value={discordUserId} />
        <label className="field">
          <span className="field-label">Reply (from Lifeweb)</span>
          <textarea name="message" rows={3} required />
        </label>
        <button type="submit" className="btn self-start">
          Send
        </button>
      </form>
    </PageShell>
  );
}
