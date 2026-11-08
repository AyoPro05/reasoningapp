import type { PrivateQuestion } from '@reasoningapp/question-validation';

export const pendingReview = () => ({ status: 'PENDING' as const, reviewerId: null, reviewedAt: null });

/** Authoring helper only. All sample records remain unreviewed and ineligible for publication. */
export function fixture(categoryId: PrivateQuestion['categoryId'], number: number, fields: Pick<PrivateQuestion, 'skillId' | 'stimulus' | 'options' | 'correctOptionKey' | 'diagram' | 'assumptions'> & {
  explanation: string; steps: string[]; rationales: Record<string, string>; hints: [string, string, string];
} & Partial<Pick<PrivateQuestion, 'numerical' | 'logical' | 'sequence'>>): PrivateQuestion {
  const { explanation, steps, rationales, hints, ...rest } = fields;
  return {
    id: `dev-${categoryId}-${number}-v1`, questionId: `dev-${categoryId}-${number}`, version: 1, categoryId,
    contentState: 'DEVELOPMENT', provenance: { kind: 'ORIGINAL_DEVELOPMENT', author: 'ReasoningApp development authoring', source: 'Original sample written for this repository; no employer or third-party test material.' },
    review: pendingReview(), ...rest,
    explanation: { version: 1, shortText: explanation, workedSteps: steps, distractorRationales: rationales, review: pendingReview() },
    hints: hints.map((text, index) => ({ stage: index + 1, text, review: pendingReview() })),
  };
}

export const options = (...texts: string[]) => texts.map((text, index) => ({ key: String.fromCharCode(97 + index), text }));
