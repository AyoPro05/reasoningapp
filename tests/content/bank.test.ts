import { describe, expect, test } from 'vitest';
import { developmentQuestions, developmentLessons } from '../../packages/database/src/fixtures/index.js';
import { validateQuestion } from '../../packages/question-validation/src/index.js';
import { scoreOption } from '../../packages/scoring-engine/src/index.js';

describe('original development bank', () => {
  test('has ten unreviewed versions in each category with complete private authoring records', () => {
    expect(developmentQuestions).toHaveLength(50);
    for (const category of ['inductive', 'logical', 'numerical', 'verbal', 'mechanical']) {
      expect(developmentQuestions.filter(q => q.categoryId === category)).toHaveLength(10);
    }
    expect(new Set(developmentQuestions.map(q => q.id)).size).toBe(50);
    expect(new Set(developmentQuestions.map(q => `${q.questionId}:${q.version}`)).size).toBe(50);
    for (const q of developmentQuestions) {
      expect(validateQuestion(q), q.id).toEqual([]);
      expect(q.contentState).toBe('DEVELOPMENT');
      expect(q.review).toEqual({ status: 'PENDING', reviewerId: null, reviewedAt: null });
      expect(q.explanation.review.status).toBe('PENDING');
      expect(q.hints.every(h => h.review.status === 'PENDING')).toBe(true);
      expect(scoreOption(q, q.correctOptionKey)).toEqual({ correct: true });
    }
  });

  test('offers five lessons with distinct explicitly designated worked examples', () => {
    expect(developmentLessons).toHaveLength(5);
    expect(new Set(developmentLessons.map(l => l.workedExampleQuestionVersionId)).size).toBe(5);
    for (const lesson of developmentLessons) {
      expect(lesson.solutionRelease).toBe('WORKED_EXAMPLE');
      const q = developmentQuestions.find(q => q.id === lesson.workedExampleQuestionVersionId);
      expect(q?.categoryId).toBe(lesson.categoryId);
      expect(lesson.body.length).toBeGreaterThan(80);
      expect(lesson.contentState).toBe('DEVELOPMENT');
    }
  });
});
