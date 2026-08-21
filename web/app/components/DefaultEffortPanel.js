"use client";

import { useState } from "react";
import { setDefaultEffort, deleteDefaultEffort } from "../(app)/character/actions";
import InfoIcon from "./InfoIcon";

export default function DefaultEffortPanel({ characterId, defaultEffort, location }) {
  const [description, setDescription] = useState(defaultEffort?.description ?? "");
  const [shareInSummary, setShareInSummary] = useState(defaultEffort?.shareInSummary ?? false);
  const [summaryMessage, setSummaryMessage] = useState(defaultEffort?.summaryMessage ?? "");
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const hasSaved = !!defaultEffort;

  async function handleSubmit(e) {
    e.preventDefault();
    if (pending || !description.trim() || (shareInSummary && !location)) return;
    setPending(true);
    setSaved(false);
    try {
      const formData = new FormData();
      formData.set("description", description);
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
          text={
            <>
              <p>If you don&apos;t submit a Move on a given day, this is assumed instead.</p>
              <p className="text-muted">
                Tip: add a Resource ⬢ amount like +3 or a dice roll like +1d6*3 anywhere in the
                text and it&apos;ll be applied automatically. It can be negative too — say a Cook
                spending Resources ⬢ on ingredients (-3).
              </p>
            </>
          }
        />
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">What your character does by default</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Tends the garden and keeps to themselves."
            required
          />
        </label>

        <label className="field flex-row items-center gap-2">
          <input
            type="checkbox"
            checked={shareInSummary}
            onChange={(e) => setShareInSummary(e.target.checked)}
          />
          <span className="field-label">Share in a summary channel?</span>
        </label>

        {shareInSummary && (
          <>
            <div className="panel px-3 py-2 text-xs text-muted">
              Current location: {location?.name ?? "None — set a location before this can post"}
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
            disabled={pending || !description.trim() || (shareInSummary && !location)}
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
