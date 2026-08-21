"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { forceAdvanceTurn } from "./actions";

// The Dev Panel's "End turn" control. This is the only client component under
// /gm/dev — the rest of the panel is bare <form action={serverAction}> — and it
// exists for three reasons the plain form couldn't cover:
//
//   1. A pending server action blocks client-side navigation, so without a
//      visible pending state a slow advance reads as the whole app freezing.
//   2. forceAdvanceTurn now returns { ok, error } rather than throwing into a
//      non-existent error.js, so something has to render the error.
//   3. Ending a turn resolves Needs and, on a Dawn turn, wipes every Location
//      channel — a confirm belongs in front of it.
export default function EndTurnButton({ turnLabel, wipesMessages }) {
  const confirm = useConfirm();
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  async function onClick() {
    const ok = await confirm({
      title: turnLabel ? `End ${turnLabel}?` : "End the current turn?",
      message: [
        "This resolves Needs on the open turn — tag expiry, the Hunger upkeep, and the Lifeweb's blood decay — then opens the next one.",
        wipesMessages ? "The next turn is a Dawn, so every Location channel gets archived and wiped." : null,
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: "End the turn",
      cancelLabel: "Leave it open",
    });
    if (!ok) return;

    setError(null);
    startTransition(async () => {
      // forceAdvanceTurn catches its own failures, but its authorization check
      // runs before that try block and a transport error can reject too — with
      // no error.js to land on, an unhandled rejection here would take the
      // panel down.
      try {
        const res = await forceAdvanceTurn();
        if (!res?.ok) setError(res?.error ?? "Something went wrong.");
      } catch {
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div>
        <button type="button" className="btn" onClick={onClick} disabled={pending}>
          {pending ? "Ending turn…" : "End turn"}
        </button>
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--accent)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
