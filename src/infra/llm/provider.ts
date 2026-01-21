export type LlmRequestOptions = {
  maxTokens?: number;
  contextLimit?: number;
  num_predict?: number;
  num_ctx?: number;
  temperature?: number;
  topP?: number;
  top_p?: number;
  timeoutMs?: number;
  mode?: "default" | "draft" | "expand";
};

export type LlmResponse = {
  text: string;
  doneReason?: string;
};

export interface LlmProvider {
  generateText(prompt: string, options?: LlmRequestOptions): Promise<LlmResponse>;
}
