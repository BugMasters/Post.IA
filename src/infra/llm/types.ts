import type { LlmErrorCode } from "./provider";

export type GenerateVariant = { label: string; content: string };

type GenerateSuccess = { ok: true; variants: GenerateVariant[]; postId?: string };

type GenerateFailure = { ok: false; error: string; errorCode?: LlmErrorCode };

export type GenerateResult = GenerateSuccess | GenerateFailure;
