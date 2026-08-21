"use client";

import { useState, useTransition } from "react";
import { bloodValueForTags } from "@lifeweb/db/lib/lifeweb";
import RequestDialog from "./RequestDialog";
import { useConfirm } from "./ConfirmProvider";
import { donateBloodRequest, feedPersonRequest } from "../(app)/lifeweb/requestActions";

// The Mortus's two Lifeweb Requests. Both take effect immediately and are
// reviewed afterwards like every other Request, but they act on SOMEONE ELSE'S
// character — so each one asks twice: the reason dialog, then the shared
// confirm on top of it. See docs/systemdocs/REQUESTS.md.

const MODES = {
  donate: {
    title: "Donate Blood",
    submitLabel: "Draw blood",
    hint: "They take the Drained tag until it wears off. Whose blood it is decides what it's worth.",
  },
  feed: {
    title: "Feed Person",
    submitLabel: "Feed them",
    hint: "This does not kill them — a GM reads your reason and does that by hand.",
  },
};

export default function LifewebRequestButtons({ characters }) {
  const confirm = useConfirm();
  const [mode, setMode] = useState(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const target = characters.find((c) => c.id === targetId) ?? null;
  const worth = target ? bloodValueForTags(target.tags) : null;

  function open(next) {
    setMode(next);
    setTargetId("");
    setError(null);
  }

  function submit(reason) {
    setError(null);
    const name = target?.name ?? "them";
    const isFeed = mode === "feed";

    startTransition(async () => {
      const ok = await confirm({
        title: isFeed ? `Feed ${name} to the Lifeweb?` : `Draw ${name}'s blood?`,
        message: isFeed
          ? "This is not reversible by you. A GM will read your reason and decide whether they die."
          : `The Lifeweb gains ${worth?.amount ?? 0} and ${name} is left Drained.`,
        confirmLabel: isFeed ? "Feed them" : "Draw blood",
        cancelLabel: "Back out",
      });
      if (!ok) return;

      const res = isFeed
        ? await feedPersonRequest({ targetCharacterId: targetId, reason })
        : await donateBloodRequest({ targetCharacterId: targetId, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setMode(null);
    });
  }

  const spec = mode ? MODES[mode] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => open("donate")}>
          Donate Blood
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => open("feed")}
        >
          ☠ Feed Person
        </button>
      </div>

      <RequestDialog
        open={mode !== null}
        title={spec?.title ?? ""}
        submitLabel={spec?.submitLabel ?? "Confirm"}
        busy={pending}
        error={error}
        canSubmit={Boolean(targetId)}
        onCancel={() => !pending && setMode(null)}
        onConfirm={submit}
      >
        <label className="field">
          <span className="field-label">Who?</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
            <option value="" disabled>
              Choose a person…
            </option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {mode === "donate" && worth && (
          <p className="text-sm">
            Worth <span className="text-positive">{worth.amount}</span> to the Lifeweb
            {worth.tier ? (
              <span className="text-muted"> — {worth.tier} blood</span>
            ) : null}
          </p>
        )}

        <p className="text-xs text-muted">
          {spec?.hint}
        </p>
      </RequestDialog>
    </>
  );
}
