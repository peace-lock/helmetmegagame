// Antagonist seats are GM-assigned in secret and never appear in the role
// picker — they are deliberately absent from docs/roles.yaml and written up as
// prose in docs/threats.md instead. This list is consent data only: at creation
// a player says which of these they are open to being handed. Nothing reads it
// mechanically — no gate, no grant, no points, no faction — it exists so a GM
// choosing who receives a Succubus can tell who is willing.
//
// Kept in code rather than a table for the same reason as db/lib/roleIds.js:
// twelve fixed values that can never differ per environment, so a row would
// only add a join and a way to drift.
//
// Alphabetized by `name` here so catalog order *is* display order and nothing
// downstream has to sort.
const ANTAGONISTS = [
  { slug: "aberrant-emissary", name: "Aberrant Emissary" },
  { slug: "archon", name: "Archon" },
  { slug: "cultist", name: "Cultist" },
  { slug: "false-chaplain", name: "False Chaplain" },
  { slug: "judge", name: "Judge" },
  { slug: "neomorph", name: "Neomorph" },
  { slug: "obsessed", name: "Obsessed" },
  { slug: "phrygian-count", name: "Phrygian Count" },
  { slug: "schemer", name: "Schemer" },
  { slug: "special-circumstances", name: "Special Circumstances" },
  { slug: "succubus", name: "Succubus" },
  { slug: "warlock", name: "Warlock" },
];

const ANTAGONIST_SLUGS = new Set(ANTAGONISTS.map((a) => a.slug));

// Whatever the form posted, reduced to known slugs, deduped, in catalog order.
// The wizard's checkboxes are UX; this is the boundary that keeps junk out of
// the column, same posture as normalizeHonorific's allowlist.
function normalizeAntagonistSlugs(input) {
  const posted = new Set(
    (Array.isArray(input) ? input : [input])
      .filter((v) => v != null)
      .map((v) => v.toString().trim()),
  );
  return ANTAGONISTS.filter((a) => posted.has(a.slug)).map((a) => a.slug);
}

// Slugs -> display names, in catalog order. Unknown slugs are dropped rather
// than rendered raw, so a stale value can never leak into the UI.
function antagonistNames(slugs) {
  const held = new Set(slugs ?? []);
  return ANTAGONISTS.filter((a) => held.has(a.slug)).map((a) => a.name);
}

module.exports = {
  ANTAGONISTS,
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
};
