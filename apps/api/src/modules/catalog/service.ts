import type { AppConfig } from '@reasoningapp/config';
import { CategoryCatalogDto, LessonDto, LessonsDto } from '@reasoningapp/contracts';
import { isContentEligible, type DatabaseClient } from '@reasoningapp/database';
import { versionInclude } from '../sessions/repository.js';
import { contentLabel, presentation } from '../sessions/serialization.js';
import { releasableExplanation } from '../sessions/service.js';

export function createCatalogService(db: DatabaseClient, config: AppConfig) {
  return {
    async categories() {
      const categories = await db.category.findMany({ orderBy: { position: 'asc' }, select: { id: true, titleKey: true } });
      return CategoryCatalogDto.parse({ categories });
    },
    lessons(categoryId: string) {
      return db.$transaction(async tx => {
        // Protect the designation and eligibility throughout release serialization.
        await tx.$queryRaw`SELECT v."id" FROM "Lesson" l JOIN "QuestionVersion" v ON v."id" = l."workedExampleQuestionVersionId" WHERE l."categoryId" = ${categoryId} ORDER BY v."id", l."id" FOR SHARE OF v, l`;
        const lessons = await tx.lesson.findMany({ where: { categoryId }, orderBy: { id: 'asc' }, include: { workedExample: { include: versionInclude } } });
        const released: LessonDto[] = [];
        for (const lesson of lessons) {
          const version = lesson.workedExample;
          if (!isContentEligible(lesson.contentState, config) || !isContentEligible(version.contentState, config) ||
              version.heldOutMock || lesson.solutionRelease !== 'WORKED_EXAMPLE' || version.question.categoryId !== categoryId) continue;
          const explanation = releasableExplanation(version);
          if (!version.answerKey || !explanation) continue;
          released.push(LessonDto.parse({
            id: lesson.id, categoryId: lesson.categoryId, skillId: lesson.skillId,
            title: lesson.title, body: lesson.body, contentLabel: contentLabel(lesson.contentState),
            workedExample: {
              ...presentation(version, version.options.map(option => option.optionKey)),
              feedback: { release: 'WORKED_EXAMPLE', correctOptionKey: version.answerKey.optionKey, explanation: explanation.shortText, steps: explanation.workedSteps },
            },
          }));
        }
        return LessonsDto.parse({ lessons: released });
      });
    },
  };
}
