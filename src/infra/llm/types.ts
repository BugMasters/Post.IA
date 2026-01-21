export type GenerateVariant = { label: string; content: string };

export type GenerateWarning = {
  label: string;
  reason: "TOO_SHORT";
  minChars: number;
  gotChars: number;
};

type GenerateSuccess = {
  ok: true;
  variants: GenerateVariant[];
  warnings?: GenerateWarning[];
};

type GenerateFailure = { ok: false; error: string };

export type GenerateResult = GenerateSuccess | GenerateFailure;
