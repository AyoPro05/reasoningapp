/** Private server package. Never import from a client or return this input as a DTO. */
export interface ScorableVersion {
  readonly options: readonly { readonly key: string; readonly text: string }[];
  readonly correctOptionKey: string;
}

export function scoreOption(version: ScorableVersion, optionKey: string): { correct: boolean } {
  const keys = new Set(version.options.map((option) => option.key));
  if (keys.size !== version.options.length || !keys.has(version.correctOptionKey)) throw new Error('Invalid private answer key');
  if (!keys.has(optionKey)) throw new Error('Option does not belong to this question version');
  return { correct: optionKey === version.correctOptionKey };
}
