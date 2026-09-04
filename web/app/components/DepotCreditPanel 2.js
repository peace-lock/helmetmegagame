"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotCredit } from "@/app/(app)/depot/actions";
import RequestDialog from "./RequestDialog";

// The Company's credit line. A meter, a Draw and a Repay — no interest, no
// schedule, no penalty. If he takes out 60 he owes 60, and the only thing that
// happens to a standing balance is that GMs can see it.
//
// Deliberately not a loan system: the loans that matter in this game are the
// ones he writes to other players, and those are a conversation plus an
// ordinary resource transfer. See docs/systemdocs/DEPOT.md §5.
export default function DepotCreditPanel({ debt, cap, available, resources, disabled }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState(null); // "DRAW" | "REPAY"
  const [amount, setAmount] = useState(1);
  const [error, setError] = useState(null);

  const drawing = mode === "DRAW";
  // Both clamped at 0: a GM correction on the Dev Panel can leave the tab
  // negative, and neither a negative repayment ceiling nor a negative bar
  // width ("width: -50%", which is simply invalid CSS) is a thing to render.
  const max = Math.max(0, drawing ? available : Math.min(debt, resources));
  const drawn = cap > 0 ? Math.max(0, Math.round((debt / cap) * 100)) : 0;

  function ask(next) {
    setMode(next);
    setAmount(1);
    setError(null);
  }

  function submit(reason) {
    startTransition(async () => {
      const result = await depotCredit({
        direction: mode,
        amount: Math.max(1, Math.min(max, amount)),
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode(null);
      refresh();
    });
  }

  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">Drawn</span>
        <span className="mono text-sm">
          {debt} / {cap} ⬢
        </span>
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
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, drawn)}%`,
            background: debt >= cap ? "var(--accent-text)" : "var(--text)",
          }}
        />
      </div>

      <p className="mt-3 text-sm text-muted">
        {debt === 0
          ? `The Company will advance you up to ${cap} ⬢ against the business. It is not a gift, and it is not a wage — invest it.`
          : `You owe the Company ${debt} ⬢, with ${available} ⬢ still available. Pay it back.`}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={disabled || pending || available < 1}
          onClick={() => ask("DRAW")}
        >
          Draw
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={disabled || pending || debt < 1 || resources < 1}
          onClick={() => ask("REPAY")}
        >
          Repay
        </button>
      </div>

      <RequestDialog
        open={Boolean(mode)}
        title={drawing ? "Draw on the credit line" : "Repay the Company"}
        submitLabel={drawing ? "Draw" : "Repay"}
        busy={pending}
        error={error}
        canSubmit={max >= 1}
        onCancel={() => setMode(null)}
        onConfirm={submit}
      >
        <label className="field">
          <span className="field-label">How many ⬢? (up to {max})</span>
          <input
            type="number"
            min={1}
            max={max}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
          />
        </label>
        <p className="text-sm text-muted">
          {drawing
            ? `You would owe ${debt + Math.min(max, amount)} ⬢.`
            : `You would owe ${debt - Math.min(max, amount)} ⬢.`}
        </p>
      </RequestDialog>
    </>
  );
}
