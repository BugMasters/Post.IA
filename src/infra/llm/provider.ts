export interface LlmProvider {
  generateText(prompt: string): Promise<string>;
}
