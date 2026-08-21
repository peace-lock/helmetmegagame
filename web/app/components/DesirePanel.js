"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "./ConfirmProvider";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import { setDesire, cancelDesire, fulfillDesireRequest } from "../(app)/character/requestActions";

const DESIRE_HELP = (
  <>
    <p>Characters earn Tag Points by fulfilling Desires.</p>
    <p>The more difficult and personal the Desire, the more Tag Points you earn.</p>
    <p className="text-muted">
      Leaders can set Desires aligned with faction goals, like conquering territory. Everyone else is
      encouraged to find personally relevant ones — from having a nice meal to proving themselves in
      front of an audience.
    </p>
  </>
);

const POINTS_HELP = (
  <>
    <p>Set the amount of points you think this Desire is worth.</p>
    <p>1. Have a drink at the bar. Trivial.</p>
    <p>2. Convert the depressed bum to Christianity. Regular.</p>
    <p>3. Humiliate your rival in front of the court. Moderate.</p>
    <p>4. Break your comrade out of jail. Difficult.</p>
    <p>5. Win back your lover. Extraordinary.</p>
  </>
);

export default function DesirePanel({ desire, cooldownUntilTurn, openTurnNumber }) {
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [points, setPoints] = useState("1");
  const [fulfilling, setFulfilling] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const onCooldown =
    !desire && cooldownUntilTurn != null && openTurnNumber != null && openTurnNumber <= cooldownUntilTurn;

  async function submitNew(e) {
    e.preventDefault();
    setError(null);
    const ok = await confirm({
      title: "Set this Desire?",
      message:
        "Once set, cancelling or completing a Desire puts you on a one-turn cooldown before you can set another.",
      confirmLabel: "Set Desire",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await setDesire({ text, points });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setText("");
      setPoints("1");
    });
  }

  async function onCancel() {
    setError(null);
    const ok = await confirm({
      title: "Cancel this Desire?",
      message: "You won't be able to set another until next turn, and no points are awarded.",
      confirmLabel: "Cancel Desire",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await cancelDesire();
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
    });
  }

  function submitFulfill(reason) {
    setError(null);
    startTransition(async () => {
      const res = await fulfillDesireRequest({ reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setFulfilling(false);
    });
  }

  return (
    <section className="panel p-4">
      <h2 className="panel-header panel-header--with-icon">
        Desire
        <InfoIcon text={DESIRE_HELP} />
      </h2>

      {desire ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{desire.text}</p>
          <p className="text-sm text-muted">
            Worth {desire.points} Tag Point{desire.points === 1 ? "" : "s"}
            {desire.setTurnNumber != null ? ` — set on turn ${desire.setTurnNumber}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setFulfilling(true)} disabled={pending}>
              Fulfill
            </button>
            <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      ) : onCooldown ? (
        <p className="text-sm text-muted">
          You just ended a Desire — you can set a new one next turn.
        </p>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submitNew}>
          <label className="field">
            <span className="field-label">What does your character want?</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              required
              placeholder="Win back your lover…"
            />
          </label>
          <label className="field" style={{ width: "10rem" }}>
            <span className="field-label flex items-center gap-1.5">
              Tag Points
              <InfoIcon text={POINTS_HELP} />
            </span>
            <input
              type="number"
              min="1"
              max="5"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn self-start" disabled={pending || !text.trim()}>
            Set Desire
          </button>
        </form>
      )}

      {error && (
        <p className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}

      <RequestDialog
        open={fulfilling}
        title="Fulfill Desire"
        submitLabel="Fulfill"
        busy={pending}
        onCancel={() => !pending && setFulfilling(false)}
        onConfirm={submitFulfill}
      >
        <p className="text-sm">
          {desire?.text} — {desire?.points} Tag Point{desire?.points === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted">
          The points land immediately. Tell the GMs how you pulled it off.
        </p>
      </RequestDialog>
    </section>
  );
}
