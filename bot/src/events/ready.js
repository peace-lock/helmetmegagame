const cron = require("node-cron");
const { ActivityType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { syncNicknamesForGuild } = require("../lib/nickname");
const { advanceTurn } = require("../lib/turnEngine");
const { ensureLocationPrompt } = require("../lib/location");
const { refreshLocationChannels } = require("../lib/channels");
const { registerCommands } = require("../lib/commands");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
      activities: [{ name: "status", type: ActivityType.Custom, state: "» Message me to contact the GMs." }],
      status: "online",
    });

    await prisma.gameConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    await refreshLocationChannels().catch((err) => console.error("Failed to refresh location channels:", err));

    for (const guild of client.guilds.cache.values()) {
      await syncNicknamesForGuild(guild).catch((err) => console.error("Failed to sync nicknames:", err));
      await ensureLocationPrompt(guild).catch((err) => console.error("Failed to ensure location prompt:", err));
      await registerCommands(guild).catch((err) => console.error("Failed to register slash commands:", err));
    }

    const runAdvanceTurn = () => {
      advanceTurn()
        .then((turn) =>
          // Null when a GM's Dev Panel advance won the race — the turn moved,
          // just not here. Not a failure, so don't log it as one.
          console.log(turn ? `Turn advanced to #${turn.number} (${turn.phase})` : "Turn already advanced elsewhere; skipped."),
        )
        .catch((err) => console.error("Failed to advance turn:", err));
    };
    cron.schedule("0 4 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
    cron.schedule("0 16 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
  },
};
