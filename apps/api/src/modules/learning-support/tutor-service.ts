import { ProductError } from '../../errors.js';
import { authorizeSupport } from './authorization.js';
import type { SupportContext } from './context-builder.js';
import type { SupportAction } from './policies.js';

/** All permissions precede the kill switch. No solution load or provider call. */
export function disabledTutor(userId: string, context: SupportContext, action: SupportAction): never {
  authorizeSupport({ userId }, context.session, context.item, action);
  throw new ProductError('AI_DISABLED');
}
