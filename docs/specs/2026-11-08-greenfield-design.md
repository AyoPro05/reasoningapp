# ReasoningApp greenfield design

Date: 8 November 2026. Status: approved by the founder on 8 November 2026.

## Agreed scope

V3 is the sole specification revision to implement. There is no earlier app or repository. The founder selected approach A: establish the full monorepo and deliver Learn → Practice → results on web and native mobile with sample content in inductive, logical, numerical, verbal and mechanical reasoning. The working name is ReasoningApp. This workspace is the project root; the previously suggested Projects directory is superseded.

## First milestone

A learner signs in, browses the five categories, reads a short lesson and worked example, completes related practice and receives server-scored results. Each category has ten original development questions with stable options, private answer keys, explanations, three staged hints, explicit assumptions and provenance. Development material is visibly identified and isolated from production. It is not described as independently reviewed or published. The V3 checked-content development gate remains unmet until subject and editorial reviewers approve it; production never accepts this fixture bypass.

The learner can request permitted authored hints before committing an answer. Committed responses are immutable. Reviewed feedback follows each committed practice response; final results follow whole-session submission. Learn examples have explicit solution-release permission; practice questions never inherit that permission. Results include explanations, supported distractor notes, an optional self-reported mistake reason, different related practice and a three-line summary derived from actual attempts. With insufficient evidence, the summary says so.

Both clients share the same API, contracts, taxonomy and design tokens, while using separate native and web components. Mobile navigation is Home, Practice, Daily, Progress and Profile. Daily and Mock screens state that they are pending implementation. No chatbot tab is added. All learner strings are externalised UK English. Accessible focus, labels, touch targets, contrast, reduced motion, loading, retry, empty and error states are part of the slice. The visual direction is calm navy, blue and neutral surfaces, clear sans-serif typography and restrained motion.

## Architecture

The pnpm workspace contains apps/mobile (Expo), apps/web (Next.js), apps/api (Fastify) and apps/worker (BullMQ). Shared packages are contracts, database (Prisma/PostgreSQL), question-render-spec, question-validation, scoring-engine, design-tokens and config. Private content and scoring dependencies are forbidden in client dependency graphs. PostgreSQL is authoritative; Redis and an outbox support jobs. Docker Compose provides local services. Dependency versions and platform floors will be checked against official documentation before installation and recorded with a lockfile.

Use the V3 logical schema, with complete relations, foreign keys, uniqueness and indexes. Foundation models cover identity, immutable content, sessions, responses, support events, progress, review schedules and entitlements. The remaining V3 models are included in the schema with their runtime workflows explicitly deferred. Migrations include rollback guidance; no production migration runs during this milestone.

Use a maintained authentication library with database sessions. Web uses secure HTTP-only cookies and CSRF protection; native credentials use SecureStore. Select the concrete compatible library during planning. Account verification, recovery and revocation are implemented using a local mail sink; no messages go to real recipients. Verified development accounts and entitlements can be seeded only in explicit development mode. Auth bypasses fail closed in production. Never accept user identity from an unverified client header.

## Session and assistance integrity

The server owns session mode, item versions, option order, permissions and scoring. Sessions transition CREATED → IN_PROGRESS → SUBMITTED → SCORED, with EXPIRED and ABANDONED alternatives. Answer and submit operations use database transactions, uniqueness constraints and idempotency keys. Repeating an identical operation returns its original result; conflicting reuse is rejected. Submit and response writes serialize to prevent late answers changing a scored result. A database-enforced active-session constraint protects concurrent starts. Server deadlines control timed sessions; client timers only display remaining time.

Ownership and entitlement are checked on every session route, including hints, explanations, related items, summaries and tutor requests. Hints return only the next allowed authored stage and record assistance atomically. IN_PROGRESS mocks deny every help and solution route, including direct requests. Mock explanation release requires whole-session scoring under an after-scoring release rule. Scored Daily challenges deny help until completion. The milestone tests these policies without claiming that full Mock or Daily products exist.

Pre-answer assistance and post-answer review have distinct timestamps and event types. Independent first-attempt evidence remains identifiable after feedback is opened; any assisted activity is labelled and separated in progress. No employer-pass probability, percentile or unsupported mastery score is shown. Review scheduling uses documented configurable 1/3/7-day heuristics, lengthening after independent retrieval and imposing no missed-day penalty.

Only the server builds explanation context. Pre-answer routes cannot access a full solution context. Personal responses use no shared cache. Related-item selection uses approved relationships or skill tags, excludes the current item and held-out mock content, and returns an unavailable state if no eligible alternative exists. Development equivalents stay in the development bank. Question reports preserve the scored version and do not silently change results.

## AI, commerce and deferred work

AI is disabled. The provider interface and kill switch exist, but static explanations and authored hints deliver all learning support. The tutor route returns a structured disabled response and directs eligible users to static feedback. Provider selection, budgets and evaluation thresholds require later decisions before activation.

Live billing, paid provisioning, permanent device locks, store submission, deployment and production notifications are outside this milestone. Billing schemas and normalized entitlement contracts exist; the web provider ADR remains proposed. Full offline packs, broad editorial admin workflows, Daily/Mock UX, study plans, achievements and production automation are later increments. Mobile drafts may use SQLite, but the first milestone requires connectivity for authoritative scoring and does not claim offline session support.

The final brand, launch store order, audience/refund policies, production allowance, device transfer policy and hosting purchase remain founder decisions. These do not block local implementation.

## Verification and delivery evidence

Vitest covers scoring, assistance policy, version-safe context and review scheduling. Real PostgreSQL integration tests cover migrations, auth/session ownership, concurrent answers/submission, idempotency and progress. Direct API security tests cover cross-user/item access, pre-answer disclosure, mock gates, held-out content and production bypass rejection. Content validation covers all five banks, option/key consistency, numerical rounding, verbal Cannot Say, mechanical assumptions and hint structure; structural checks do not replace independent editorial review.

Playwright verifies the full web path, reload recovery, keyboard interaction and errors. Expo build/type checks and Maestro/device tests verify the native path where tools/devices are available. Unavailable device or infrastructure checks are recorded as gaps, never passes. Evidence must distinguish generated fixtures from reviewed content and compiled native code from an executed native flow.

Deliver runnable setup instructions, env examples, migrations, a dated tested platform matrix, decision log, architecture and learning/language/AI policies, test output and a release-blocker list. The first milestone is complete only when both clients execute the learner path against persistent server data and required checks pass; editorial and physical-device gaps remain explicit release blockers.

## Approval

Approach A, the learner path and this design were approved by the founder. Proceed to the detailed implementation plan; product code follows the plan execution handoff.
