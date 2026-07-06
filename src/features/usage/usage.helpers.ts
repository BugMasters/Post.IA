// Brasil aboliu o horário de verão em 2019; São Paulo é UTC-3 fixo.
const SAO_PAULO_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;

export function startOfCurrentDaySaoPaulo(now: Date): Date {
  const local = new Date(now.getTime() + SAO_PAULO_UTC_OFFSET_MS);
  const startLocalUtcMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  return new Date(startLocalUtcMs - SAO_PAULO_UTC_OFFSET_MS);
}

export function resolveDailyLimit(
  raw: string | undefined,
  fallback: number
): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
