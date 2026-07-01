export type LlmRequestOptions = {
  maxTokens?: number;
  timeoutMs?: number;
};

export type LlmErrorCode = "LLM_TIMEOUT";

export class LlmProviderError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmProviderError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface LlmProvider {
  generateText(prompt: string, requestOptions?: LlmRequestOptions): Promise<string>;
}
