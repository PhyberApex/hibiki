/** Reserved Output Target id for the Local Target (the GM's own speakers); Discord Targets use their guild id, a snowflake, so it can never collide. */
export const LOCAL_TARGET_ID = 'local'

export type OutputTargetKind = 'discord' | 'local'

export function isLocalTarget(targetId: string): boolean {
  return targetId === LOCAL_TARGET_ID
}

export function targetKind(targetId: string): OutputTargetKind {
  return isLocalTarget(targetId) ? 'local' : 'discord'
}
