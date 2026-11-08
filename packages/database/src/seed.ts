import { createHash } from 'node:crypto';
import type { AppConfig } from '@reasoningapp/config';
import { validateQuestion } from '@reasoningapp/question-validation';
import { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';
import { assertDevelopmentSeedAllowed } from './content-policy.js';
import { developmentQuestions, developmentLessons } from './fixtures/index.js';

const categories = ['inductive', 'logical', 'numerical', 'verbal', 'mechanical'] as const;
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Idempotent insert-only sample seed. Existing source fingerprints are checked, never overwritten.
 * User/accounts/entitlements belong to Task 3; this does not create a verified user.
 */
export async function seedDevelopment(db: DatabaseClient, config: AppConfig): Promise<void> {
  assertDevelopmentSeedAllowed(config);
  for (const question of developmentQuestions) {
    const issues = validateQuestion(question);
    if (issues.length) throw new Error(`Invalid development fixture ${question.id}: ${issues.map(i => i.code).join(', ')}`);
  }
  await db.$transaction(async tx => {
    // Concurrent seeds serialize; this lock is local to this transaction and database.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20411, 2)`;
    for (const [position, id] of categories.entries()) {
      await tx.category.upsert({ where: { id }, update: {}, create: { id, titleKey: `categories.${id}.title`, position } });
    }
    for (const question of developmentQuestions) {
      await tx.skill.upsert({ where: { id: question.skillId }, update: {}, create: { id: question.skillId, titleKey: `skills.${question.skillId}.title`, templateTags: [question.categoryId, question.skillId] } });
      await tx.categorySkill.upsert({ where: { categoryId_skillId: { categoryId: question.categoryId, skillId: question.skillId } }, update: {}, create: { categoryId: question.categoryId, skillId: question.skillId } });
      const existing = await tx.questionVersion.findUnique({ where: { id: question.id } });
      const sourceHash = fingerprint(question);
      if (existing) {
        const notes = existing.authoringNotes as { sourceHash?: string } | null;
        if (existing.contentState !== 'DEVELOPMENT' || notes?.sourceHash !== sourceHash) throw new Error(`Seed conflict for ${question.id}; create a new immutable version instead`);
        continue;
      }
      await tx.question.upsert({ where: { id: question.questionId }, update: {}, create: { id: question.questionId, categoryId: question.categoryId } });
      await tx.questionVersion.create({ data: {
        id: question.id, questionId: question.questionId, version: question.version, stimulus: question.stimulus,
        diagram: question.diagram ?? Prisma.DbNull, assumptions: question.assumptions, provenance: question.provenance,
        authoringNotes: { sourceHash, ...(question.numerical ? { numerical: question.numerical } : {}), ...(question.sequence ? { sequence: question.sequence } : {}), ...(question.logical ? { logical: question.logical } : {}) },
        contentState: 'DEVELOPMENT',
        options: { create: question.options.map((option, position) => ({ optionKey: option.key, text: option.text, position })) },
        skills: { create: { skillId: question.skillId, primary: true } },
        reviews: { create: ['SUBJECT', 'EDITORIAL', 'HINT_DISCLOSURE', ...(question.numerical ? ['NUMERICAL'] : []), ...(question.sequence ? ['ALTERNATIVE_SEQUENCE_RULES'] : [])].map(stage => ({ stage, status: 'PENDING' })) },
        hints: { create: question.hints.map(hint => ({ stage: hint.stage, text: hint.text, reviewStatus: 'PENDING' })) },
        explanations: { create: { version: question.explanation.version, shortText: question.explanation.shortText, workedSteps: question.explanation.workedSteps, distractorRationales: question.explanation.distractorRationales, reviewStatus: 'PENDING' } },
      } });
      await tx.answerKey.create({ data: { questionVersionId: question.id, optionKey: question.correctOptionKey } });
    }
    for (const lesson of developmentLessons) {
      const question = developmentQuestions.find(q => q.id === lesson.workedExampleQuestionVersionId)!;
      const data = { ...lesson, skillId: question.skillId };
      const existing = await tx.lesson.findUnique({ where: { id: lesson.id } });
      if (existing) {
        if (existing.contentState !== 'DEVELOPMENT' || existing.workedExampleQuestionVersionId !== data.workedExampleQuestionVersionId || existing.body !== data.body || existing.title !== data.title) throw new Error(`Seed conflict for ${lesson.id}`);
      } else {
        await tx.lesson.create({ data });
      }
    }
  }, { timeout: 30_000 });
}
