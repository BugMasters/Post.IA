// Teto global de timeout para caber no limite de execução da plataforma de
// deploy (ex.: Vercel Hobby mata a função em 60s). Quando `LLM_MAX_TIMEOUT_MS`
// está definido e é válido, nenhuma chamada LLM pode pedir mais que esse teto —
// mesmo que a action passe um timeout maior por comprimento (LONGO = 120s).
// Sem a env (dev local), retorna o valor original sem cap.
export function applyTimeoutCeiling(
  timeoutMs: number,
  rawCeiling: string | undefined
): number {
  const trimmed = rawCeiling?.trim();
  if (!trimmed) {
    return timeoutMs;
  }
  const ceiling = Number(trimmed);
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return timeoutMs;
  }
  return Math.min(timeoutMs, ceiling);
}
