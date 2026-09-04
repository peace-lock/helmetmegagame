// Long prose the old /gm/dev switch labels and footnotes used to carry
// inline. The redesigned page (web/app/(desk)/gm/dev/page.js) shortens every
// toggle to a one-line label and moves the detail here, read through
// InfoIcon. Every sentence that used to sit on a Switch's children or in a
// footnote paragraph is preserved here, word for word — only JSX markup
// (<strong>, HTML entities used for JSX-safe quoting) is dropped.
export const CONFIG_HELP = {
  leaderWhitelistEnabled:
    "Require the @Leader Whitelist role to pick a whitelisted role. A card without it renders greyed, and says “Whitelist only” on hover. ‡",
  playtestModeEnabled:
    "Lock the Merchant and every Windlands role out of character creation. Their cards still show, greyed, so the charters stay readable. Not bypassed for superadmins.",
  autoTurnAdvanceDisabled:
    "The nightly cron skips its advance while this is on. “Advance turn now” on the Turn section still works.",
  avatarUploadsEnabled: "Allow players to upload their own profile picture.",
  portraitMakerEnabled: "Show the “Customize Appearance” portrait maker on /character.",
  portraitFantasyPartsEnabled: "Allow the portrait maker's fantasy parts.",
  messageWipeEnabled:
    "The transcript is already recorded at send time, this only deletes (see docs/systemdocs/CHANNELS.md).",
  catatonicEnabled:
    "Idle turns before a character goes Catatonic (AFK). Flags a character Catatonic (AFK) after that many turns with no move filed and nothing said in character — clears the moment they act or speak again.",
  catatonicDeathTurns:
    "The one automatic death in the game: a character who stays Catatonic this many turns straight dies at turn close — full cleanup, no GM confirm. Covers AFK players and players who left the server (their characters go Catatonic on the spot instead of dying). 0 turns it off; the player gets a warning DM one turn before.",
  locationMoveCooldownSeconds:
    "How long a character waits between walks from one location to another inside the same zone.",
  autoReconcileEnabled:
    "Run the channel doctor's cheap reconcile (roles vs. the database) automatically after every turn advance — it always runs when the bot restarts.",
  tupperAutocorrectEnabled: "Capitalize sentence starts in Tupper messages before proxying.",
  nicknameSyncEnabled:
    "Sync Discord nicknames to “{base} | Character Name” on profile/character changes.",
  archiveVisible:
    "Effectively one-way: shows every location regardless of where a character stood, and names the character behind every /conceal. Meant for after the game ends.",
  archiveTravelEvents: "Record arrivals/departures in the archive.",
  lifewebBlood: "0-100, raw override.",
  desiresEnabled:
    "Let players claim Desires on /character. Turning this off shows “Temporarily disabled.” in place of the Desire panel and blocks a claim server-side. GMs can still award one — catalog or free text — from a character's Dev Panel regardless.",
  desireSlots:
    "How many Desire slots every character gets. Each slot cools down independently of the others, and the bottom one is the slot an Addiction binds. Lowering this hides a slot rather than deleting what was claimed in it.",
  desireSlotLockTurns:
    "Whole turns a slot stays shut after a Desire is claimed into it. At 2, a claim on turn 40 leaves that slot shut through turn 42 and open on 43. Remember a turn is a whole real day, and an in-game day is two of them.",
  carryWeightLbs:
    "How many POUNDS of gear a character can carry before they're Overburdened. Skills, injuries and Assets — a horse, a cart, a house — never weigh anything. Strong, Pack Mule and an equipped Cart multiply it. Past 1.5× this, goods can't be theirs at all. ‡",
  carryResourceCap:
    "How many ⬢ a character can carry before they're Overburdened. Income still lands; they just lose their free zone move until they stash some. Strong, Pack Mule and an equipped Cart multiply it. ‡",
  freeZoneMovesPerTurn:
    "Zone crossings a character gets each turn before crossing starts spending their Move. An equipped mount adds 1 on top; being Overburdened takes them all away. ‡",
};

// The Depot section. Same shape as CONFIG_HELP: one line per field, written
// for a GM who has not read DEPOT.md and should not have to.
export const DEPOT_HELP = {
  accountObols:
    "The station's balance in obols (¢). It belongs to the Depot, not to the Merchant — hand the licence to someone else and the money goes with it. ‡",
  debtObols: "How much of the Company's line is currently drawn, in obols. ‡",
  generatorFuel:
    "Units left in the tank. The generator burns a fixed amount every turn and switches itself off at zero, which stops everything at the Depot. ‡",
  merchantFace:
    "The one name the turret will not fire on. It is written automatically when a character is created on the Merchant role, and this field is the override. It matches the PRESENTED name, so a concealed Merchant is shot by his own gun and anyone wearing his name walks past it. Leave it blank and the turret fires on everyone — and cannot be armed at all. ‡",
  generatorOn: "Whether the generator is running right now. Switching it on with an empty tank does nothing. ‡",
  turretArmed: "Whether the turret is live. It only fires when the generator is also running. ‡",
  fuelMax: "How much the tank holds. Fuel fed in past this is wasted, not banked. ‡",
  fuelBurnPerTurn: "Units burned each turn the generator runs. Tank size divided by this is how many turns a full tank lasts. ‡",
  coalFuel: "Units of fuel one Coal is worth. ‡",
  saltpeterFuel: "Units of fuel one Saltpeter is worth. Deliberately worse than coal — it is the fallback, not the plan. ‡",
  shuttleMaxTurns: "How many turns the shuttle sits on the pad before flying back on its own, loaded or not. ‡",
  shuttleCooldown: "Turns that must pass after it lands before it can be sent back up. ‡",
  creditCapObols: "The ceiling on the Company's credit line, in obols. ‡",
  turretTable:
    "The turret's severity odds, one column per armour tier. Each column must sum to exactly 1, and the save is refused if any does not. Severities: graze, minor-wound, deep-wound, grievous-wound, dying, dead. ‡",
};
