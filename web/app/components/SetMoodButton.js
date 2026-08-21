"use client";

import { useState, useTransition } from "react";
import RequestDialog from "./RequestDialog";
import { setMoodRequest } from "../(app)/character/requestActions";

const OPTIONS = [
  { value: "NEUTRAL", label: "Neutral — no effect" },
  { value: "HAPPY", label: "Happy — +1 to the die on Gambits" },
  { value: "UNHAPPY", label: "Unhappy — -1 to the die on Gambits" },
];

export default function SetMoodButton({ currentMood = "NEUTRAL" }) {
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState(currentMood);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(reason) {
    setError(null);
    startTransition(async () => {
      const res = await setMoodRequest({ mood, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn-quiet"
        onClick={() => {
          setMood(currentMood);
          setError(null);
          setOpen(true);
        }}
      >
        Set Mood
      </button>

      <RequestDialog
        open={open}
        title="Set Mood"
        submitLabel="Set Mood"
        busy={pending}
        error={error}
        onCancel={() => !pending && setOpen(false)}
        onConfirm={submit}
      >
        <label className="field">
          <span className="field-label">Mood</span>
          <select value={mood} onChange={(e) => setMood(e.target.value)}>
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">
          A mood lasts 2 turns and then wears off on its own.
        </p>
      </RequestDialog>
    </>
  );
}
