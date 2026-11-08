import type { DatabaseClient } from '@reasoningapp/database';
import { AccessError } from '../auth/authorization.js';

export function createEntitlementService(db: DatabaseClient) {
  return {
    async requirePracticeAccess(userId: string): Promise<void> {
      const now = new Date();
      const active = await db.entitlement.findFirst({
        where: { userId, key: 'practice', status: 'ACTIVE', revokedAt: null,
          startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true },
      });
      if (!active) throw new AccessError(403, 'FORBIDDEN');
    },
  };
}
