import { z } from 'zod';
import { QuestionDiagram } from '@reasoningapp/question-render-spec';
import { CategoryId, ContentLabel, OpaqueId, OptionKey } from './session.js';

export const CategoryCatalogDto = z.strictObject({ categories: z.array(z.strictObject({
  id: CategoryId, titleKey: z.string().min(1),
})).max(5) });
export type CategoryCatalogDto = z.infer<typeof CategoryCatalogDto>;

/** A lesson example has its own release DTO; it is never a practice-session item. */
export const LessonDto = z.strictObject({
  id: OpaqueId, categoryId: CategoryId, skillId: OpaqueId,
  title: z.string().min(1), body: z.string().min(1), contentLabel: ContentLabel,
  workedExample: z.strictObject({
    questionVersionId: OpaqueId, stimulus: z.string().min(1).max(20_000), diagram: QuestionDiagram.nullable(),
    options: z.array(z.strictObject({ key: OptionKey, text: z.string().min(1).max(5_000) })).min(2).max(10),
    categoryId: CategoryId, skillId: OpaqueId, contentLabel: ContentLabel,
    feedback: z.strictObject({
      release: z.literal('WORKED_EXAMPLE'), correctOptionKey: OptionKey,
      explanation: z.string().min(1).max(10_000), steps: z.array(z.string().min(1).max(10_000)).min(1).max(20),
    }),
  }),
});
export type LessonDto = z.infer<typeof LessonDto>;
export const LessonsDto = z.strictObject({ lessons: z.array(LessonDto) });
export type LessonsDto = z.infer<typeof LessonsDto>;
