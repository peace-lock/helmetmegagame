const { SlashCommandBuilder, InteractionContextType } = require("discord.js");

// Slash command definitions, registered GLOBALLY (see registerCommands) so
// they are usable in the bot's DMs as well as in the guild — a guild command
// cannot appear in a DM at all, whatever its contexts say. The cost is
// propagation: a new or renamed global command can take up to an hour to
// appear. That is a real change from the old per-guild registration, which
// was instant.
//
// Handlers live in bot/src/events/interactionCreate.js.

// Anything that needs a guild channel or thread to act on. Listing BotDM on
// these would put commands in the DM picker that can only ever refuse.
const GUILD_ONLY = [InteractionContextType.Guild];
const ANYWHERE = [InteractionContextType.Guild, InteractionContextType.BotDM];

const commandDefinitions = [
  // setMaxLength on both message options below. A Discord string option
  // defaults to a 6000-character maximum, and a Discord MESSAGE caps at 2000 —
  // so a GM could type 6000, have it accepted, and watch the send fail. Doing
  // it on the option means Discord refuses in the client, before the
  // interaction is ever dispatched, which is a better place to find out.
  new SlashCommandBuilder()
    .setName("gm")
    .setDescription("Speak in this channel as the bot itself (GM only).")
    .addStringOption((opt) =>
      opt.setName("message").setDescription("What to say").setRequired(true).setMaxLength(2000),
    )
    .addAttachmentOption((opt) => opt.setName("attachment").setDescription("Optional image/file to attach"))
    .setContexts(GUILD_ONLY),
  // Was /message. Renamed when /message became the player-facing "speak as
  // your character" command — one name could not be both, and /dm says what
  // this actually does.
  new SlashCommandBuilder()
    .setName("dm")
    .setDescription("DM a player as the bot itself (GM only).")
    .addUserOption((opt) => opt.setName("recipient").setDescription("Who to message").setRequired(true))
    // 1990 rather than 2000: sendDm prepends "» ", and the two characters it
    // adds land past the last place anyone was counting.
    .addStringOption((opt) =>
      opt.setName("message").setDescription("What to say").setRequired(true).setMaxLength(1990),
    )
    .setContexts(GUILD_ONLY),
  // Clears afflictions off a character with no cost, no skill check and no
  // co-location — deliberately NOT the player medic path (Heal request), which
  // has all three. A ROLE option for the same reason /add and /remove use one:
  // the picker names characters, never Discord accounts.
  new SlashCommandBuilder()
    .setName("heal")
    .setDescription("Clear afflictions off a character (GM only).")
    .addRoleOption((opt) => opt.setName("character").setDescription("Whose role to heal").setRequired(true))
    .setContexts(GUILD_ONLY),
  // The guest list of a Conversation, or of a private Room. A ROLE option
  // rather than a user option on
  // purpose: the picker then names characters, never Discord accounts, so
  // inviting someone can't reveal who plays them — the same reason the
  // personal role is the mentionable name token in the first place. The
  // handler resolves the role back to a Character and ignores anything that
  // isn't one (GM, spectator, player roles).
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Bring a character into this conversation or private room. ‡")
    .addRoleOption((opt) => opt.setName("character").setDescription("Whose role to add").setRequired(true))
    .setContexts(GUILD_ONLY),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Show a character out of this conversation or private room. ‡")
    .addRoleOption((opt) => opt.setName("character").setDescription("Whose role to remove").setRequired(true))
    .setContexts(GUILD_ONLY),

  // --- player commands, usable in a DM ---------------------------------

  // The twins of the three buttons on the #turns console
  // (bot/src/lib/turnsConsole.js). Each opens the same flow the button does.
  new SlashCommandBuilder()
    .setName("move")
    .setDescription("Lock in your Move for this turn.")
    .setContexts(ANYWHERE),
  new SlashCommandBuilder()
    .setName("location")
    .setDescription("Travel to a connected location. ‡")
    .setContexts(ANYWHERE),
  // A standing state, not a per-message one: it stays on until it is turned
  // off, so it needs to be reachable from a DM the same way /location is.
  new SlashCommandBuilder()
    .setName("conceal")
    .setDescription("Hide your name behind an anonymous alias. Use again to turn off.")
    .setContexts(ANYWHERE),
  // Run inside a channel you can speak in, this skips the destination picker
  // and posts there. Run anywhere else — including a DM — it asks where first.
  new SlashCommandBuilder()
    .setName("message")
    .setDescription("Say something as your character, without anyone seeing you type.")
    .setContexts(ANYWHERE),
  // Guild-only for the same reason /roll below is: an instrument played into a
  // DM has no audience, and the audience is the whole feature. The Instrument
  // tag is the gate; the Musician tag decides which of the two lines it plays.
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play your instrument, for the room to hear. ‡")
    .setContexts(GUILD_ONLY),
  // Guild-only: a die rolled in a DM has no audience, which is the whole
  // point of it. No options either — it is one 1d6 and nothing else.
  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a die in this channel, for everyone to see.")
    .setContexts(GUILD_ONLY),
].map((builder) => builder.toJSON());

// Global, not per-guild: a guild command is invisible in DMs no matter what
// contexts it declares. `set` is a full replace, so removing a command from
// the array above deregisters it with no cleanup step — which is how the four
// old labor commands go away.
async function registerCommands(client) {
  await client.application.commands.set(commandDefinitions);

  // The `set` above replaces the GLOBAL list only — it never touches a guild's
  // own list. So when registration moved from per-guild to global, everything
  // the old code had written into the guild was orphaned there, and Discord
  // showed both copies in the picker — including a command already retired
  // with no handler left to answer it, which is exactly what a removed
  // command looks like for the hour global propagation takes. Registration is
  // global, so the correct guild-scoped list is empty — sweep it every boot,
  // at one REST call per guild, and it cannot come back.
  for (const guild of client.guilds.cache.values()) {
    await client.application.commands.set([], guild.id);
  }
}

module.exports = { commandDefinitions, registerCommands };
