"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  sortTagsForMenu,
  sortForMode,
  menuCategories,
  formatCost,
  costColor,
  filterTagsByQuery,
  tagsById as buildTagsById,
  heldHigherTiers,
  prerequisiteNames,
  hasPrerequisite,
} from "@/lib/characterCreation";
import {
  craftableTags,
  destroyableTags,
  transferableTags,
  packableTags,
  consumableTags,
  addRequirementSatisfied,
  placementOfferedHere,
} from "@/lib/tagRequests";
import RequestDialog from "./RequestDialog";
import CheckField from "./CheckField";
import PartySelect from "./PartySelect";
import TransferDialog from "./TransferDialog";
import CraftDialog from "./CraftDialog";
import { titleFor } from "./actionRegistry";
import Select from "./Select";
import ChipText from "./ChipText";
import ExamineDialog from "./ExamineDialog";
import QuantityField from "./QuantityField";
import { ENGRAVE_RESOURCE_COST } from "@/lib/constants";
import { useConfirm } from "./ConfirmProvider";
import { useTags } from "./TagsProvider";
import { heldSlugsOf } from "@/lib/consumeGrants";
import { scoreMatch } from "@/lib/fuzzySearch";
import {
  craftRequest,
  continueCraft,
  cancelCraft,
  joinBuildSite,
  cancelBuildSite,
  destroyTagRequest,
  learnRequest,
  teachRequest,
  transferRequest,
  consumeTagRequest,
  healCharacterRequest,
  lootCharacterRequest,
  moveCharacterRequest,
  bindCharacterRequest,
  freeCharacterRequest,
  harmCharacterRequest,
  buryCharacterRequest,
  butcherCorpseRequest,
  engraveHeadstoneRequest,
  birdMessageRequest,
  extractGodfleshRequest,
  packageItemsRequest,
} from "../(app)/character/requestActions";
// Writing and sealing file no Request, so they live apart from the rest —
// see web/app/(app)/character/paperActions.js.
import { writePaper, sealLetter, readMyPaper } from "../(app)/character/paperActions";
// Safe from a client component: db/lib/constants.js is a leaf of bare strings
// and numbers with no requires at all, so importing it drags no part of the
// @lifeweb/db barrel into the bundle.
import { PACKAGE_MAX_LBS, PACKAGE_LABEL_MAX } from "@lifeweb/db/lib/constants";

// Every player action on the character sheet: mode state, the menus each
// mode draws from, and one RequestDialog per mode. Renders no chrome of its
// own — mounted once per sheet (CharacterSheet.js, self mode only), read
// off context by ActionGrid.js and TagsPanel.js.

const RequestActionsContext = createContext(null);

export function useRequestActions() {
  return useContext(RequestActionsContext);
}

// The tag menu. Craft reuses PointBuy's category-tab layout without
// PointBuy's budget/tier-chain math. `byId`/`heldIds` (Craft menu only) gate
// prerequisites; the other menus just list what's already held.
function TagPicker({
  tags,
  selectedId,
  onSelect,
  byId = null,
  heldIds = null,
  emptyLabel = "Nothing available.",
}) {
  const [query, setQuery] = useState("");

  // The Craft menu (byId set) sorts chain-aware so tier rungs read in order;
  // held-tag menus keep flat cost-then-name sort.
  const offered = useMemo(
    () => (byId ? sortForMode(tags, "group", byId) : sortTagsForMenu(tags)),
    [tags, byId],
  );
  // Gate first, derive tabs from what survives — a hidden category gets no
  // tab at all. Craft-gate only (recipe skills were already checked server-
  // side — the page hands down `knownRecipeIds`); not requirementSatisfied().
  const unlocked = useMemo(
    () =>
      byId
        ? offered.filter((t) => addRequirementSatisfied(t, byId, heldIds ?? []))
        : offered,
    [offered, byId, heldIds],
  );
  // "Unlocked by your tags": everything shown already passed the gates.
  const [requiresOnly, setRequiresOnly] = useState(false);
  const gated = useMemo(
    () => (byId && requiresOnly ? unlocked.filter(hasPrerequisite) : unlocked),
    [unlocked, byId, requiresOnly],
  );
  const pool = useMemo(() => filterTagsByQuery(gated, query), [gated, query]);
  const categories = useMemo(() => menuCategories(pool), [pool]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];
  const visible = pool.filter((t) => t.category === active);

  if (!unlocked.length)
    return <p className="text-sm text-muted">{emptyLabel}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field min-w-40 flex-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, description, or group"
          />
        </label>
        {byId && (
          <CheckField
            checked={requiresOnly}
            onChange={(e) => setRequiresOnly(e.target.checked)}
            className="pb-2"
          >
            Unlocked by your tags
          </CheckField>
        )}
      </div>

      {categories.length > 1 && (
        <div className="tab-bar">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className="tab-item"
              data-active={c === active}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* The pane scrolls itself rather than growing the dialog, so the
          reason field and the Confirm button stay reachable however long
          Items gets — the same treatment PointBuy.js gives its own catalog. */}
      <div
        className="flex flex-col gap-2 overflow-y-auto pr-1"
        style={{ maxHeight: "60vh" }}
      >
        {visible.map((tag) => {
          const isSelected = tag.id === selectedId;
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className="select-card panel flex w-full items-start gap-3 p-3 text-left"
              style={{
                borderLeftColor: tag.group?.color ?? undefined,
                borderLeftWidth: tag.group?.color ? 3 : undefined,
              }}
            >
              <span aria-hidden="true">{isSelected ? "◆" : "◇"}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-bold">{tag.name}</span>
                  {tag.pointCost ? (
                    <span
                      className="text-xs"
                      style={{ color: costColor(tag.pointCost) }}
                    >
                      {formatCost(tag.pointCost)} pts
                    </span>
                  ) : null}
                  {tag.group?.name ? (
                    <span className="text-xs text-muted">{tag.group.name}</span>
                  ) : null}
                </span>
                {/* ChipText rather than RichText — the row is a <button>, so a
                    hoverable chip inside it would nest one button in another. */}
                {tag.description && (
                  <ChipText
                    text={tag.description}
                    as="span"
                    className="mt-1 block text-xs text-muted"
                  />
                )}
                {/* The gate that unlocked this row — role/faction kit would
                    otherwise be indistinguishable from the open catalog.
                    Only qualifying viewers ever see the row. */}
                {prerequisiteNames(tag).length > 0 && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    Requires: {prerequisiteNames(tag).join(", ")}
                  </span>
                )}
                {/* The recipe: what it costs and what it needs. Everything
                    listed already passed the skill check server-side, so
                    this is the price tag, not a warning. Craft menu only. */}
                {byId && tag.craftable && (
                  <span className="mt-1 block text-xs" style={{ color: "var(--accent-text)" }}>
                    {[
                      `${tag.requirementTurns ?? 1} ${(tag.requirementTurns ?? 1) === 1 ? "turn" : "turns"}`,
                      `${tag.requirementResources ?? 0} ⬢`,
                      ...((tag.requirementSkills ?? []).length
                        ? [tag.requirementSkills.map((s) => s.name).join(", ")]
                        : []),
                    ].join(" · ")}{" "}
                    ‡
                  </span>
                )}
                {/* A placement is raised on the ground rather than handed
                    over, so the row says where it ends up before the recipe
                    line's turns and ⬢ are read as a pocketable thing. */}
                {byId && tag.placement && (
                  <span className="mt-1 block text-xs text-muted">
                    Built where you stand ‡
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-muted">
            {query
              ? "Nothing matches that."
              : "Nothing available in this category."}
          </p>
        )}
      </div>
    </div>
  );
}

// "Nobody qualifies" line — never used to hide the action itself; see
// ActionGrid.js on why a greyed button would be its own leak.
// A corpse is identified by its tag AND where it stands: the same Nekker
// Corpse row can be lying in two different rooms, and picking "that one" has
// to mean one of them.
function corpseIdOf(corpse) {
  return `${corpse.tagId}@${corpse.sourceKey}`;
}

// What butchering this one gives you, previewed before you commit. Client-side
// off the shared MONSTER_YIELDS map, which is why db/lib/corpses.js keeps its
// pure exports free of prisma — importing anything prisma-shaped into a
// "use client" module drags the barrel into the browser bundle.
function yieldLabel(corpse) {
  return CORPSE_YIELD_NAMES[corpse.yieldSlug] ?? "something";
}

// Display names for the four yields, kept here rather than fetched: the
// dialog needs a word, not a catalog row.
const CORPSE_YIELD_NAMES = {
  "nekker-pheromones": "Nekker Pheromones",
  "graga-sac": "a Graga Sac",
  "skinless-brain": "a Skinless Brain",
  "human-flesh": "Human Flesh",
};

function NobodyHere({ children }) {
  return <p className="text-sm text-muted">{children}</p>;
}

// Maps a "kind:id" party key back to a name for the confirm prompt.
function payerLabel(parties, key) {
  const [kind, id] = (key ?? "").split(":");
  const pool = kind === "room" ? parties?.rooms : parties?.characters;
  return pool?.find((p) => p.id === id)?.name ?? "They";
}

// The modes that are not Requests at all, and so never open RequestDialog.
// Each has its own modal below.
// Look at is the one mode that files no Request AND gets its own plain modal
// — a local dialog with nothing to review and nothing to undo. Write and Seal
// file no Request either, but they DO belong in the shared dialog: they have
// real fields, and reasonRequired={false} is what drops the reason box.
const NO_REQUEST_MODES = new Set(["examine"]);

// Nothing to adjudicate, so nothing to justify. The letter itself is the
// record a GM reads (docs/systemdocs/PAPERWORK.md).
const NO_REASON_MODES = new Set(["bird", "write", "seal"]);

// Mirrors WRITE_MAX in web/app/(app)/character/paperActions.js, which is the
// real gate — this only stops the counter and the box promising more than the
// server will take.
const WRITE_MAX = 2000;

// Why a person is lootable: living cases come from INCAPACITATING_SLUGS
// (db/lib/incapacitation.js); a corpse says so plainly.
function targetNote(t) {
  if (t.status === "DEAD") return "Dead";
  return t.condition ?? "Helpless";
}

export default function RequestActionsProvider({
  children,
  // False on someone else's sheet — hooks still run unconditionally, but no
  // context/dialog is handed down, so TagsPanel's chips stay read-only.
  enabled = true,
  selfId,
  selfName,
  catalog = [],
  characterTags = [],
  resources = 0,
  transferParties = null,
  // Your faction's silo, when there is one and you are in its zone: a
  // deposit-only destination the Transfer dialog pins above the rooms here
  // (FACTIONS.md). Null the rest of the time.
  transferSilo = null,
  // Load vs caps for the Transfer dialog's projection line (CARRY.md).
  carry = null,
  // Why this character's eyes cannot look anyone over right now, or null.
  // Resolved server-side in character/page.js (db/lib/examineVision.js) —
  // examineActions.js refuses with the same sentence.
  examineBlocked = null,
  hasWorkshop = false,
  canHeal = false,
  healsLeft = null,
  healTargets = [],
  // Who can pay for a treatment or a craft: you, anyone here, rooms here.
  healParties = null,
  // Craft (CRAFTING.md): the recipe ids whose skills you hold, decided
  // server-side, and your projects in progress.
  knownRecipeIds = [],
  craftProjects = [],
  // Building (db/lib/structures.js). `sitesHere` is every structure at this
  // Location, all statuses; `buildable` is whether the ground takes anything
  // new at all. Both decided server-side in character/page.js, and both are
  // menu hygiene — openBuildSiteImpl re-checks each refusal.
  sitesHere = [],
  buildable = false,
  // Lessons (LESSONS.md): who could teach you what, and whom you could teach.
  canTeach = false,
  teachers = [],
  learners = [],
  // Whether a Move is already filed this turn — a craft with turns needs one.
  hasMoved = false,
  // Built once in character/page.js so the four target menus can't disagree.
  lootTargets = [],
  moveTargets = [],
  moveLocations = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  // Corpses (CORPSES.md): every body in reach — yours and the ones lying in
  // rooms here — built once server-side by db/lib/corpses.js#corpsesInReach so
  // the menu and the two server re-checks can't disagree about what you can
  // touch. canButcher is just "do you hold the Butcher tag".
  corpses = [],
  canButcher = false,
  // The Bird. birdTargets is EVERY character, alive or dead, on purpose.
  hasBird = false,
  birdSentToday = false,
  birdTargets = [],
  birdZones = [],
  // Paperwork (docs/systemdocs/PAPERWORK.md). `canRead` is letters AND eyes,
  // resolved server-side so the button, the tag chip and the action's own
  // refusal all say the same thing. The option lists carry an EXCERPT rather
  // than the whole text, and only for a reader — the full text is fetched on
  // demand so an unreadable sheet never sits in the page source.
  canRead = false,
  canWrite = false,
  hasSeal = false,
  canSeal = false,
  paperOptions = [],
  // Everything the bird could carry: written notes AND sealed letters. A
  // courier does not have to be able to read what they are carrying, so this
  // is not gated on literacy — only the excerpts inside it are.
  letterOptions = [],
  sealOptions = { stamps: [], letters: [] },
  // The Godard Factory (docs/systemdocs/FACTORY.md). All three are facts about
  // where this character is standing and what is in their hands, resolved
  // server-side in character/page.js — the actions re-check every one.
  canSeeExtract = false,
  canExtract = false,
  extractBlocked = null,
  canSeePackage = false,
}) {
  const [mode, setMode] = useState(null);
  const [tagId, setTagId] = useState(null);
  const [quantity, setQuantity] = useState("1");
  // Craft: a project in progress, and what to do with it.
  const [projectId, setProjectId] = useState("");
  // A build site standing here, picked from the same dropdown as a project.
  const [siteId, setSiteId] = useState("");
  const [projectChoice, setProjectChoice] = useState("continue");
  const [recipient, setRecipient] = useState("");
  const [patientId, setPatientId] = useState("");
  const [payerKey, setPayerKey] = useState("");
  const [targetId, setTargetId] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [amount, setAmount] = useState("1");
  // tagId -> quantity, for Loot. Always replaced wholesale, never mutated
  // (react-hooks/immutability is an error here).
  const [picks, setPicks] = useState({});
  // The Bird's guessed zone.
  const [zoneId, setZoneId] = useState("");
  // Move Player's destination.
  const [locationId, setLocationId] = useState("");
  const [lethal, setLethal] = useState(false);
  // Engrave types its target instead of picking it — a dropdown would be a
  // list of the dead, and this one searches every zone (REQUESTS.md §5d).
  // This input used to belong to Bury, which now picks a corpse instead.
  const [engraveName, setEngraveName] = useState("");
  // Butcher and Bury both act on one corpse, identified by BOTH its tag and
  // where it is standing — the same body can be in two places for two people.
  const [corpseKey, setCorpseKey] = useState("");
  // Package: what goes in the crate, and the line printed on its side.
  // tagId -> quantity, replaced wholesale like `picks` above.
  const [packed, setPacked] = useState({});
  const [crateLabel, setCrateLabel] = useState("");
  const [birdBody, setBirdBody] = useState("");
  const [birdQuery, setBirdQuery] = useState("");
  // Which letter the bird carries. The Bird no longer holds text of its own —
  // it delivers a paper you are holding (docs/systemdocs/PAPERWORK.md).
  const [birdTagId, setBirdTagId] = useState("");
  // Write: which sheet, and what is being added to it. `paperExisting` is what
  // is already on it, fetched when the sheet is chosen so it can be shown
  // read-only above the box — writing only ever appends.
  const [paperId, setPaperId] = useState("");
  const [paperBody, setPaperBody] = useState("");
  const [paperExisting, setPaperExisting] = useState(null);
  // Seal: which stamp, which letter.
  const [stampId, setStampId] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const heldIds = useMemo(
    () => characterTags.map((ct) => ct.tagId),
    [characterTags],
  );
  // The catalog excludes gate-opening tags (Demoness). Fold in
  // held tags too, or a chain walk from a held gate tag dead-ends.
  const gateById = useMemo(
    () =>
      buildTagsById([
        ...catalog,
        ...characterTags.map((ct) => ct.tag).filter(Boolean),
      ]),
    [catalog, characterTags],
  );
  // heldHigherTiers hides rungs below a held chain tier — craftRequest
  // rejects the same thing server-side.
  // A site is only joinable while it is going up; the rest of sitesHere is
  // for the standing-here panel.
  const buildSites = useMemo(
    () => sitesHere.filter((s) => s.status === "UNDER_CONSTRUCTION"),
    [sitesHere],
  );
  const craftable = useMemo(
    () =>
      craftableTags(catalog, heldIds, knownRecipeIds)
        .filter((t) => heldHigherTiers(t, gateById, heldIds).length === 0)
        // A placement you could not raise on this ground is dropped rather
        // than offered and refused.
        .filter((t) => placementOfferedHere(t, { buildable, sites: sitesHere })),
    [catalog, heldIds, knownRecipeIds, gateById, buildable, sitesHere],
  );
  const removable = useMemo(
    () => destroyableTags(characterTags),
    [characterTags],
  );
  const transferable = useMemo(
    () => transferableTags(characterTags),
    [characterTags],
  );
  const consumable = useMemo(
    () => consumableTags(characterTags),
    [characterTags],
  );
  const packable = useMemo(() => packableTags(characterTags), [characterTags]);
  // What the current selection weighs, against the 150 lb a crate holds. The
  // server recomputes it — this is the readout that stops somebody filling a
  // form they can't submit.
  const packedLbs = useMemo(
    () =>
      Object.entries(packed).reduce((sum, [id, q]) => {
        const row = packable.find((t) => t.id === id);
        // QuantityField keeps its value as a STRING, and a half-typed box is
        // "" — Number("") is 0, which is the right answer for a blank one.
        return sum + (row?.weightLbs ?? 0) * (Number(q) || 0);
      }, 0),
    [packed, packable],
  );

  // Heal's menus are per-patient, not per-tag, so they sit outside `chosen`
  // — an affliction row is server-built, not a catalog Tag.
  const patient = useMemo(
    () => healTargets.find((t) => t.id === patientId) ?? null,
    [healTargets, patientId],
  );
  const affliction = useMemo(
    () => patient?.healable.find((h) => h.tagId === tagId) ?? null,
    [patient, tagId],
  );
  const lootTarget = useMemo(
    () => lootTargets.find((t) => t.id === targetId) ?? null,
    [lootTargets, targetId],
  );
  // Bind and Free share one roster, split on who is already tied up.
  const bindable = useMemo(
    () => bindTargets.filter((t) => (mode === "bind" ? !t.bound : t.bound)),
    [bindTargets, mode],
  );

  const chosen = useMemo(() => {
    // heal/harm/learn/teach's tagId isn't a tag this character holds, so
    // they opt out.
    const pool =
      mode === "craft"
        ? craftable
        : mode === "destroy"
          ? removable
          : mode === "consume"
            ? consumable
            : mode === "heal" || mode === "harm" || mode === "learn" || mode === "teach"
              ? []
              : transferable;
    return pool.find((t) => t.id === tagId) ?? null;
  }, [mode, tagId, craftable, removable, transferable, consumable]);
  // Consume always takes one, so it opts out of the quantity field. So does a
  // placement: a structure is a place, not a stack, and openBuildSiteImpl
  // ignores the count anyway.
  const stacking =
    Boolean(chosen?.stackable) && mode !== "consume" && !chosen?.placement;
  const heldCount = mode === "craft" ? undefined : (chosen?.quantity ?? 1);

  // Lessons: the counterpart picked, and the skills on offer with them.
  const lessonPeople = mode === "teach" ? learners : teachers;
  const lessonPartner = useMemo(
    () => lessonPeople.find((p) => p.id === targetId) ?? null,
    [lessonPeople, targetId],
  );

  // Slug -> name for "Becomes:". A consumesIntoOneOf position isn't resolved
  // via resolveConsumeGrants here (that rolls a real pick); rendered as
  // "A or B" off the raw sidecar instead, so the preview stays honest.
  const { tagsBySlug } = useTags();
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);

  // Bird recipients filtered by typed text — dead stay in it; current pick kept.
  const birdChoices = useMemo(() => {
    const q = birdQuery.trim();
    if (!q) return birdTargets;
    return birdTargets.filter(
      (t) => t.id === targetId || scoreMatch(q, { name: t.name }),
    );
  }, [birdTargets, birdQuery, targetId]);
  const nameOf = (slug) => tagsBySlug.get(slug)?.name ?? slug;
  const becomes = (chosen?.consumesInto ?? [])
    .map((slug, i) => {
      const blockers = chosen?.consumesIntoUnless?.[slug] ?? null;
      if (blockers?.some((b) => heldSlugs.has(b))) return null;
      const alternatives = chosen?.consumesIntoOneOf?.[i];
      return Array.isArray(alternatives)
        ? alternatives.map(nameOf).join(" or ")
        : nameOf(slug);
    })
    .filter(Boolean);

  function pick(nextTagId) {
    setTagId(nextTagId);
    setQuantity("1");
  }

  // Loot takes a mix, so its picks are a checkbox set rather than one choice.
  function togglePick(id, held) {
    setPicks((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = String(Math.min(1, held) || 1);
      return next;
    });
  }
  function setPickQuantity(id, value) {
    setPicks((prev) => ({ ...prev, [id]: value }));
  }
  // Package's selection, same shape as `picks` above and for the same reason.
  function togglePacked(id, held) {
    setPacked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = String(Math.min(1, held) || 1);
      return next;
    });
  }
  function setPackedQuantity(id, value) {
    setPacked((prev) => ({ ...prev, [id]: value }));
  }

  // `presetTagId` lets a sheet-chip click open this dialog pre-selected.
  const open = useCallback(
    (next, presetTagId = null) => {
      setMode(next);
      setTagId(presetTagId);
      setQuantity("1");
      setProjectId("");
      setSiteId("");
      setProjectChoice("continue");
      setRecipient("");
      setPatientId("");
      setPayerKey(selfId ? `character:${selfId}` : "");
      setTargetId("");
      setFromKey(selfId ? `character:${selfId}` : "");
      setToKey("");
      // Transfer's ⬢ is optional, so it starts at nothing rather than one.
      setAmount(next === "transfer" ? "0" : "1");
      setPicks({});
      setPacked({});
      setCrateLabel("");
      setZoneId("");
      setLocationId("");
      setLethal(false);
      setEngraveName("");
      setCorpseKey("");
      setBirdBody("");
      setBirdQuery("");
      setBirdTagId("");
      setPaperId("");
      setPaperBody("");
      setPaperExisting(null);
      setStampId("");
      setError(null);
    },
    [selfId],
  );

  // Picking a sheet in the Write dialog fetches what is already on it, so the
  // box can show it read-only above the cursor. Fetched on demand rather than
  // shipped with the page: an unreadable sheet must never have its text
  // sitting in the page source where a blind or illiterate holder could read
  // it straight out of DevTools. The server re-checks the same gate.
  const choosePaper = useCallback((nextId) => {
    setPaperId(nextId);
    setPaperExisting(null);
    const chosenPaper = paperOptions.find((o) => o.tagId === nextId);
    if (!nextId || chosenPaper?.blank) return;
    startTransition(async () => {
      const res = await readMyPaper(nextId);
      // A refusal shows in the box like anything else — the sentence is the
      // same "You can't read this" the chip gives, so nothing is disclosed.
      setPaperExisting(res?.ok ? res.text : null);
    });
  }, [paperOptions]);

  // Heal-someone-else, Harm's lethal branch, Destroy and any Craft that
  // spends ⬢ or a Move ask twice. Confirm is awaited OUTSIDE
  // startTransition, or the dialog never renders.
  async function submit(reason) {
    if (mode === "craft" && !projectId && !siteId && chosen) {
      const turns = chosen.requirementTurns ?? 1;
      const qty = chosen.stackable ? Math.max(1, Number(quantity) || 1) : 1;
      const cost = (chosen.requirementResources ?? 0) * qty;
      const what = qty > 1 ? `${qty}× ${chosen.name}` : chosen.name;
      if (turns > 0 || cost > 0) {
        const ok = await confirm({
          title: turns > 1 ? "Start the work?" : "Make it?",
          message: [
            turns > 1 ? `${what} takes ${turns} turns of work.` : `Make ${what}?`,
            cost > 0 ? `${cost} ⬢ are paid now by ${payerLabel(healParties, payerKey)}, and not refunded if you stop.` : null,
            turns > 0 ? "This is your Move for the turn." : null,
            "‡",
          ]
            .filter(Boolean)
            .join(" "),
          confirmLabel: turns > 1 ? "Start ‡" : "Make it ‡",
        });
        if (!ok) return;
      }
    }
    if (mode === "craft" && projectId && projectChoice === "cancel") {
      const name = craftProjects.find((p) => p.id === projectId)?.tagName ?? "the work";
      const ok = await confirm({
        title: "Give it up?",
        message: `${name} stays unfinished and whatever you paid for it is gone. ‡`,
        confirmLabel: "Give it up ‡",
      });
      if (!ok) return;
    }
    if (mode === "craft" && siteId && projectChoice === "cancel") {
      const name = buildSites.find((s) => s.id === siteId)?.typeName ?? "the work";
      const ok = await confirm({
        title: "Give it up?",
        message: `The ${name} is left where it stands, and the ⬢ that went into it are gone. Anyone else working on it loses that work too. ‡`,
        confirmLabel: "Give it up ‡",
      });
      if (!ok) return;
    }
    if (mode === "destroy" && chosen) {
      const ok = await confirm({
        title: "Destroy it?",
        message: `${chosen.name} is gone for good. Nothing comes back. ‡`,
        confirmLabel: "Destroy ‡",
      });
      if (!ok) return;
    }
    if (mode === "heal" && payerKey !== `character:${selfId}`) {
      const payerName = payerLabel(healParties, payerKey);
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction?.cost ?? 0} ⬢ for this treatment.`,
        confirmLabel: "Charge them",
      });
      if (!ok) return;
    }
    if (mode === "harm" && lethal) {
      const name = harmTargets.find((t) => t.id === targetId)?.name ?? "them";
      const ok = await confirm({
        title: "Finish them off?",
        message: `This kills ${name}, now and for good. A GM will read your reason afterwards, not before.`,
        confirmLabel: "Kill them",
      });
      if (!ok) return;
    }

    setError(null);
    startTransition(async () => {
      const res = await runAction(reason);
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setMode(null);
    });
  }

  function runAction(reason) {
    switch (mode) {
      case "craft":
        // A build site takes the same two verbs as a project, against the
        // structure instead of the CraftProject.
        if (siteId) {
          return projectChoice === "cancel"
            ? cancelBuildSite({ structureId: siteId, reason })
            : joinBuildSite({ structureId: siteId, reason });
        }
        if (projectId) {
          return projectChoice === "cancel" ? cancelCraft({ projectId, reason }) : continueCraft({ projectId, reason });
        }
        // Always sent; the server pins it to 1 for a non-stackable tag anyway.
        return craftRequest({ tagId, quantity, payerKey, reason });
      case "destroy":
        return destroyTagRequest({ tagId, quantity, reason });
      case "learn":
        return learnRequest({ teacherId: targetId, tagId, reason });
      case "teach":
        return teachRequest({ learnerId: targetId, tagId, reason });
      case "consume":
        return consumeTagRequest({ tagId, reason });
      case "extract":
        return extractGodfleshRequest({ reason });
      case "package":
        return packageItemsRequest({
          lines: Object.entries(packed).map(([id, q]) => ({ tagId: id, quantity: q })),
          label: crateLabel,
          reason,
        });
      case "heal":
        return healCharacterRequest({
          targetCharacterId: patientId,
          tagId,
          payerKey,
          reason,
        });
      case "transfer":
        return transferRequest({
          fromKey,
          toKey,
          tags: Object.entries(picks).map(([id, q]) => ({ tagId: id, quantity: q })),
          amount,
          reason,
        });
      case "loot":
        return lootCharacterRequest({
          targetCharacterId: targetId,
          tagPicks: Object.entries(picks).map(([id, q]) => ({
            tagId: id,
            quantity: q,
          })),
          amount,
          reason,
        });
      case "move":
        return moveCharacterRequest({
          targetCharacterId: targetId,
          targetLocationId: locationId,
          reason,
        });
      case "bind":
        return bindCharacterRequest({ targetCharacterId: targetId, reason });
      case "free":
        return freeCharacterRequest({ targetCharacterId: targetId, reason });
      case "harm":
        return harmCharacterRequest({
          targetCharacterId: targetId,
          tagId,
          lethal,
          reason,
        });
      case "bury": {
        const corpse = corpses.find((c) => corpseIdOf(c) === corpseKey);
        return buryCharacterRequest({ tagId: corpse?.tagId, sourceKey: corpse?.sourceKey, reason });
      }
      case "butcher": {
        const corpse = corpses.find((c) => corpseIdOf(c) === corpseKey);
        return butcherCorpseRequest({ tagId: corpse?.tagId, sourceKey: corpse?.sourceKey, reason });
      }
      case "engrave":
        return engraveHeadstoneRequest({ firstName: engraveName, reason });
      // Neither files a Request — see web/app/(app)/character/paperActions.js
      // for why. Both still come back as { ok, error } like everything else.
      case "write":
        return writePaper({ tagId: paperId, text: paperBody });
      case "seal":
        return sealLetter({ tagId: tagId, stampTagId: stampId });
      case "bird":
        // No reason: the letter is the record. See RequestDialog.js.
        return birdMessageRequest({
          recipientId: targetId,
          guessedZoneId: zoneId,
          tagId: birdTagId,
        });
      default:
        return Promise.resolve({ ok: false, error: "Nothing to do." });
    }
  }

  const sameParty = fromKey && fromKey === toKey;
  const takingSomething = Object.keys(picks).length > 0 || Number(amount) > 0;

  const canSubmit = (() => {
    switch (mode) {
      case "write":
        return Boolean(paperId && paperBody.trim().length > 0);
      case "seal":
        return Boolean(tagId && stampId);
      case "bird":
        return Boolean(targetId && zoneId && birdTagId);
      case "transfer":
        return Boolean(fromKey && toKey && !sameParty && takingSomething);
      case "heal":
        return Boolean(
          patientId &&
          payerKey &&
          affliction,
        );
      case "loot":
        return Boolean(targetId && takingSomething);
      case "move":
        return Boolean(targetId && locationId);
      case "bind":
      case "free":
        return Boolean(targetId);
      case "harm":
        return Boolean(targetId && (tagId || lethal));
      case "bury":
      case "butcher":
        return Boolean(corpseKey);
      case "engrave":
        return Boolean(engraveName.trim());
      case "craft": {
        if (siteId) {
          const site = buildSites.find((s) => s.id === siteId);
          if (!site) return false;
          // Cancelling is the opener's alone and costs no Move; joining is a
          // Move like any other turn of work.
          return projectChoice === "cancel" ? Boolean(site.mine) : !hasMoved;
        }
        if (projectId) {
          const project = craftProjects.find((p) => p.id === projectId);
          if (!project) return false;
          return projectChoice === "cancel" || (!hasMoved && !project.workedThisTurn);
        }
        if (!chosen) return false;
        const cost = (chosen.requirementResources ?? 0) * (chosen.stackable ? Math.max(1, Number(quantity) || 1) : 1);
        return Boolean(cost === 0 || payerKey) && ((chosen.requirementTurns ?? 1) === 0 || !hasMoved);
      }
      case "learn":
      case "teach":
        return Boolean(targetId && tagId);
      case "extract":
        return canExtract;
      case "package":
        return Object.keys(packed).length > 0 && crateLabel.trim().length > 0 && packedLbs <= PACKAGE_MAX_LBS;
      default:
        return Boolean(tagId);
    }
  })();

  // What the grid needs to grey a button out — this character's sheet only.
  const pools = useMemo(
    () => ({
      canCraft: craftable.length > 0 || craftProjects.length > 0 || buildSites.length > 0,
      canDestroy: removable.length > 0,
      canConsume: consumable.length > 0,
      canHeal,
      canExamine: !examineBlocked,
      // The sentence ActionGrid appends to a greyed button's tooltip, so a
      // player reads why instead of DMing to ask.
      gateReason: { examine: examineBlocked, extract: extractBlocked },
      canLearn: teachers.length > 0,
      canTeach,
      // `show` gates whether ActionGrid renders the icon; canSendBirdToday
      // is a `gate` on top, so the button exists but is dead post-send.
      hasBird,
      canRead,
      canWrite,
      hasSeal,
      canSeal,
      canSendBirdToday: !birdSentToday,
      canButcher,
      canSeeExtract,
      canExtract,
      canSeePackage,
    }),
    [
      craftable,
      craftProjects,
      buildSites,
      removable,
      consumable,
      canHeal,
      examineBlocked,
      extractBlocked,
      teachers,
      canTeach,
      hasBird,
      canRead,
      canWrite,
      hasSeal,
      canSeal,
      birdSentToday,
      canButcher,
      canSeeExtract,
      canExtract,
      canSeePackage,
    ],
  );

  const value = useMemo(
    () => (enabled ? { open, pools } : null),
    [enabled, open, pools],
  );

  const title = titleFor(mode);
  const dialogWidth =
    mode === "craft" || mode === "harm" || mode === "loot" || mode === "transfer" ? "wide" : undefined;

  return (
    <RequestActionsContext.Provider value={value}>
      {children}

      {enabled && (
        <>
          {/* Look at files no Request and has no fields, so it gets its own
          plain modal rather than being forced through the Requests popup. It
          does call the server, but only to read (examineActions.js). */}
          <ExamineDialog open={mode === "examine"} onClose={() => setMode(null)} />

          <RequestDialog
            open={mode !== null && !NO_REQUEST_MODES.has(mode)}
            title={title}
            submitLabel={title}
            width={dialogWidth}
            busy={pending}
            error={error}
            canSubmit={canSubmit}
            // The letter is what a GM reads, so none of the paper verbs ask.
            reasonRequired={!NO_REASON_MODES.has(mode)}
            onCancel={() => !pending && setMode(null)}
            onConfirm={submit}
          >
            {mode === "craft" && (
              <CraftDialog
                hasWorkshop={hasWorkshop}
                projects={craftProjects}
                projectId={projectId}
                sites={buildSites}
                siteId={siteId}
                // One dropdown, two id spaces — the prefix says which.
                onPick={(key) => {
                  const [kind, id] = key.split(":");
                  setProjectId(kind === "project" ? id : "");
                  setSiteId(kind === "site" ? id : "");
                  setProjectChoice("continue");
                }}
                projectChoice={projectChoice}
                onProjectChoice={setProjectChoice}
                picker={
                  <TagPicker
                    tags={craftable}
                    selectedId={tagId}
                    onSelect={pick}
                    byId={gateById}
                    heldIds={heldIds}
                    emptyLabel="You don't know any recipes you could make right now. ‡"
                  />
                }
                chosen={chosen}
                stacking={stacking}
                quantity={quantity}
                onQuantity={setQuantity}
                payerKey={payerKey}
                onPayer={setPayerKey}
                parties={healParties}
                selfId={selfId}
                hasMoved={hasMoved}
              />
            )}

            {mode === "destroy" && (
              <>
                <label className="field">
                  <span className="field-label">What are you destroying? ‡</span>
                  <Select
                    value={tagId ?? ""}
                    onChange={(e) => pick(e.target.value || null)}
                    required
                  >
                    <option value="" disabled>
                      Choose a tag…
                    </option>
                    {removable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                {stacking && (
                  <QuantityField
                    value={quantity}
                    onChange={setQuantity}
                    max={heldCount}
                    label={`How many? (you have ${heldCount})`}
                  />
                )}
                <p className="text-xs text-muted">
                  Gone for good, and nothing is refunded. A wound isn&apos;t destroyed — that&apos;s Heal. ‡
                </p>
              </>
            )}

            {(mode === "learn" || mode === "teach") && (
              <>
                {lessonPeople.length === 0 ? (
                  <NobodyHere>
                    {mode === "learn"
                      ? "Nobody here can teach you anything right now. ‡"
                      : "There's nobody here you could teach anything. ‡"}
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">
                        {mode === "learn" ? "Who are you learning from? ‡" : "Who are you teaching? ‡"}
                      </span>
                      <Select
                        value={targetId}
                        onChange={(e) => {
                          setTargetId(e.target.value);
                          setTagId(null);
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose someone here…
                        </option>
                        {lessonPeople.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {lessonPartner && (
                      <label className="field">
                        <span className="field-label">Which skill? ‡</span>
                        <Select value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)} required>
                          <option value="" disabled>
                            Choose a skill… ‡
                          </option>
                          {lessonPartner.skills.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                  </>
                )}
                <p className="text-xs text-muted">
                  {mode === "learn"
                    ? "They get a DM and have to accept. Once they do, learning is your Gambit for the turn — a 5 or 6 and the skill is yours when the turn ends. ‡"
                    : "They get a DM and have to accept. Once they do, teaching is your Routine for the turn. With Lecturing you can take up to three students on it. ‡"}
                  {hasMoved && !canTeach
                    ? " You've already used your Move this turn, so this will have to wait. ‡"
                    : ""}
                </p>
              </>
            )}

            {mode === "consume" && (
              <>
                <label className="field">
                  <span className="field-label">What are you using up?</span>
                  <Select
                    value={tagId ?? ""}
                    onChange={(e) => pick(e.target.value || null)}
                    required
                  >
                    <option value="" disabled>
                      Choose a tag…
                    </option>
                    {consumable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                {chosen && (
                  <p className="text-xs text-muted">
                    {becomes.length
                      ? `Becomes: ${becomes.join(", ")}.`
                      : "Gets used up — it doesn't leave anything behind."}
                    {chosen.quantity > 1
                      ? ` Takes one of your ${chosen.quantity}.`
                      : ""}
                  </p>
                )}
              </>
            )}

            {mode === "heal" && (
              <>
                <label className="field">
                  <span className="field-label">Who are you treating?</span>
                  <Select
                    value={patientId}
                    onChange={(e) => {
                      setPatientId(e.target.value);
                      setTagId(null);
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose someone here…
                    </option>
                    {healTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id === selfId ? `${t.name} (you)` : t.name}
                      </option>
                    ))}
                  </Select>
                </label>
                {patient && (
                  <label className="field">
                    <span className="field-label">What are you treating?</span>
                    <Select
                      value={tagId ?? ""}
                      onChange={(e) => setTagId(e.target.value || null)}
                      required
                    >
                      <option value="" disabled>
                        Choose an affliction…
                      </option>
                      {patient.healable.map((h) => (
                        <option key={h.tagId} value={h.tagId}>
                          {h.tagName}
                          {h.gambit ? " — Gambit ‡" : ""}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {affliction && (
                  <>
                    <PartySelect
                      label="Paid for by"
                      value={payerKey}
                      onChange={setPayerKey}
                      hint="Choose who pays…"
                      characters={healParties?.characters ?? []}
                      rooms={healParties?.rooms ?? []}
                      selfId={selfId}
                    />
                    <p className={`text-xs ${affliction.gambit ? "text-accent" : "text-muted"}`}>
                      Costs <span className="mono">{affliction.cost} ⬢</span>.
                      {affliction.gambit
                        ? " This is past what you can do as a matter of routine, so it's a Gambit: it spends your Move, a die is rolled, and a bad roll can leave them worse off. You'll both know at the end of the turn. ‡"
                        : affliction.counts
                          ? ` One of the ${healsLeft ?? "few"} cases you can work this turn. ‡`
                          : " First aid — costs you no part of your day. ‡"}
                    </p>
                  </>
                )}
              </>
            )}

            {mode === "transfer" && (
              <TransferDialog
                selfId={selfId}
                parties={transferParties}
                silo={transferSilo}
                transferable={transferable}
                carry={carry}
                fromKey={fromKey}
                toKey={toKey}
                onFrom={(key) => {
                  setFromKey(key);
                  setPicks({});
                }}
                onTo={setToKey}
                picks={picks}
                onTogglePick={togglePick}
                onPickQuantity={setPickQuantity}
                amount={amount}
                onAmount={setAmount}
              />
            )}

            {mode === "loot" && (
              <>
                {lootTargets.length === 0 ? (
                  <NobodyHere>
                    Nobody here is in any state to be searched.
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">
                        Who are you searching?
                      </span>
                      <Select
                        value={targetId}
                        onChange={(e) => {
                          setTargetId(e.target.value);
                          setPicks({});
                          setAmount("0");
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose someone here…
                        </option>
                        {lootTargets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {targetNote(t)}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {lootTarget && (
                      <>
                        {lootTarget.tags.length === 0 ? (
                          <p className="text-xs text-muted">
                            They&apos;re carrying nothing worth taking.
                          </p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <span className="field-label">Take</span>
                            {lootTarget.tags.map((t) => {
                              const checked = t.tagId in picks;
                              return (
                                <div
                                  key={t.tagId}
                                  className="flex flex-wrap items-center gap-3"
                                >
                                  <CheckField
                                    checked={checked}
                                    onChange={() =>
                                      togglePick(t.tagId, t.quantity)
                                    }
                                  >
                                    {t.tagName}
                                    {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                                  </CheckField>
                                  {checked && t.stackable && t.quantity > 1 && (
                                    <QuantityField
                                      label="How many? ‡"
                                      max={t.quantity}
                                      value={picks[t.tagId]}
                                      onChange={(v) => setPickQuantity(t.tagId, v)}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <label className="field" style={{ width: "10rem" }}>
                          <span className="field-label">
                            Resources (they have {lootTarget.resources})
                          </span>
                          <input
                            type="number"
                            min="0"
                            max={lootTarget.resources}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {mode === "move" && (
              <>
                {moveTargets.length === 0 ? (
                  <NobodyHere>There&apos;s nobody here to move.</NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Who are you moving?</span>
                      <Select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Choose someone here…
                        </option>
                        {moveTargets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.status === "DEAD" ? " — body" : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="field">
                      <span className="field-label">Where to?</span>
                      <Select
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Choose somewhere next door… ‡
                        </option>
                        {moveLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                            {l.crossesZone && l.zoneName ? ` — crosses into ${l.zoneName}` : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <p className="text-xs text-muted">
                      You can move someone you lead, someone you&apos;ve bound,
                      or a body — anyone standing anywhere in your zone. It does
                      not spend their turn, and it does not move you, so go
                      there yourself afterwards. ‡
                    </p>
                  </>
                )}
              </>
            )}

            {mode === "extract" && (
              <>
                <p className="text-sm">
                  You wade out and cut. A day of it. ‡
                </p>
                {extractBlocked ? (
                  <p className="text-sm text-accent">{extractBlocked}</p>
                ) : (
                  <p className="text-xs text-muted">
                    Rolls 1d6, and you&apos;ll be told what it came up. A 6 pays an extra. A 1 means
                    it had hold of you first — Armored Gloves are the difference between a cut and a
                    hand. ‡
                  </p>
                )}
              </>
            )}

            {mode === "package" && (
              <>
                {packable.length === 0 ? (
                  <NobodyHere>You aren&apos;t carrying anything that could go in a crate. ‡</NobodyHere>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <span className="field-label">What goes in? ‡</span>
                      {sortTagsForMenu(packable).map((tag) => {
                        const checked = tag.id in packed;
                        return (
                          <div key={tag.id} className="flex flex-wrap items-center gap-3">
                            <CheckField checked={checked} onChange={() => togglePacked(tag.id, tag.quantity)}>
                              {tag.name}
                              {tag.quantity > 1 ? ` ×${tag.quantity}` : ""}
                              <span className="mono ml-2 text-xs text-muted">{`${tag.weightLbs ?? 0} lb`}</span>
                            </CheckField>
                            {checked && tag.stackable && tag.quantity > 1 && (
                              <QuantityField
                                label="How many? ‡"
                                max={tag.quantity}
                                value={packed[tag.id]}
                                onChange={(v) => setPackedQuantity(tag.id, v)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <label className="field">
                      <span className="field-label">What does the crate say? ‡</span>
                      <input
                        type="text"
                        value={crateLabel}
                        onChange={(e) => setCrateLabel(e.target.value)}
                        placeholder="Squeeze, 7 cubes"
                        autoComplete="off"
                        maxLength={PACKAGE_LABEL_MAX}
                        required
                      />
                    </label>

                    <p className={packedLbs > PACKAGE_MAX_LBS ? "text-sm text-accent" : "text-xs text-muted"}>
                      {`${packedLbs} / ${PACKAGE_MAX_LBS} lb packed. The crate will weigh ${Math.max(
                        1,
                        Math.ceil(packedLbs / 2),
                      )} lb. `}
                      {packedLbs > PACKAGE_MAX_LBS
                        ? "That won't go in one crate. ‡"
                        : "Nobody checks the line on the side against what's actually in there. ‡"}
                    </p>
                  </>
                )}
              </>
            )}

            {(mode === "bury" || mode === "butcher") && (
              <>
                {/* Butcher takes anything; Bury needs a person. A Nekker has
                no soul to free, so it isn't offered here rather than being
                offered and refused. */}
                {(() => {
                  const list = mode === "bury" ? corpses.filter((c) => c.human) : corpses;
                  if (list.length === 0) {
                    return (
                      <NobodyHere>
                        {mode === "bury"
                          ? "You aren’t holding a body, and there’s none lying anywhere you can reach. ‡"
                          : "There’s nothing here to cut up. ‡"}
                      </NobodyHere>
                    );
                  }
                  const chosen = list.find((c) => corpseIdOf(c) === corpseKey);
                  return (
                    <>
                      <label className="field">
                        <span className="field-label">Whose body? ‡</span>
                        <Select
                          value={corpseKey}
                          onChange={(e) => setCorpseKey(e.target.value)}
                          required
                        >
                          <option value="">Pick a body…</option>
                          {list.map((c) => (
                            <option key={corpseIdOf(c)} value={corpseIdOf(c)}>
                              {`${c.tagName} — ${c.source.name}`}
                            </option>
                          ))}
                        </Select>
                      </label>
                      {mode === "butcher" && chosen ? (
                        <p className="text-xs text-muted">
                          Cutting this one up gives you {yieldLabel(chosen)}. The body is gone
                          afterwards, and their soul stays where it is. ‡
                        </p>
                      ) : null}
                      {mode === "bury" ? (
                        <p className="text-xs text-muted">
                          This takes your turn, and it frees them to respawn. ‡
                        </p>
                      ) : null}
                    </>
                  );
                })()}
              </>
            )}

            {mode === "engrave" && (
              <>
                <label className="field">
                  <span className="field-label">Whose name? ‡</span>
                  <input
                    type="text"
                    value={engraveName}
                    onChange={(e) => setEngraveName(e.target.value)}
                    placeholder="First name"
                    autoComplete="off"
                    maxLength={24}
                    required
                  />
                </label>
                {/* No target list, and no "nobody here" line either — both would
                answer "who is dead?" without anyone choosing to ask, and this
                one searches every zone rather than just this room. You type a
                name and find out whether you were right. */}
                <p className="text-xs text-muted">
                  Write the person&apos;s name letter by letter&mdash;be precise!&mdash;or the
                  wrong soul goes free. This costs {ENGRAVE_RESOURCE_COST} ⬢ and your turn. ‡
                </p>
              </>
            )}

            {(mode === "bind" || mode === "free") && (
              <>
                {bindable.length === 0 ? (
                  <NobodyHere>
                    {mode === "bind"
                      ? "There’s nobody here left to tie up."
                      : "Nobody here is bound."}
                  </NobodyHere>
                ) : (
                  <label className="field">
                    <span className="field-label">
                      {mode === "bind"
                        ? "Who are you tying up?"
                        : "Who are you cutting loose?"}
                    </span>
                    <Select
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Choose someone here…
                      </option>
                      {bindable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                <p className="text-xs text-muted">
                  {mode === "bind"
                    ? "Once they're Bound you can search them or march them somewhere. Say why."
                    : "Anyone standing here can do this, including someone who came to rescue them."}
                </p>
              </>
            )}

            {mode === "harm" && (
              <>
                {harmTargets.length === 0 ? (
                  <NobodyHere>
                    Nobody here is helpless enough for that.
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Who are you hurting?</span>
                      <Select
                        value={targetId}
                        onChange={(e) => {
                          setTargetId(e.target.value);
                          setLethal(false);
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose someone here…
                        </option>
                        {harmTargets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {t.condition ?? "Helpless"}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <span className="field-label">What injury? (optional)</span>
                    <TagPicker
                      tags={harmTags}
                      selectedId={tagId}
                      onSelect={setTagId}
                      emptyLabel="No injuries in the catalog."
                    />

                    <CheckField
                      checked={lethal}
                      onChange={(e) => setLethal(e.target.checked)}
                      disabled={
                        !harmTargets.find((t) => t.id === targetId)?.finishable
                      }
                    >
                      Finish them off
                    </CheckField>
                    <p className="text-xs text-muted">
                      Only someone Dying or Bound can be finished off, and doing
                      it <strong>kills them</strong> — there is no taking it
                      back. Pick an injury, tick the box, or both.
                    </p>
                  </>
                )}
              </>
            )}

            {mode === "write" && (
              <>
                {paperOptions.length === 0 ? (
                  <NobodyHere>
                    You have no paper. The Depot sells it, cheaper than anything else there. ‡
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">What are you writing on? ‡</span>
                      <Select value={paperId} onChange={(e) => choosePaper(e.target.value)} required>
                        <option value="" disabled>
                          Pick a sheet
                        </option>
                        {paperOptions.map((o) => (
                          <option key={o.tagId} value={o.tagId}>
                            {o.blank
                              ? `${o.name}${o.quantity > 1 ? ` ×${o.quantity}` : ""} — blank`
                              : `${o.name}${o.excerpt ? ` — ${o.excerpt}` : ""}`}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {/* Read-only, always. You can always write more; you can
                    never take anything back off a sheet. */}
                    {paperExisting && (
                      <div className="field">
                        <span className="field-label">Already on it ‡</span>
                        <pre className="panel whitespace-pre-wrap text-sm">{paperExisting}</pre>
                      </div>
                    )}

                    <label className="field">
                      <span className="field-label">
                        {paperExisting ? "Add underneath ‡" : "What does it say? ‡"}
                      </span>
                      <textarea
                        rows={6}
                        maxLength={WRITE_MAX}
                        value={paperBody}
                        onChange={(e) => setPaperBody(e.target.value)}
                        placeholder="Anyone who can read it will read exactly this. ‡"
                      />
                      <span className="text-xs text-muted mono">
                        {paperBody.length} / {WRITE_MAX}
                      </span>
                    </label>
                  </>
                )}
              </>
            )}

            {mode === "seal" && (
              <>
                {sealOptions.letters.length === 0 ? (
                  <NobodyHere>
                    You aren&apos;t carrying a written letter to close. ‡
                  </NobodyHere>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Which letter? ‡</span>
                      <Select value={tagId ?? ""} onChange={(e) => setTagId(e.target.value)} required>
                        <option value="" disabled>
                          Pick a letter
                        </option>
                        {sealOptions.letters.map((o) => (
                          <option key={o.tagId} value={o.tagId}>
                            {o.name}
                            {o.excerpt ? ` — ${o.excerpt}` : ""}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <label className="field">
                      <span className="field-label">Whose wax? ‡</span>
                      <Select value={stampId} onChange={(e) => setStampId(e.target.value)} required>
                        <option value="" disabled>
                          Pick a stamp
                        </option>
                        {sealOptions.stamps.map((o) => (
                          <option key={o.tagId} value={o.tagId}>
                            {o.name}
                          </option>
                        ))}
                      </Select>
                      <p className="text-xs text-muted">
                        Nobody can read it without breaking the seal, and everybody can see
                        whose wax it was. The stamp is not used up. ‡
                      </p>
                    </label>
                  </>
                )}
              </>
            )}

            {mode === "bird" && (
              <>
                {/* EVERY character, alive or dead, unfiltered. Narrowing this to
                the living would turn the picker into a casualty list that
                updates itself — the same disclosure REQUESTS.md §3 refuses
                for the transfer dropdowns. A letter to someone already dead
                simply never arrives, and you find that out a turn later.
                The search box below narrows on the NAME THE PLAYER TYPED,
                which is not a disclosure — it tells them nothing they did not
                already have to guess. */}
                <label className="field">
                  <span className="field-label">Who is it for?</span>
                  <input
                    type="search"
                    value={birdQuery}
                    onChange={(e) => setBirdQuery(e.target.value)}
                    placeholder="Search by name"
                  />
                  <Select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Pick someone
                    </option>
                    {birdChoices.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-muted mono">
                    {birdChoices.length} / {birdTargets.length}
                  </span>
                </label>

                <label className="field">
                  <span className="field-label">
                    Where do you think they are?
                  </span>
                  <Select
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Pick a place
                    </option>
                    {birdZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="field">
                  <span className="field-label">Which letter?</span>
                  {letterOptions.length === 0 ? (
                    <NobodyHere>
                      You aren&apos;t carrying anything written. Use Write first. ‡
                    </NobodyHere>
                  ) : (
                    <Select value={birdTagId} onChange={(e) => setBirdTagId(e.target.value)} required>
                      <option value="" disabled>
                        Pick a letter
                      </option>
                      {letterOptions.map((o) => (
                        <option key={o.tagId} value={o.tagId}>
                          {o.name}
                          {o.excerpt ? ` — ${o.excerpt}` : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                  <p className="text-xs text-muted">
                    The bird takes it out of your hands. Guess the wrong place and it comes
                    back with the letter still on it. ‡
                  </p>
                </label>
              </>
            )}
          </RequestDialog>
        </>
      )}
    </RequestActionsContext.Provider>
  );
}
