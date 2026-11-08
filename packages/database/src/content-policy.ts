import type { AppConfig } from '@reasoningapp/config';

type ContentConfig = Pick<AppConfig, 'environment' | 'developmentFixturesEnabled' | 'allowUnreviewedContent'>;

export function assertDevelopmentSeedAllowed(config: ContentConfig): void {
  if (!['development', 'test'].includes(config.environment) || !config.developmentFixturesEnabled || !config.allowUnreviewedContent) {
    throw new Error('Development content requires explicit flags in development or test; production is forbidden');
  }
}

/** New-selection gate only. Ownership, entitlement, held-out and release checks remain mandatory.
 * Historical feedback for a retired, previously published pinned version needs its
 * own release policy; do not use this selector to silently remove old results.
 */
export function isContentEligible(contentState: string, config: ContentConfig): boolean {
  if (contentState === 'PUBLISHED') return true;
  return contentState === 'DEVELOPMENT' && ['development', 'test'].includes(config.environment) && config.developmentFixturesEnabled && config.allowUnreviewedContent;
}
