import { z } from 'zod';
import { QuestionDiagram } from '@reasoningapp/question-render-spec';
import { CategoryId, OptionKey, OpaqueId } from '@reasoningapp/contracts';
import { validateHints } from './hint-validation.js';
import type { ValidationIssue } from './hint-validation.js';
export type { ValidationIssue } from './hint-validation.js';

const Text = z.string().trim().min(1).max(20_000);
export const ReviewMetadata = z.strictObject({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']), reviewerId: OpaqueId.nullable(), reviewedAt: z.iso.datetime().nullable(),
}).refine(r => r.status === 'PENDING' ? r.reviewerId === null && r.reviewedAt === null : r.reviewerId !== null && r.reviewedAt !== null,
  { message: 'Review decisions need an identified reviewer and timestamp; pending records have neither.' });

export const PrivateQuestionSchema = z.strictObject({
  id: OpaqueId, questionId: OpaqueId, version: z.number().int().positive(), categoryId: CategoryId, skillId: OpaqueId,
  stimulus: Text, diagram: QuestionDiagram.nullable(),
  options: z.array(z.strictObject({ key: OptionKey, text: Text })).min(2).max(10), correctOptionKey: OptionKey,
  explanation: z.strictObject({ version: z.number().int().positive(), shortText: Text, workedSteps: z.array(Text).min(1), distractorRationales: z.record(OptionKey, Text), review: ReviewMetadata }),
  hints: z.array(z.strictObject({ stage: z.number().int().min(1).max(3), text: Text, review: ReviewMetadata })),
  provenance: z.strictObject({ kind: z.enum(['ORIGINAL_DEVELOPMENT', 'ORIGINAL']), author: Text, source: Text }),
  review: ReviewMetadata, contentState: z.enum(['DEVELOPMENT', 'DRAFT', 'VALIDATION', 'SUBJECT_REVIEW', 'EDITORIAL_APPROVAL', 'PUBLISHED', 'RETIRED']),
  assumptions: z.array(Text).min(1),
  numerical: z.strictObject({ units: Text, rounding: Text, reviewStatus: z.enum(['PENDING', 'APPROVED']) }).optional(),
  sequence: z.strictObject({ fullRule: Text, transitions: z.array(Text).min(1), alternativeAnswerReview: z.enum(['PENDING', 'APPROVED']) }).optional(),
  logical: z.strictObject({ boundary: z.enum(['DEDUCTIVE_ENTAILMENT', 'CONDITIONAL', 'ORDERING']), rationale: Text }).optional(),
});
export type PrivateQuestion = z.infer<typeof PrivateQuestionSchema>;

export function validateQuestion(input: unknown): ValidationIssue[] {
  const parsed = PrivateQuestionSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map(i => ({ code: 'STRUCTURE', path: i.path.join('.'), message: i.message, severity: 'ERROR' }));
  const q = parsed.data;
  const issues: ValidationIssue[] = [];
  const reject = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: 'ERROR' });
  const keys = new Set(q.options.map(o => o.key));
  if (keys.size !== q.options.length) reject('DUPLICATE_OPTION', 'options', 'Option keys must be unique.');
  if (!keys.has(q.correctOptionKey)) reject('KEY_MEMBERSHIP', 'correctOptionKey', 'Key must belong to this version.');
  if (q.options.some(o => o.key !== q.correctOptionKey && !q.explanation.distractorRationales[o.key]) ||
      Object.keys(q.explanation.distractorRationales).some(k => !keys.has(k) || k === q.correctOptionKey)) {
    reject('DISTRACTOR_RATIONALES', 'explanation', 'Explain every distractor, and only distractors.');
  }
  issues.push(...validateHints(q.hints, q.options.find(o => o.key === q.correctOptionKey)?.text ?? ''));
  if (q.categoryId === 'verbal' && !q.options.some(o => o.text === 'Cannot Say')) reject('VERBAL_CANNOT_SAY', 'options', 'Include Cannot Say.');
  if (q.categoryId === 'numerical' && (!q.numerical || !q.stimulus.includes(q.numerical.units) || !q.stimulus.includes(q.numerical.rounding))) reject('NUMERICAL_UNITS', 'numerical', 'State units and rounding in the stimulus.');
  if (q.categoryId === 'mechanical' && (q.diagram?.kind !== 'mechanical' || !q.diagram.assumptions.every(a => q.assumptions.includes(a)))) reject('MECHANICAL_ASSUMPTIONS', 'diagram', 'Mechanical diagrams must carry the stated physical assumptions.');
  if (q.categoryId === 'inductive' && (!q.sequence || q.diagram?.kind !== 'sequence' || q.sequence.transitions.length !== q.diagram.cells.length - 1)) reject('FULL_SEQUENCE_RULE', 'sequence', 'Explain each transition including the missing term.');
  if (q.categoryId === 'logical' && !q.logical) reject('LOGICAL_BOUNDARY', 'logical', 'Declare the specific reasoning skill boundary.');
  if (q.contentState === 'DEVELOPMENT' && (q.provenance.kind !== 'ORIGINAL_DEVELOPMENT' || [q.review, q.explanation.review, ...q.hints.map(h => h.review)].some(r => r.status !== 'PENDING'))) reject('DEVELOPMENT_REVIEW', 'review', 'Development fixtures cannot claim review approval.');
  if (q.contentState === 'DEVELOPMENT' && (q.numerical?.reviewStatus === 'APPROVED' || q.sequence?.alternativeAnswerReview === 'APPROVED')) reject('DEVELOPMENT_REVIEW', 'review', 'Numeric and alternative-answer review remain pending for development fixtures.');
  if (q.contentState === 'PUBLISHED' && (q.provenance.kind === 'ORIGINAL_DEVELOPMENT' || [q.review, q.explanation.review, ...q.hints.map(h => h.review)].some(r => r.status !== 'APPROVED'))) reject('PUBLICATION_REVIEW', 'review', 'Published content requires independent approved review.');
  return issues;
}
