export type LlmRequestOptions = {
  num_predict?: number;
  num_ctx?: number;
  temperature?: number;
  top_p?: number;
};

export interface LlmProvider {
  generateText(prompt: string, options?: LlmRequestOptions): Promise<string>;
}
