// Discord user IDs allowed onto the /gm/dev panel, independent of the
// in-game GM role — this is host/developer access, not a game permission.
export const SUPERADMIN_DISCORD_IDS = [
  "1507184027919057108",
  "262426987979735040",
];

export function isSuperadmin(discordUserId) {
  return !!discordUserId && SUPERADMIN_DISCORD_IDS.includes(discordUserId);
}
