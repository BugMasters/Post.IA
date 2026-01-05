export type GenerateVariant = { label: string; content: string };

type GenerateSuccess = { ok: true; variants: GenerateVariant[] };

type GenerateFailure = { ok: false; error: string };

export type GenerateResult = GenerateSuccess | GenerateFailure;
