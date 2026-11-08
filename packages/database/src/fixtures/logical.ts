import { fixture, options } from './shared.js';

const rows = [
  ['All archive boxes are labelled. Box R is an archive box. What must follow?', ['Box R is labelled.', 'Every labelled box is an archive box.', 'Box R is unlabelled.'], 'a', 'DEDUCTIVE_ENTAILMENT', 'Membership in a subset carries the stated property.', 'Box R belongs to archive boxes.', 'Every archive box has a label.', 'Reverses the inclusion.', 'Contradicts the universal premise.'],
  ['If the amber lamp is lit, the fan runs. The fan is not running. What follows?', ['The lamp is lit.', 'The lamp is not lit.', 'The fan will run later.'], 'b', 'CONDITIONAL', 'Use contraposition of the given implication.', 'A lit lamp would require a running fan.', 'That necessary consequence is absent.', 'Contradicts the implication.', 'No future behaviour is specified.'],
  ['Mira is ahead of Noah. Noah is ahead of Owen. All three stand in one queue. Who is ahead of both others?', ['Owen', 'Noah', 'Mira'], 'c', 'ORDERING', 'Combine two strict ordering relations.', 'Mira precedes Noah.', 'Noah precedes Owen, so Mira precedes both.', 'Owen follows Noah.', 'Noah follows Mira.'],
  ['No brass tokens are magnetic. Token T is brass. What follows?', ['Token T is not magnetic.', 'All non-magnetic tokens are brass.', 'Token T is magnetic.'], 'a', 'DEDUCTIVE_ENTAILMENT', 'Apply a universal exclusion to one member.', 'Token T is inside the brass set.', 'That set has no magnetic members.', 'Reverses an exclusion into an unsupported classification.', 'Contradicts the exclusion.'],
  ['If a parcel is express, it has a blue tag. Parcel U has a blue tag. Which statement is justified?', ['Parcel U must be express.', 'Parcel U may or may not be express.', 'Parcel U cannot be express.'], 'b', 'CONDITIONAL', 'A consequence alone does not establish its antecedent.', 'Express status implies a blue tag.', 'The rule does not say that only express parcels have blue tags.', 'Affirms the consequent.', 'The rule allows express blue-tagged parcels.'],
  ['J is taller than K. L is shorter than K. Which order is tallest to shortest?', ['L, K, J', 'K, J, L', 'J, K, L'], 'c', 'ORDERING', 'Translate shorter-than into a consistent height ordering.', 'J is above K in height.', 'L is below K in height.', 'Reverses both height comparisons.', 'Places K above J against the first premise.'],
  ['Some studio members cycle. All cyclists wear helmets. What must follow?', ['Some studio members wear helmets.', 'All studio members cycle.', 'No studio members wear helmets.'], 'a', 'DEDUCTIVE_ENTAILMENT', 'Carry a property through an existential witness.', 'At least one member is a cyclist.', 'That cyclist must wear a helmet.', 'Changes some into all.', 'Contradicts the existence of a helmeted member.'],
  ['If a file is locked, it cannot be edited. File V can be edited. What follows?', ['File V is locked.', 'File V is not locked.', 'Every unlocked file can be edited.'], 'b', 'CONDITIONAL', 'Contrapose a conditional with a negative consequence.', 'A locked file would be uneditable.', 'The editable file cannot satisfy that antecedent.', 'Conflicts with the rule.', 'The rule gives no sufficient condition for editability.'],
  ['A shelf is above B. C is above A. Which shelf is lowest?', ['C', 'A', 'B'], 'c', 'ORDERING', 'Chain strict vertical relations without introducing distance.', 'C is above A.', 'A is above B, placing B at the bottom.', 'C is highest.', 'A has B below it.'],
  ['Every cedar plot is irrigated. No irrigated plot is abandoned. What follows?', ['No cedar plot is abandoned.', 'Every irrigated plot contains cedar.', 'Some cedar plots are abandoned.'], 'a', 'DEDUCTIVE_ENTAILMENT', 'Compose inclusion with exclusion; no existence claim is needed.', 'Cedar plots are a subset of irrigated plots.', 'The irrigated set has no abandoned plots.', 'Reverses subset inclusion.', 'Contradicts the exclusion if any such plot exists.'],
] as const;

export const logical = rows.map((r, i) => {
  const [stimulus, texts, key, boundary, explanation, step1, step2, wrong1, wrong2] = r;
  const distractors = options(...texts).filter(o => o.key !== key);
  return fixture('logical', i + 1, {
    skillId: `logic-${boundary.toLowerCase()}`, stimulus: `${stimulus} Use only the stated premises.`, diagram: null, options: options(...texts), correctOptionKey: key,
    assumptions: ['Treat the stated premises as true.', 'Do not infer unstated converses or real-world facts.'],
    explanation, steps: [step1, step2], rationales: { [distractors[0]!.key]: wrong1, [distractors[1]!.key]: wrong2 },
    hints: boundary === 'ORDERING' ? ['Identify the direction of each comparison.', 'Join comparisons through the shared person or object.', 'Write a single ordered line before choosing.'] : boundary === 'CONDITIONAL' ? ['Separate the condition from its consequence.', 'Check whether the evidence concerns the condition or the consequence.', 'Test the implication without assuming its converse.'] : ['Identify the sets or properties in the premises.', 'Connect the shared set across the two premises.', 'Apply only the stated inclusion or exclusion to the relevant member.'],
    logical: { boundary, rationale: explanation },
  });
});
