import { redirect } from "next/navigation";
import { prisma, MORTUS_SLUG, LIFEWEB_SPUTTER_THRESHOLD } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import LifewebDonateBloodPanel from "../../components/LifewebDonateBloodPanel";
import LifewebFeedPersonButton from "../../components/LifewebFeedPersonButton";
import LifewebRequestButtons from "../../components/LifewebRequestButtons";
import PageShell, { PageHeader } from "@/app/components/PageShell";

function bloodBand(blood) {
  if (blood <= 0) return { label: "Dry", color: "var(--accent)" };
  if (blood <= LIFEWEB_SPUTTER_THRESHOLD) return { label: "Sputtering", color: "var(--accent)" };
  if (blood <= 60) return { label: "Thinning", color: "var(--text)" };
  return { label: "Full", color: "var(--positive)" };
}

export default async function LifewebPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const { isGm: gm } = await getGmSession();

  // A GM reaches the page without a Mortus character; only a Mortus gets the
  // player-facing Request buttons, since the server action re-checks the tag.
  const mortusCharacter = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE", tags: { some: { tag: { slug: MORTUS_SLUG } } } },
    select: { id: true },
  });
  if (!mortusCharacter && !gm) redirect("/character");

  const [config, aliveCharacters] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    // Tags come down with them so the Donate Blood dialog can price a target
    // (Nobility 40 / Courtier 30 / 20) without a round trip per selection.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    }),
  ]);

  const blood = config.lifewebBlood ?? 0;
  const band = bloodBand(blood);

  return (
    <PageShell width="narrow">
      <PageHeader title="The Lifeweb" />

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="section-title" style={{ color: band.color }}>{band.label}</h2>
          <span className="text-sm text-muted">{blood} / 100</span>
        </div>

        <div
          className="mt-3"
          style={{
            height: "10px",
            borderRadius: "999px",
            background: "var(--field-bg)",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div style={{ height: "100%", width: `${blood}%`, background: band.color }} />
        </div>
      </section>

      {mortusCharacter && (
        <section className="panel p-5">
          <h2 className="panel-header">Tend the Web</h2>
          <LifewebRequestButtons characters={aliveCharacters} />
          <p className="mt-3 text-xs text-muted">
            Both take effect at once. A GM reviews them afterwards and may undo or edit them.
          </p>
        </section>
      )}

      {gm && (
        <section className="panel p-5">
          <h2 className="panel-header">GM Panel</h2>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">Donate Blood</h3>
            {aliveCharacters.length === 0 ? (
              <p className="text-sm text-muted">No living characters.</p>
            ) : (
              <LifewebDonateBloodPanel characters={aliveCharacters} />
            )}
          </div>

          <div className="mt-5 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-bold">Feed Person</h3>
            <LifewebFeedPersonButton />
          </div>
        </section>
      )}
    </PageShell>
  );
}
