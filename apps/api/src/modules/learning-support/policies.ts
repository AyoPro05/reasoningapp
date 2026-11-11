import type { AppConfig } from '@reasoningapp/config';
import { isContentEligible } from '@reasoningapp/database';

export type SupportAction = 'HINT' | 'EXPLANATION' | 'WORKED_STEPS' | 'DISTRACTOR' | 'CLARIFY_TERM' | 'RELATED_PRACTICE';
export type SupportStage = 'BEFORE_ANSWER' | 'AFTER_ANSWER' | 'AFTER_SCORING' | 'WORKED_EXAMPLE';
export const MAX_SESSION_ITEMS = 200;
export const untimedModes: readonly string[] = ['LEARN', 'PRACTICE', 'REVIEW'];

/** Retirement affects new selection; pinned historical approved solutions survive it. */
export function historicalContentAllowed(state: string, config: AppConfig) {
  return state === 'RETIRED' || isContentEligible(state, config);
}
export function instructionalContentAllowed(state: string, content: { reviewStatus: string; publishedAt: Date | null }, config: AppConfig) {
  return state === 'DEVELOPMENT' ? isContentEligible(state, config) :
    ['PUBLISHED', 'RETIRED'].includes(state) && content.reviewStatus === 'APPROVED' &&
      content.publishedAt !== null && content.publishedAt.getTime() <= Date.now();
}
