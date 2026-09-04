// Normalizes the "quiet adjustment" fields every GM Silo surface collects into
// the `{ hidden, cover }` pair db/lib/resourceTransfer.js#writeSiloRows takes.
//
// Four surfaces feed a Silo — the immediate Move ⬢ (FactionsPanel and the Dev
// Panel character page), the staged transfer on /gm/turns, and the Dev Panel's
// absolute "set the Silo to N" — and each collects the same three optional
// strings. This is the one place that trims them, so a quiet transfer looks the
// same in the ledger whichever door it came through.
//
// A cover row is display-only, so it is only ever attached to a hidden row: on
// its own it would be a plain lie about the balance rather than a lie about who
// moved it.
const MAX_COVER_NAME = 80;
const MAX_COVER_NOTE = 200;

function clean(raw, max) {
  const value = raw?.toString().trim() ?? "";
  return value ? value.slice(0, max) : "";
}

export function normalizeQuiet({ quiet, coverActorName, coverToName, coverNote } = {}) {
  if (!quiet) return { hidden: false, cover: null };

  const actorName = clean(coverActorName, MAX_COVER_NAME);
  const toName = clean(coverToName, MAX_COVER_NAME);
  const note = clean(coverNote, MAX_COVER_NOTE);

  // No "Shown as" means the GM wants a clean hide with no story at all: the
  // row simply never appears, and the Treasurer sees a balance that moved
  // without explanation.
  if (!actorName) return { hidden: true, cover: null };

  return { hidden: true, cover: { actorName, toName, note } };
}
