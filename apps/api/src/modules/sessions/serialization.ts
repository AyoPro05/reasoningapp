import { PublicSessionItem, SessionDto, SessionResultDto } from '@reasoningapp/contracts';
import type { Prisma } from '@reasoningapp/database';
import type { BankVersion, StoredItem, StoredSession } from './repository.js';

export function contentLabel(state: string) {
  return state === 'DEVELOPMENT'
    ? { kind: 'DEVELOPMENT' as const, labelKey: 'content.developmentUnreviewed' as const }
    : { kind: 'REVIEWED' as const, labelKey: 'content.reviewed' as const };
}

/** Only explicitly public presentation is projected; private authoring metadata never spreads.
 * Units/rounding already live in numerical stimulus. Assumptions belong before answering;
 * adding them as stimulus text also supports renderers that do not understand diagrams.
 */
export function presentation(version: Pick<BankVersion, 'id' | 'skills' | 'stimulus' | 'assumptions' | 'diagram' | 'question' | 'options' | 'contentState'>, optionOrder: readonly string[]) {
  const primary = version.skills.find(skill => skill.primary);
  if (!primary) throw new Error('Missing primary skill');
  return {
    questionVersionId: version.id,
    stimulus: version.assumptions.length ? `${version.stimulus}\n\n${version.assumptions.join('\n')}` : version.stimulus,
    diagram: version.diagram, categoryId: version.question.categoryId, skillId: primary.skillId,
    options: optionOrder.map(key => {
      const option = version.options.find(option => option.optionKey === key);
      if (!option) throw new Error('Invalid pinned option order');
      return { key: option.optionKey, text: option.text };
    }),
    contentLabel: contentLabel(version.contentState),
  };
}

export function serializeItem(item: StoredItem): PublicSessionItem {
  return PublicSessionItem.parse({
    ...presentation(item.questionVersion, item.optionOrder), sessionItemId: item.id,
    committedResponse: item.response ? { optionKey: item.response.optionKey, committedAt: item.response.submittedAt.toISOString() } : null,
  });
}

export function serializeSession(session: StoredSession): SessionDto {
  return SessionDto.parse({
    id: session.id, mode: session.mode, state: session.state, categoryId: session.categoryId,
    items: session.items.map(serializeItem), createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt?.toISOString() ?? null, submittedAt: session.submittedAt?.toISOString() ?? null,
    scoredAt: session.scoredAt?.toISOString() ?? null,
  });
}

export function serializeResult(result: Prisma.SessionResultGetPayload<object>): SessionResultDto {
  return SessionResultDto.parse({
    sessionId: result.sessionId, total: result.total, correct: result.correct,
    independentAttempts: result.independentAttempts, independentCorrect: result.independentCorrect,
    assistedAttempts: result.assistedAttempts, scoredAt: result.scoredAt.toISOString(),
  });
}
