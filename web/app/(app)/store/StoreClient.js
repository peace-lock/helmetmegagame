"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PointBuy from "@/app/components/PointBuy";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  tagsById as buildTagsById,
  effectiveTotalCost,
} from "@/lib/characterCreation";
import { buyTags } from "./actions";

// The cart's state and the checkout button; everything else is PointBuy.
export default function StoreClient({ tags, budget, heldTags, drawbackCap, drawbackHeld }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const router = useRouter();

  // Same arithmetic as PointBuy's own readout and the server's re-check —
  // only used to keep the Buy button honest.
  const byId = useMemo(() => buildTagsById(tags), [tags]);
  const heldIds = useMemo(() => heldTags.map((t) => t.id), [heldTags]);
  const selected = tags.filter((t) => selectedIds.includes(t.id));
  const total = effectiveTotalCost(selected, byId, heldIds);
  const blocked = pending || selected.length === 0 || total > budget;

  const checkout = async () => {
    setError("");
    const ok = await confirm({
      title: "Confirm purchase",
      message: `Buy ${selected.length} tag${selected.length === 1 ? "" : "s"} for ${total} Tag Point${total === 1 ? "" : "s"}? It applies immediately, and a GM reviews it afterwards.`,
      confirmLabel: "Buy",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await buyTags({ tagIds: selectedIds });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelectedIds([]);
      router.refresh();
    });
  };

  // drawbackCap/drawbackHeld are read-only here: every drawback is
  // purchasableAfterStart: false, so the shelf never offers one and the total
  // can't move. They're passed so a player can see how many drawback points
  // character creation already spent.
  return (
    <PointBuy
      tags={tags}
      budget={budget}
      grantedTags={heldTags}
      afterStartOnly
      selectedIds={selectedIds}
      onChange={setSelectedIds}
      drawbackCap={drawbackCap}
      drawbackHeld={drawbackHeld}
      actions={
        <div className="flex flex-col gap-2">
          <button type="button" className="btn" disabled={blocked} onClick={checkout}>
            {pending ? "Buying…" : selected.length ? `Buy for ${total} points` : "Buy"}
          </button>
          <FormError>{error}</FormError>
        </div>
      }
    />
  );
}
