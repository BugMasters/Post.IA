export type LlmRequestOptions = {
  num_predict?: number;
  num_ctx?: number;
  temperature?: number;
  top_p?: number;
  timeoutMs?: number;
};

export type LlmResponse = {
  text: string;
  doneReason?: string;
};

export interface LlmProvider {
  generateText(prompt: string, options?: LlmRequestOptions): Promise<LlmResponse>;
}
