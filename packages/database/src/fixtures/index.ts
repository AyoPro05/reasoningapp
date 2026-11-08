import { inductive } from './inductive.js';
import { logical } from './logical.js';
import { numerical } from './numerical.js';
import { verbal } from './verbal.js';
import { mechanical } from './mechanical.js';

/** Private development bank. Never export via public contracts or client packages. */
export const developmentQuestions = [...inductive, ...logical, ...numerical, ...verbal, ...mechanical];

export const developmentLessons = [
  { categoryId: 'inductive', title: 'Track one property at a time', body: 'Compare shape, fill and marked orientation separately. Try a rule against every visible transition, then combine the properties. A short sequence can admit alternatives, so the intended rule and distractors need independent review.' },
  { categoryId: 'logical', title: 'Use only the premises', body: 'Represent each statement as an inclusion, exclusion, condition or ordering. Join statements through their shared terms. A condition does not automatically work in reverse, and some never means all. Avoid importing everyday assumptions.' },
  { categoryId: 'numerical', title: 'Keep the units in the calculation', body: 'Identify the requested quantity before choosing an operation. Write units alongside each value. For a rate, divide the measured quantity by elapsed time. Keep intermediate precision and apply the stated rounding rule only to the final answer.' },
  { categoryId: 'verbal', title: 'Separate evidence from a missing fact', body: 'Treat the passage as your entire evidence base. A supported claim is True, an incompatible claim is False, and a claim without enough evidence is Cannot Say. Missing information alone does not make a statement false.' },
  { categoryId: 'mechanical', title: 'State the ideal assumptions', body: 'Read the mechanism and its assumptions before calculating. For external gears, each mesh reverses direction. For levers, compare force times perpendicular distance. For ideal pulleys, count the rope segments that directly support the moving load.' },
].map(lesson => ({ ...lesson, id: `dev-lesson-${lesson.categoryId}`, contentState: 'DEVELOPMENT' as const,
  workedExampleQuestionVersionId: `dev-${lesson.categoryId}-1-v1`, solutionRelease: 'WORKED_EXAMPLE' as const }));
