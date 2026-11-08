import type { Prisma } from './generated/prisma/client.js';

/** Private write boundary. Publication is a separate, deferred editorial workflow.
 * updateMany makes the eligibility check and write atomic; PostgreSQL triggers also
 * protect this tree against callers that bypass the service or race publication.
 */
export async function updateQuestionDraft(
  tx: Prisma.TransactionClient,
  id: string,
  patch: { stimulus?: string; assumptions?: string[] },
): Promise<void> {
  const result = await tx.questionVersion.updateMany({
    where: { id, contentState: { in: ['DEVELOPMENT', 'DRAFT', 'VALIDATION', 'SUBJECT_REVIEW', 'EDITORIAL_APPROVAL'] } }, data: patch,
  });
  if (result.count !== 1) throw new Error('Question version is missing or immutable');
}
