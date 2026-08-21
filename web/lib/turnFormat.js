// Pure turn-formatting helpers with no database dependency, kept separate
// from turn.js's getOpenTurn() so client components can import these
// without dragging the @lifeweb/db (Prisma) barrel into the browser bundle.

const WEATHER_LABELS = {
  CLEAR: "Clear",
  FOG: "Fog",
  RAIN: "Rain",
  STORM: "Storm",
  MIGRATION: "Migration",
};

export function describeTurn(turn) {
  if (!turn) return { day: null, phase: null, weather: null, label: "NO TURN OPEN" };
  const day = Math.ceil(turn.number / 2);
  const weatherLabel = WEATHER_LABELS[turn.weather] ?? turn.weather;
  return { day, phase: turn.phase, weather: turn.weather, label: `DAY ${day} · ${turn.phase} · ${weatherLabel}` };
}

// The themes globals.css defines. Both phase themes are underground darks;
// "limestone" is the light-theme backup and is deliberately NOT reachable from
// a phase — only via the LIFEWEB_THEME override below.
export const THEMES = ["dusk", "dawn", "limestone"];

export function themeForPhase(phase) {
  return phase === "DUSK" ? "dusk" : "dawn";
}

// Lets a whole environment be pinned to one theme regardless of the turn, so
// limestone can actually be looked at and compared side by side — without it
// there is no way to reach a theme that no phase maps to. Unset (the normal
// case) or unrecognised falls straight through to the phase theme, so a typo
// degrades to correct behaviour rather than an unstyled page.
export function resolveTheme(phase, override) {
  return THEMES.includes(override) ? override : themeForPhase(phase);
}

// "Turn 1, Dusk" — the raw sequential turn number (not the day/2 grouping
// describeTurn() computes), used in tables that list individual actions.
export function formatTurnLabel(turnNumber, phase) {
  if (turnNumber == null) return "-";
  if (!phase) return `Turn ${turnNumber}`;
  const phaseLabel = phase.charAt(0) + phase.slice(1).toLowerCase();
  return `Turn ${turnNumber}, ${phaseLabel}`;
}
