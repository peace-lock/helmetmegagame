import { moodFromTags, moodLabel, MOOD_SLUGS } from "@lifeweb/db/lib/mood";
import { gambitModifiers, formatGambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import SetMoodButton from "./SetMoodButton";
import TransferResourcesButton from "./TransferResourcesButton";

const MOOD_COLORS = { NEUTRAL: "var(--text)", HAPPY: "var(--positive)", UNHAPPY: "var(--accent)" };

// A labelled row, so Location / Resources / Mood line up on one grid instead
// of each being its own ad-hoc flex line.
function Row({ label, children }) {
  return (
    <>
      <dt className="field-label" style={{ alignSelf: "center" }}>
        {label}
      </dt>
      <dd className="m-0 flex flex-wrap items-center gap-2 text-sm">{children}</dd>
    </>
  );
}

export default function StatusPanel({ character, isSelf, openTurn, parties }) {
  const mood = moodFromTags(character.tags);

  // Mood's ±1 and Hunger's -1 stack additively into one number, and this is
  // the same module the bot rolls against (db/lib/gambitModifier.js) — so
  // what a player reads here is exactly what gets applied.
  const modifiers = gambitModifiers(character.tags);
  const total = modifiers.reduce((sum, m) => sum + m.value, 0);

  // Mood rides CharacterTag.expiresTurn (an absolute turn number), so the
  // countdown is just the gap to the open turn. Requires the CharacterTag
  // wrapper, not the bare Tag — see CharacterSheet#groupTagsByCategory.
  const moodTag = character.tags.find(
    (ct) => ct.tag.slug === MOOD_SLUGS.HAPPY || ct.tag.slug === MOOD_SLUGS.UNHAPPY,
  );
  const turnsLeft =
    moodTag?.expiresTurn != null && openTurn?.number != null
      ? Math.max(0, moodTag.expiresTurn - openTurn.number)
      : null;

  return (
    <section className="panel p-4">
      <h2 className="panel-header">Status</h2>

      <dl
        className="grid gap-x-4 gap-y-2"
        style={{ gridTemplateColumns: "auto minmax(0, 1fr)", margin: 0 }}
      >
        <Row label="Location">
          {character.zone?.name ?? "Unassigned"}
          {character.location?.name ? ` / ${character.location.name}` : ""}
        </Row>

        <Row label="Resources">{character.resources} ⬢</Row>

        <Row label="Mood">
          <span style={{ color: MOOD_COLORS[mood] }}>{moodLabel(mood)}</span>
          {turnsLeft != null && (
            <span className="text-default">
              ({turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left)
            </span>
          )}
          {isSelf && <SetMoodButton currentMood={mood} />}
        </Row>

        <Row label="Gambit">
          {modifiers.length ? (
            <span style={{ color: total < 0 ? "var(--accent)" : total > 0 ? "var(--positive)" : "var(--text)" }}>
              {total > 0 ? `+${total}` : total} to the die
            </span>
          ) : (
            <span className="text-muted">No modifier</span>
          )}
          {/* Spelled out only when more than one thing stacks — a lone Unhappy
              doesn't need "(−1 Unhappy)" next to "−1 to the die". */}
          {modifiers.length > 1 && (
            <span className="text-muted">({formatGambitModifiers(modifiers)})</span>
          )}
        </Row>

        <Row label="Tag Points">{character.tagPoints}</Row>
      </dl>

      {isSelf && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <TransferResourcesButton
            selfId={character.id}
            selfName={character.name}
            parties={parties ?? { characters: [], factions: [] }}
          />
        </div>
      )}
    </section>
  );
}
