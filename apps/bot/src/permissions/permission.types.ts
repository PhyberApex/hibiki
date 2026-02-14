/** Who can use the bot: allowlist of Discord role IDs and/or user IDs. */
export interface AllowlistConfig {
  allowedDiscordRoleIds: string[];
  allowedDiscordUserIds: string[];
}
