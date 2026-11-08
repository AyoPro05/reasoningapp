# Content policy

The repository contains ten original **DEVELOPMENT, unreviewed** question versions in each of inductive, logical, numerical, verbal and mechanical reasoning. All fifty have explicit original-development provenance, stable options, a private key, an explanation with worked steps and distractor rationales, and three authored hint stages. None has an independent reviewer, review timestamp, publication date or production eligibility. Numeric rounding review, alternative sequence-rule review and hint disclosure review are pending. Passing structural tests is not subject or editorial approval. The V3 checked-content development gate remains unmet.

## Private authoring and public delivery

`packages/contracts/src` is the authoritative public interface; `question-render-spec` owns diagrams and accessible alternatives. The database, question-validation and scoring-engine packages are server-only. Clients must never depend on them, their fixtures, generated Prisma browser exports or seed code. Learner strings live in content records; client UI labels must remain in the existing externalised string catalogue. Content uses UK English, metric units and GBP where relevant.

An API must explicitly project `PublicSessionItem`, including the ordered `{key,text}` options, opaque version/item IDs, category, skill and `{kind:'DEVELOPMENT', labelKey:'content.developmentUnreviewed'}`. Do not serialise Prisma rows or private validation inputs. Do not return the key, private explanation, authoring notes, source fingerprint, rationale, review identities or hints in the item DTO. `scoreOption` accepts a version's own options and key, rejects foreign options and malformed keys, and returns only `{correct}`. It does not authorise feedback release.

`FeedbackDto` is a separate release boundary. Task 4 must establish ownership, entitlement, content eligibility and the persisted release rule before projecting it. Committed practice responses may receive their own feedback; Mock and Daily require whole-session scoring. A pre-answer hint route may read only the next permitted authored stage and must record assistance atomically. It must not load a full solution into model context. AI is disabled.

## Development seed and lesson examples

Run the database seed through the validated runtime config. It requires `NODE_ENV=development` or `test`, `DEVELOPMENT_FIXTURES_ENABLED=true` and `ALLOW_UNREVIEWED_CONTENT=true`; mismatched `APP_ENV` is rejected by config. Production rejects bypass flags and the seed also independently rejects a production config before starting any database operation. No `DEV_SEED` alternative exists. `SEED_VERIFIED_USERS` does not affect this content seed: account creation, real verification and entitlements belong to Task 3. This task creates no verified users.

Seed writes are transactional, serialize through a transaction-scoped advisory lock, and insert only. Rerunning the same source is idempotent; an existing different source fingerprint or non-development state fails instead of overwriting. To revise a fixture, author a new immutable version and update explicit references; do not rewrite a used version or use reseeding as an update service. The source fingerprint identifies the committed authoring input, not an integrity signature or independent content review.

Five development lessons link to these designated worked examples:

- Inductive: `dev-inductive-1-v1`, tracking rotation separately from fill.
- Logical: `dev-logical-1-v1`, applying a universal premise to one member.
- Numerical: `dev-numerical-1-v1`, litres per minute.
- Verbal: `dev-verbal-1-v1`, distinguishing missing Sunday evidence.
- Mechanical: `dev-mechanical-1-v1`, direction through one external gear mesh.

Each lesson's `solutionRelease` is `WORKED_EXAMPLE`. That permission applies only to a designated example in a Learn item. It must never be inherited by a Practice item merely because the same question version appears in a lesson. The database rejects worked-example release outside Learn and rejects it for an unlinked version. Task 4 should exclude these five versions from ordinary practice selection so a previously revealed example does not count as new independent evidence. Remaining fixtures are development practice candidates, subject to the same ownership, mode and eligibility checks.

## Review and immutable history

The intended pipeline is Draft → Validation → Subject Review → Editorial Approval → Published → Monitor → Correct/Retire. Only approved originals can be published; original-development fixtures cannot be relabelled or promoted. Development question, hint and explanation decisions stay `PENDING` with null reviewer and timestamp. No generated or self-authored sample is presented as reviewed.

Before real publication, independent subject and editorial reviewers must check correctness, alternative answers, ambiguity, scope, accessible diagrams, units and rounding, physical assumptions, distractor rationales, and all hint stages. Inductive review must test the whole sequence and plausible alternatives. Logical review must keep entailment, conditionals and ordering distinct. Verbal review must distinguish contradiction from missing evidence and preserve Cannot Say. Mechanical diagrams are schematic; reviewers must verify that the drawing and accessible text agree with explicit ideal assumptions. Reviewers must be different from the identified author. No human review occurred in Task 2.

Hint 1 identifies a concept; hint 2 identifies a relationship; hint 3 supplies a partial method. Empty/misordered hints are structural errors. Obvious answer phrases or verbatim answer text produce advisory disclosure findings. These heuristics miss paraphrases, numeric derivations, elimination and visual leakage and may flag legitimate shared vocabulary. An absence of findings never establishes hint safety. Findings need independent human resolution before publication. The development seed rejects unresolved findings as a conservative local authoring check, without treating a clean result as approval.

SQL constraints and protected draft writes preserve published question trees, published hints/explanations and all question trees referenced by session items. Published versions may transition to Retired while retaining every historical field. Version identity, current response membership, pinned explanation version and option order are stored explicitly. `isContentEligible` is a new-selection gate: retired versions leave new selection, while historical feedback needs a separate ownership and release policy for its pinned, previously published version. Corrections require new versions and an audit/report trail; never silently regrade historical results. Database owners can bypass triggers, so runtime roles must not receive schema-owner privileges in production.

## Deferred workflows

The complete V3 models are schema foundations. Task 2 does not implement authentication routes, session state transitions, help/feedback APIs, progress updates or client screens. Device lease enforcement/transfers, broad editorial administration, Study Plans, full Mock/Daily products, achievements, billing/provider inbox processing, paid provisioning, production notifications/outbox workers, support operations and AI tutor execution remain deferred. Schemas, enums and foreign keys do not imply working products. No real recipients, payments, AI calls, publishing or deployment are enabled.
