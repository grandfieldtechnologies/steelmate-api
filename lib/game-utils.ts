import type { PlayerAction } from "@steelmate/engine";

export function actionsEqual(a: PlayerAction, b: PlayerAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function randomInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** PG `integer` is signed 32-bit; engine only needs a stable numeric seed. */
const PG_INT_MAX = 0x7fffffff;

export function randomSeed(): number {
  return Math.floor(Math.random() * (PG_INT_MAX + 1));
}
