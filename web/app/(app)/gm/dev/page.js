import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import { updateGameConfig, updateCurrentTurn, updateNextTurn, wipeGameData } from "./actions";
import EndTurnButton from "./EndTurnButton";
import PageShell, { PageHeader } from "@/app/components/PageShell";

const WEATHER_OPTIONS = [
  { value: "CLEAR", label: "Clear" },
  { value: "FOG", label: "Fog" },
  { value: "RAIN", label: "Rain" },
  { value: "STORM", label: "Storm" },
  { value: "MIGRATION", label: "Migration" },
];

export default async function DevPanelPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [config, openTurnRecord, lastTurn] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    getOpenTurn(),
    prisma.turn.findFirst({ orderBy: { number: "desc" } }),
  ]);

  const currentDay = openTurnRecord ? Math.ceil(openTurnRecord.number / 2) : Math.ceil(((lastTurn?.number ?? 0) + 1) / 2);
  const currentPhase = openTurnRecord?.phase ?? (lastTurn?.phase === "DAWN" ? "DUSK" : "DAWN");
  const currentWeather = openTurnRecord?.weather ?? "CLEAR";

  // Mirrors advanceTurn()'s own phase alternation, so the confirm dialog can
  // warn about the Dawn wipe only when the next turn actually triggers one.
  const lastForPhase = openTurnRecord ?? lastTurn;
  const nextPhase = !lastForPhase || lastForPhase.phase === "DUSK" ? "DAWN" : "DUSK";

  return (
    <PageShell>
      <PageHeader
        title="Dev Panel"
        subtitle="Superadmin only. Edits here bypass all game rules — use with care."
        actions={
          <nav className="flex gap-4 text-sm">
            <Link href="/gm/dev/characters" className="menu-item">Characters</Link>
            <Link href="/gm/dev/factions" className="menu-item">Factions</Link>
          </nav>
        }
      />

      <section className="panel p-4">
        <h2 className="panel-header">Current Turn</h2>
        <p className="mb-3 text-sm text-muted">
          {openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn is currently open."}
        </p>

        <form action={updateCurrentTurn} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Day</span>
            <input type="number" name="day" min="1" defaultValue={currentDay} style={{ width: "6rem" }} />
          </label>
          <label className="field">
            <span className="field-label">Phase</span>
            <select name="phase" defaultValue={currentPhase}>
              <option value="DAWN">DAWN</option>
              <option value="DUSK">DUSK</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Weather</span>
            <select name="weather" defaultValue={currentWeather}>
              {WEATHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">Save</button>
        </form>

        <EndTurnButton
          turnLabel={openTurnRecord ? describeTurn(openTurnRecord).label : null}
          wipesMessages={nextPhase === "DAWN" && config.messageWipeEnabled}
        />

        <p className="mt-3 text-xs text-muted">
          Save overrides the current turn&apos;s day/phase/weather directly, without resolving Needs. End
          turn resolves Needs on the current turn and opens the next one — same as the automatic
          dawn/dusk advance. The Discord announcement and the Dawn wipe finish in the background after
          this page updates, so #turns may lag it by a moment.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Next Turn</h2>
        <p className="mb-3 text-sm text-muted">
          {config.nextWeather ? `Weather set to ${config.nextWeather}` : "Weather will be rolled automatically."}
          {config.nextTurnNote ? ` — note: "${config.nextTurnNote}"` : ""}
        </p>
        <form action={updateNextTurn} className="flex flex-col gap-3">
          <label className="field">
            <span className="field-label">Weather</span>
            <select name="weather" defaultValue={config.nextWeather ?? ""} style={{ maxWidth: "12rem" }}>
              <option value="">Random</option>
              {WEATHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Note (optional)</span>
            <textarea name="note" defaultValue={config.nextTurnNote ?? ""} rows={2} />
          </label>
          <button type="submit" className="btn self-start">Save</button>
        </form>
        <p className="mt-3 text-xs text-muted">
          Applies the next time the turn advances (via End turn above or the bot&apos;s automatic
          dawn/dusk cron), then clears itself.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Game Config</h2>
        <form action={updateGameConfig} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="field">
            <span className="field-label">Lifeweb Blood (0-100, raw override)</span>
            <input type="number" name="lifewebBlood" min="0" max="100" defaultValue={config.lifewebBlood} />
          </label>
          <label className="field">
            <span className="field-label">Lifeweb decay / turn</span>
            <input type="number" name="lifewebDecayPerTurn" defaultValue={config.lifewebDecayPerTurn} />
          </label>
          <label className="field">
            <span className="field-label">Production coefficient (Farming/Fishing/Herding)</span>
            <input type="number" step="0.05" name="productionCoefficient" defaultValue={config.productionCoefficient} />
          </label>
          <label className="field">
            <span className="field-label">Starting tag points</span>
            <input type="number" name="startingTagPoints" min="0" defaultValue={config.startingTagPoints} />
          </label>
          <label className="field">
            <span className="field-label">Player count (scales role seat caps)</span>
            <input type="number" name="playerCount" min="1" defaultValue={config.playerCount} />
          </label>
          <label className="flex items-center gap-2 text-sm col-span-full">
            <input type="checkbox" name="messageWipeEnabled" defaultChecked={config.messageWipeEnabled} />
            Wipe messages at Dawn (archives everything to #archive first — see docs/systemdocs/CHANNELS.md)
          </label>
          <label className="flex items-center gap-2 text-sm col-span-full">
            <input type="checkbox" name="tupperAutocorrectEnabled" defaultChecked={config.tupperAutocorrectEnabled} />
            Capitalize sentence starts in Tupper messages before proxying
          </label>
          <div className="col-span-full">
            <button type="submit" className="btn">Save config</button>
          </div>
        </form>
        <p className="mt-3 text-xs text-muted">
          Tupper/summary channels are the plain/public/private channels of a provisioned Location. Moves and Efforts
          come from channels named exactly &quot;moves&quot; and &quot;effort&quot;. With Dawn wipe enabled, the wipe
          itself runs in the background after a Dawn advance and can take a few minutes to finish in Discord — the
          turn is already open before it starts. Production coefficient scales /labor&apos;s payouts
          and docs/documents.yaml&apos;s printed numbers (via live {"{resource:...}"} bubbles) immediately — nothing
          to sync by hand.
        </p>
      </section>

      <section className="panel p-4" style={{ borderColor: "var(--accent)" }}>
        <h2 className="panel-header text-accent">Restart Game</h2>
        <p className="mb-3 text-sm text-muted">
          Wipes every character, Move, default effort, note, DM log, and audit log entry; resets every
          Faction&apos;s Silo to 0 and the Game Config above to its
          defaults; deletes each character&apos;s personal Discord role and nickname; clears every
          message in #archive and #turns; and deletes every message, forum post, and thread (public or
          private) in every provisioned Location channel. Opens a fresh Turn 1, Dawn. Factions, Zones,
          Locations, and the channels/categories themselves are left in place, just emptied out; the Tag
          catalog is re-synced from docs/tags.yaml. This cannot be undone.
        </p>
        <form action={wipeGameData} className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Type WIPE to confirm</span>
            <input type="text" name="confirm" autoComplete="off" style={{ width: "10rem" }} />
          </label>
          <button type="submit" className="btn" style={{ borderColor: "var(--accent)" }}>
            Wipe &amp; restart game
          </button>
        </form>
      </section>
    </PageShell>
  );
}
