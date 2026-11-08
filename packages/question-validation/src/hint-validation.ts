export interface ValidationIssue { code: string; path: string; message: string; severity: 'ERROR' | 'ADVISORY' }

/** Heuristic only: absence of a warning is never editorial approval. */
export function validateHints(hints: readonly { stage: number; text: string }[], answerText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (hints.length !== 3 || hints.some((hint, index) => hint.stage !== index + 1 || !hint.text.trim())) {
    issues.push({ code: 'HINT_STAGES', path: 'hints', message: 'Provide non-empty concept, relationship and partial-method stages in order.', severity: 'ERROR' });
  }
  for (const hint of hints) {
    if (/\b(answer|correct option)\s+(is|:)\s*/i.test(hint.text) ||
      (answerText.trim().length >= 4 && hint.text.toLowerCase().includes(answerText.toLowerCase()))) {
      issues.push({ code: 'HINT_DISCLOSURE', path: `hints.${hint.stage}`, message: 'Possible solution disclosure; independent human review required.', severity: 'ADVISORY' });
    }
  }
  return issues;
}
