"use client";

import { useMemo, useState } from "react";
import { createCharacter } from "./createActions";
import PointBuy from "../../components/PointBuy";
import {
  computeBudget,
  formatCost,
  costColor,
  tagsById as buildTagsById,
  effectiveTotalCost,
  effectiveCost,
} from "@/lib/characterCreation";

const STEPS = ["Identity", "Role", "Tags", "Confirm"];

function StepBar({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className="chip"
          aria-current={i === step ? "step" : undefined}
          style={{
            color: i === step ? "var(--text)" : "var(--muted)",
            borderColor: i === step ? "var(--accent)" : undefined,
          }}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function RoleCard({ role, cap, taken, selected, disabled, onSelect }) {
  const full = taken >= cap;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(role.id)}
      aria-pressed={selected}
      className="panel flex w-full flex-col gap-1 p-3 text-left"
      style={{
        outline: selected ? "1px solid var(--accent)" : undefined,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>
          {role.name}
          {role.grantsLeader && <span title="Leader"> ★</span>}
        </strong>
        <span className="text-sm" style={{ color: full ? "var(--accent)" : "var(--muted)" }}>
          {taken}/{cap === null ? "∞" : cap}
        </span>
      </span>
      {role.intro && (
        <span className="text-sm text-muted">
          {role.intro}
        </span>
      )}
      <span className="flex flex-wrap gap-2 text-xs text-muted">
        {role.difficulty && <span className="chip">{role.difficulty}</span>}
        {role.startingLocationName && <span className="chip">{role.startingLocationName}</span>}
        {role.extraStartingPoints > 0 && (
          <span className="chip text-positive">
            +{role.extraStartingPoints} pts
          </span>
        )}
      </span>
    </button>
  );
}

export default function CreateCharacterWizard({ zones, tags, startingTagPoints, playerCount, cursed }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [preferredNickname, setPreferredNickname] = useState("");
  const [roleId, setRoleId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const allRoles = useMemo(
    () => zones.flatMap((z) => z.factions.flatMap((f) => f.roles)),
    [zones],
  );
  const role = allRoles.find((r) => r.id === roleId) ?? null;

  const byId = useMemo(() => buildTagsById(tags), [tags]);
  const budget = computeBudget({ startingTagPoints, role, cursed });
  const selectedTags = tags.filter((t) => selectedIds.includes(t.id));
  const remaining = budget - effectiveTotalCost(selectedTags, byId);
  const grantedTags = useMemo(
    () => (role ? tags.filter((t) => role.startingTagNames.includes(t.name)) : []),
    [role, tags],
  );
  const grantedIds = useMemo(() => grantedTags.map((t) => t.id), [grantedTags]);

  // Switching roles changes the budget and what's already granted, so a
  // carried-over selection could silently be over budget or duplicate a
  // starting tag. Clearing is the honest reset.
  function pickRole(id) {
    setRoleId(id);
    setSelectedIds([]);
  }

  const canAdvance =
    (step === 0 && name.trim().length > 0) ||
    (step === 1 && role !== null) ||
    (step === 2 && remaining >= 0) ||
    step === 3;

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    if (preferredNickname.trim()) fd.set("preferredNickname", preferredNickname.trim());
    fd.set("roleId", roleId);
    for (const id of selectedIds) fd.append("tagIds", id);
    // A successful create redirects, so anything returned here is an error.
    const result = await createCharacter(fd);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Create Your Character</h1>
      <StepBar step={step} />

      {cursed && (
        <p className="panel p-3 text-sm text-accent">
          You&apos;re <strong>Cursed</strong>! You can only be a Bum or a Migrant, and you suffer -3 to
          starting points. Wait until someone buries your body.
        </p>
      )}

      {error && (
        <p className="panel p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {step === 0 && (
        <div className="panel flex flex-col gap-4 p-4">
          <label className="field">
            <span className="field-label">Character name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Preferred nickname (optional)</span>
            <input
              value={preferredNickname}
              onChange={(e) => setPreferredNickname(e.target.value)}
              placeholder="Shown before your character name in Discord"
              maxLength={32}
            />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-6">
          {zones.map((zone) => (
            <section key={zone.id} className="flex flex-col gap-3">
              <h2 className="panel-header">{zone.name}</h2>
              {zone.factions.map((faction) => (
                <div key={faction.id} className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-muted">
                    {faction.name}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {faction.roles.map((r) => (
                      <RoleCard
                        key={r.id}
                        role={r}
                        cap={r.cap}
                        taken={r.taken}
                        selected={r.id === roleId}
                        disabled={!r.selectable || (r.cap !== null && r.taken >= r.cap)}
                        onSelect={pickRole}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {step === 2 && role && (
        <div className="flex flex-col gap-4">
          <div className="panel flex flex-col gap-2 p-3 text-sm">
            <span>
              <strong>{role.name}</strong>
              <span className="text-muted"> — {role.factionName}</span>
            </span>
            {grantedTags.length > 0 && (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Granted free:</span>
                {grantedTags.map((t) => (
                  <span key={t.id} className="chip">
                    {t.name}
                  </span>
                ))}
              </span>
            )}
          </div>
          <PointBuy
            tags={tags}
            budget={budget}
            grantedTags={grantedTags}
            afterStartOnly={false}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        </div>
      )}

      {step === 3 && role && (
        <div className="panel flex flex-col gap-3 p-4">
          <h2 className="panel-header">{name}</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Role</dt>
              <dd>{role.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Faction</dt>
              <dd>{role.factionName}</dd>
            </div>
            <div>
              <dt className="text-muted">Starts at</dt>
              <dd>{role.startingLocationName ?? "Nowhere yet"}</dd>
            </div>
            <div>
              <dt className="text-muted">Resources</dt>
              <dd>{role.startingResources} ⬢</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Tags:</span>
            {[...grantedTags, ...selectedTags].map((t) => (
              <span key={t.id} className="chip">
                {t.name}
                {selectedIds.includes(t.id) &&
                  (() => {
                    const cost = effectiveCost(t, byId, grantedIds);
                    return <span style={{ color: costColor(cost) }}> {formatCost(cost)}</span>;
                  })()}
              </span>
            ))}
            {grantedTags.length + selectedTags.length === 0 && (
              <span className="text-muted">none</span>
            )}
          </div>
          <p className="text-sm text-muted">
            {remaining} unspent point{remaining === 1 ? "" : "s"} will carry over to your character.
          </p>
          {role.grantsLeader && (
            <p className="text-sm">You will start as your faction&apos;s <strong>Leader</strong>.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-quiet"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || pending}
        >
          Back
        </button>
        {step < 3 ? (
          <button
            type="button"
            className="btn"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance}
          >
            Next
          </button>
        ) : (
          <button type="button" className="btn" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Begin"}
          </button>
        )}
      </div>
    </div>
  );
}
