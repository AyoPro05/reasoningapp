import type { SessionMode, SessionState } from '@reasoningapp/contracts';
import { AccessError } from '../auth/authorization.js';
import { untimedModes, type SupportAction, type SupportStage } from './policies.js';

export type SupportSession = { id: string; userId: string; mode: SessionMode; state: SessionState; expiresAt: Date | null };
export type SupportItem = {
  id: string; userId: string; sessionId: string; questionVersionId: string; solutionRelease: SupportStage;
  response: { questionVersionId: string } | null;
};

/** Actor identity is maintained auth; all release conditions come from locked DB rows.
 * The enclosing owner transaction checks current entitlement, including on replay.
 */
export function authorizeSupport(actor: { userId: string }, session: SupportSession, item: SupportItem, action: SupportAction): { assistanceStage: SupportStage } {
  if (session.userId !== actor.userId || item.userId !== actor.userId || item.sessionId !== session.id ||
      !item.questionVersionId || (item.response && item.response.questionVersionId !== item.questionVersionId)) {
    throw new AccessError(404, 'NOT_FOUND');
  }
  const blocked = () => { throw new AccessError(403, 'FORBIDDEN'); };
  if (['EXPIRED', 'ABANDONED'].includes(session.state) ||
      (session.state !== 'SCORED' && session.expiresAt && session.expiresAt.getTime() <= Date.now())) return blocked();
  if (session.mode === 'MOCK' || session.mode === 'DAILY') {
    if (action === 'HINT' || session.state !== 'SCORED' || item.solutionRelease !== 'AFTER_SCORING') return blocked();
    return { assistanceStage: 'AFTER_SCORING' };
  }
  if (!untimedModes.includes(session.mode)) return blocked();
  if (action === 'HINT') {
    if (item.response || !['CREATED', 'IN_PROGRESS'].includes(session.state) || item.solutionRelease !== 'AFTER_ANSWER') return blocked();
    return { assistanceStage: 'BEFORE_ANSWER' };
  }
  if (item.solutionRelease === 'WORKED_EXAMPLE') {
    if (session.mode !== 'LEARN') return blocked();
    // The persisted release rule authorises the solution; this value records
    // when help was opened relative to the immutable response boundary.
    return { assistanceStage: session.state === 'SCORED' ? 'AFTER_SCORING' : item.response ? 'AFTER_ANSWER' : 'WORKED_EXAMPLE' };
  }
  if (item.solutionRelease === 'AFTER_SCORING') {
    if (session.state !== 'SCORED') return blocked();
    return { assistanceStage: 'AFTER_SCORING' };
  }
  if (!item.response) return blocked();
  return { assistanceStage: session.state === 'SCORED' ? 'AFTER_SCORING' : 'AFTER_ANSWER' };
}
