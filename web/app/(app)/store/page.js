import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { DEFAULT_MAX_DRAWBACK_POINTS, drawbackPoints } from "@/lib/characterCreation";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import StoreClient from "./StoreClient";

export const metadata = { title: "Store" };

// The mid-game tag store: the same PointBuy experience as character
// creation, spending Character.tagPoints instead of the starting budget and
// offering only tags still marked purchasableAfterStart. Checkout applies
// instantly and files ONE batched BUY_TAGS request for GM review — the same
// apply-then-review contract as every other request (REQUESTS.md).
export default async function StorePage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const [character, config] = await Promise.all([
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      select: {
        id: true,
        tagPoints: true,
        // `source` rides along for the drawback count below: only what was
        // bought through the point-buy menu counts against the cap.
        tags: { select: { tagId: true, source: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { maxDrawbackPoints: true } }),
  ]);
  // No character, nothing to spend — the wizard (or the sheet) is the page
  // they actually want.
  if (!character) redirect("/character");

  // Held ids widen the catalog so unpurchasable held tags (a GM-granted
  // Demoness, a crafted item) still reach the client's byId map — chain
  // discounts and hidden-category gates key off them.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const tags = await loadPointBuyCatalog(heldIds);
  const held = new Set(heldIds);
  const heldTags = tags.filter((t) => held.has(t.id)).map((t) => ({ id: t.id, name: t.name }));

  // Drawback points already spent, for PointBuy's counter. Every negative tag
  // is purchasableAfterStart: false, so the store can't sell one and this
  // number can't move here — it is shown so a player knows where they stand,
  // not to gate the cart. Only POINT_BUY counts: a GM-inflicted wound is not a
  // choice the player made with their points.
  const costById = new Map(tags.map((t) => [t.id, t.pointCost]));
  const drawbackHeld = drawbackPoints(
    character.tags
      .filter((ct) => ct.source === "POINT_BUY")
      .map((ct) => ({ pointCost: costById.get(ct.tagId) })),
  );

  return (
    <PageShell width="wide">
      <PageHeader
        title="Store"
        subtitle="Spend your Tag Points on new tags. Purchases apply immediately; a GM sees each one as a request."
      />
      <StoreClient
        tags={tags}
        budget={character.tagPoints}
        heldTags={heldTags}
        drawbackCap={config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS}
        drawbackHeld={drawbackHeld}
      />
    </PageShell>
  );
}
