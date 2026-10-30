export const MATCH_REDIS_TTL_SEC = 300;
export const EQUIP_PHASE_SEC = 30;
export const ACTION_PHASE_SEC = 60;

export function phaseDeadlineMs(
  phase: "equip" | "action",
  now = Date.now(),
): number {
  const sec = phase === "equip" ? EQUIP_PHASE_SEC : ACTION_PHASE_SEC;
  return now + sec * 1000;
}
