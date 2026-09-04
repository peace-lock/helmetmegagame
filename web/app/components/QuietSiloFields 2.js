import CheckField from "@/app/components/CheckField";

// The "quiet adjustment" block every GM Silo surface shares: the immediate
// Move ⬢ on /gm/players and the Dev Panel character page, the staged transfer
// on /gm/turns, and /gm/dev/factions' absolute "set the Silo to N".
//
// Why it exists: a Silo row is visible to the faction's own Leader and
// Treasurer, so adjudicating a secret move out of a Silo — a gambit steal —
// used to announce itself to the victim. Ticking this hides the real row from
// them and puts whatever is typed below in its place, at the same amount, so
// their history still adds up. GM surfaces and /gm/audit always show the truth.
//
// Deliberately NOT "use client", same reasoning as CheckField: /gm/dev/factions
// posts through a server form action reading `name`, while the three dialogs
// are client components passing `value`/`onChange`. Uncontrolled (a bare form)
// works because every field carries a `name` and the defaults are empty.
export default function QuietSiloFields({ value = null, onChange = null, disabled = false }) {
  const controlled = value != null && onChange != null;
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-3">
      <CheckField
        name="siloQuiet"
        disabled={disabled}
        {...(controlled
          ? { checked: !!value.quiet, onChange: (e) => onChange({ ...value, quiet: e.target.checked }) }
          : {})}
      >
        Quiet adjustment — hide the real row from this faction&apos;s Leader and Treasurer ‡
      </CheckField>

      {(!controlled || value.quiet) && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            What they see instead. Leave &ldquo;Shown as&rdquo; empty to leave no row at all — the balance
            still moves, so they get a gap they can&apos;t explain. ‡
          </p>
          <label className="field">
            <span className="field-label">Shown as</span>
            <input
              type="text"
              name="siloCoverActorName"
              maxLength={80}
              placeholder="Losses"
              disabled={disabled}
              {...(controlled ? { value: value.coverActorName, onChange: set("coverActorName") } : {})}
            />
          </label>
          <label className="field">
            <span className="field-label">Shown to</span>
            <input
              type="text"
              name="siloCoverToName"
              maxLength={80}
              placeholder="(nobody)"
              disabled={disabled}
              {...(controlled ? { value: value.coverToName, onChange: set("coverToName") } : {})}
            />
          </label>
          <label className="field">
            <span className="field-label">Shown note</span>
            <input
              type="text"
              name="siloCoverNote"
              maxLength={200}
              placeholder="Spoilage in the store room"
              disabled={disabled}
              {...(controlled ? { value: value.coverNote, onChange: set("coverNote") } : {})}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export const EMPTY_QUIET = { quiet: false, coverActorName: "", coverToName: "", coverNote: "" };
