import { fixture, options } from './shared.js';

const rows = [
  ['The museum opens at ten on Saturdays. The sculpture room closes at four. No opening time is given for Sundays.', 'The museum opens at ten on Sundays.', 'c', 'The passage supplies no Sunday opening time.', ['It transfers a Saturday fact to Sunday.', 'Absence of a Sunday time is not a contradiction.']],
  ['Every booklet in the green crate is printed on recycled paper. The blue crate contains maps, whose paper type is not stated.', 'All booklets in the green crate use recycled paper.', 'a', 'The claim directly restates the universal statement about the green crate.', ['It denies an explicit statement.', 'The required fact is explicitly supplied.']],
  ['The library trial ran for six weeks. It began in April and ended in May. The report does not discuss attendance.', 'The library trial lasted eight weeks.', 'b', 'Eight weeks contradicts the stated six-week duration.', ['It contradicts the duration in the passage.', 'The passage gives a definite incompatible duration.']],
  ['A bakery delivered bread to three cafés on Monday. Two cafés ordered rolls as well. The report does not identify which cafés ordered rolls.', 'The first café on the route ordered rolls.', 'c', 'The identities and route order are not provided.', ['The passage never identifies the roll buyers.', 'The passage does not exclude the first café either.']],
  ['The park survey counted twelve oak trees and seven lime trees. All counted trees were inside the park boundary.', 'The survey counted more oak trees than lime trees.', 'a', 'Twelve is greater than seven.', ['It reverses the numerical comparison.', 'The counts are given and determine the comparison.']],
  ['The workshop accepts bookings until Thursday noon. Bookings after that deadline are declined. Nia booked on Friday.', 'Nia booked before the deadline.', 'b', 'Friday is after the stated Thursday deadline.', ['It places Friday before Thursday.', 'The timing is specified and contradicts the claim.']],
  ['The research team recorded water temperatures at dawn for five days. Rainfall was not measured.', 'Rain fell on all five recording days.', 'c', 'Rainfall is outside the measurements reported.', ['No rainfall observations support the claim.', 'Lack of measurements does not prove there was a dry day.']],
  ['Each ticket for the evening concert includes a programme. Refreshments are sold separately.', 'Evening concert tickets include a programme.', 'a', 'The claim matches what each ticket includes.', ['It denies the ticket inclusion stated in the passage.', 'There is explicit evidence about programmes.']],
  ['The new cycle path is reserved for bicycles. Motor vehicles are prohibited along the entire path.', 'Motor vehicles are permitted on part of the new cycle path.', 'b', 'The entire-path prohibition excludes permission on any part.', ['It contradicts the universal prohibition.', 'The rule covers the whole path without exceptions.']],
  ['The club held two talks in June, one about local history and one about astronomy. Both took place indoors.', 'The astronomy talk attracted more visitors than the history talk.', 'c', 'No attendance figures or comparisons are reported.', ['Talk subjects do not establish attendance.', 'No evidence establishes the opposite attendance comparison.']],
] as const;

export const verbal = rows.map(([passage, claim, key, explanation, wrong], i) => {
  const opts = options('True', 'False', 'Cannot Say'), distractors = opts.filter(o => o.key !== key);
  return fixture('verbal', i + 1, { skillId: 'passage-entailment', stimulus: `${passage}\nClaim: ${claim}\nDecide using only the passage. True means entailed, False means contradicted, and Cannot Say means neither.`, diagram: null, options: opts, correctOptionKey: key,
    explanation, steps: ['Locate any passage statement bearing directly on the claim.', explanation], rationales: { [distractors[0]!.key]: wrong[0], [distractors[1]!.key]: wrong[1] },
    assumptions: ['Use only the passage, not outside knowledge.', 'A missing fact is not automatically a contradiction.'], hints: ['Separate the claim from the evidence in the passage.', 'Check for direct support, direct conflict or missing information.', 'Classify the evidence before selecting the matching response.'],
  });
});
