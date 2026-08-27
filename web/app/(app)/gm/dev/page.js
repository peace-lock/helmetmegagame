import SubmitButton from "@/app/components/SubmitButton";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import { updateGameConfig, updateCurrentTurn, updateNextTurn } from "./actions";
import EndTurnButton from "./EndTurnButton";
import WipeGameButton from "./WipeGameButton";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import Switch from "@/app/components/Switch";

const WEATHER_OPTIONS = [
  { value: "CLEAR", label: "Clear" },
  { value: "FOG", label: "Fog" },
  { value: "RAIN", label: "Rain" },
  { value: "STORM", label: "Storm" },
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
            <Link href="/gm/dev/tags" className="menu-item">Tags</Link>
            <Link href="/gm/gamemasters" className="menu-item">Gamemasters</Link>
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
            <input type="number" name="day" min="1" defaultValue={currentDay} style={{ maxWidth: "6rem" }} />
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
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>

        <EndTurnButton
          turnLabel={openTurnRecord ? describeTurn(openTurnRecord).label : null}
          wipesMessages={nextPhase === "DAWN" && config.messageWipeEnabled}
        />

        <p className="mt-3 text-xs text-muted">
          Save overrides the current turn&apos;s day/phase/weather directly.
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
          <SubmitButton className="btn self-start" pendingLabel="Saving…">Save</SubmitButton>
        </form>
        <p className="mt-3 text-xs text-muted">
          Applies on next turn (via End turn above or the bot&apos;s automatic dawn/dusk cron).
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Game Config</h2>
        <form action={updateGameConfig} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          <label className="field">
            <span className="field-label">Lifeweb Blood (0-100, raw override)</span>
            <input type="number" name="lifewebBlood" min="0" max="100" defaultValue={config.lifewebBlood} />
          </label>
          <label className="field">
            <span className="field-label">Lifeweb decay / turn</span>
            <input type="number" name="lifewebDecayPerTurn" defaultValue={config.lifewebDecayPerTurn} />
          </label>
          <label className="field">
            <span className="field-label">Production coefficient</span>
            <input type="number" step="0.05" name="productionCoefficient" defaultValue={config.productionCoefficient} />
          </label>
          <label className="field">
            <span className="field-label">Starting tag points</span>
            <input type="number" name="startingTagPoints" min="0" defaultValue={config.startingTagPoints} />
          </label>
          <label className="field">
            <span className="field-label">Player count</span>
            <input type="number" name="playerCount" min="1" defaultValue={config.playerCount} />
          </label>

          <label className="field">
            <span className="field-label">Equip slots</span>
            <input type="number" name="equipSlots" min="1" max="20" defaultValue={config.equipSlots} />
          </label>
          <label className="field">
            <span className="field-label">Max drawback points</span>
            <input
              type="number"
              name="maxDrawbackPoints"
              min="0"
              max="20"
              defaultValue={config.maxDrawbackPoints}
            />
          </label>
          <label className="field">
            <span className="field-label">Summary channel ID (public declarations)</span>
            <input
              name="turnSummaryChannelId"
              placeholder="Discord channel ID"
              defaultValue={config.turnSummaryChannelId ?? ""}
            />
          </label>
          <Switch name="openToPlayers" defaultChecked={config.openToPlayers} className="col-span-full">
            Open to players
          </Switch>
          <Switch name="leaderWhitelistEnabled" defaultChecked={config.leaderWhitelistEnabled} className="col-span-full">
            Require the @Leader Whitelist role to pick a Leader (★) role
          </Switch>
          <Switch name="playtestModeEnabled" defaultChecked={config.playtestModeEnabled} className="col-span-full">
            Playtest mode — lock the Merchant and every Windlands role out of character creation. Their cards still show, greyed, so the charters stay readable. Not bypassed for superadmins.
          </Switch>
          <Switch name="autoTurnAdvanceDisabled" defaultChecked={config.autoTurnAdvanceDisabled} className="col-span-full">
            Pause automatic turn advance — the twice-daily cron skips its advance while this is on. &ldquo;Advance turn now&rdquo; below still works.
          </Switch>
          <Switch name="avatarUploadsEnabled" defaultChecked={config.avatarUploadsEnabled} className="col-span-full">
            Allow players to upload their own profile picture
          </Switch>
          <Switch name="portraitMakerEnabled" defaultChecked={config.portraitMakerEnabled} className="col-span-full">
            Show the &quot;Customize Appearance&quot; portrait maker on /character
          </Switch>
          <Switch name="portraitFantasyPartsEnabled" defaultChecked={config.portraitFantasyPartsEnabled} className="col-span-full">
            Allow the portrait maker&apos;s fantasy parts.
          </Switch>
          <Switch name="messageWipeEnabled" defaultChecked={config.messageWipeEnabled} className="col-span-full">
            Wipe messages at Dawn (archives everything to #archive first — see docs/systemdocs/CHANNELS.md)
          </Switch>
          <Switch name="tupperAutocorrectEnabled" defaultChecked={config.tupperAutocorrectEnabled} className="col-span-full">
            Capitalize sentence starts in Tupper messages before proxying
          </Switch>
          <Switch name="nicknameSyncEnabled" defaultChecked={config.nicknameSyncEnabled} className="col-span-full">
            Sync Discord nicknames to &quot;{"{base}"} | Character Name&quot; on profile/character changes
          </Switch>
          <Switch name="archiveVisible" defaultChecked={config.archiveVisible} className="col-span-full">
            Open /archive to players — <strong>effectively one-way</strong>: shows every location regardless of where a character stood, and names the character behind every /conceal. Meant for after the game ends.
          </Switch>
          <Switch name="archiveTravelEvents" defaultChecked={config.archiveTravelEvents} className="col-span-full">
            Record arrivals/departures in the archive
          </Switch>
          <div className="col-span-full">
            <SubmitButton pendingLabel="Saving…">Save config</SubmitButton>
          </div>
        </form>
      </section>

      <section className="panel p-4" style={{ borderColor: "var(--accent)" }}>
        <h2 className="panel-header text-accent">Restart Game</h2>
        <p className="mb-3 text-sm text-muted">
          Wipes all game data and reopens Turn 1. Cannot be undone.
        </p>
        <WipeGameButton />
      </section>
    </PageShell>
  );
}
