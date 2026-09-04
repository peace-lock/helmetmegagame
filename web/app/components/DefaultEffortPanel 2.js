"use client";

import Switch from "./Switch";
import { useState } from "react";
import { setDefaultEffort, deleteDefaultEffort } from "../(app)/character/actions";
import InfoIcon from "./InfoIcon";

export default function DefaultEffortPanel({ characterId, defaultEffort, zone }) {
  // A cave level owns only its forum channel, so it has no #summary to post
  // into — that is what makes this a channel check rather than a "do you have
  // a zone" one.
  const canShare = Boolean(zone?.discordSummaryChannelId);
  const [description, setDescription] = useState(defaultEffort?.description ?? "");
  const [labor, setLabor] = useState(defaultEffort?.labor ?? false);
  const [shareInSummary, setShareInSummary] = useState(defaultEffort?.shareInSummary ?? false);
  const [summaryMessage, setSummaryMessage] = useState(defaultEffort?.summaryMessage ?? "");
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const hasSaved = !!defaultEffort;

  async function handleSubmit(e) {
    e.preventDefault();
    if (pending || !description.trim() || (shareInSummary && !canShare)) return;
    setPending(true);
    setSaved(false);
    try {
      const formData = new FormData();
      formData.set("description", description);
      if (labor) formData.set("labor", "on");
      if (shareInSummary) formData.set("shareInSummary", "on");
      formData.set("summaryMessage", summaryMessage);
      await setDefaultEffort(characterId, formData);
      setSaved(true);
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (deleting || !hasSaved) return;
    setDeleting(true);
    try {
      await deleteDefaultEffort(characterId);
      setDescription("");
      setLabor(false);
      setShareInSummary(false);
      setSummaryMessage("");
      setSaved(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="panel p-4">
      <h2 className="panel-header panel-header--with-icon">
        Default Move
        <InfoIcon
          text={<p>You can set a default move (Routine) so that it&apos;s sent if you don&apos;t act on a given turn. Cannot be a Gambit.</p>}
        />
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">What your character does by default</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="John spends the turn watching his cows."
            required
          />
        </label>

        <Switch checked={labor} onChange={(e) => setLabor(e.target.checked)}>
          <span className="flex items-center gap-1.5">
            Labor
            <InfoIcon text="Applies your skills automatically to make Resources. Produces nothing while you're in the caves." />
          </span>
        </Switch>

        <Switch checked={shareInSummary} onChange={(e) => setShareInSummary(e.target.checked)}>
          Share in a summary channel?
        </Switch>

        {shareInSummary && (
          <>
            <div className="panel px-3 py-2 text-xs text-muted">
              Posts in: {canShare ? `#summary in ${zone.name}` : "Nowhere — this zone has no summary channel"}
            </div>
            <label className="field">
              <span className="field-label">Message posted there</span>
              <input
                value={summaryMessage}
                onChange={(e) => setSummaryMessage(e.target.value)}
                placeholder="Optional — leave blank to post nothing"
              />
            </label>
          </>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn self-start"
            disabled={pending || !description.trim() || (shareInSummary && !canShare)}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={!hasSaved || deleting || pending}
            onClick={handleDelete}
          >
            Delete
          </button>
          {saved && !pending ? (
            <span className="text-xs text-muted">
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
