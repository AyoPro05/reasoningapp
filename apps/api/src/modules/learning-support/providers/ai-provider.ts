/** Future external boundary only. No provider is enabled or called in Task 5. */
export interface AiProvider { generate(context: unknown): Promise<unknown> }
export class DisabledAiProvider implements AiProvider {
  async generate(_context: unknown): Promise<never> { throw new Error('AI_DISABLED'); }
}
