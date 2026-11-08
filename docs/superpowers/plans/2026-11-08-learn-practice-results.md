# Learn → Practice → results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved, persistent Learn → Practice → results flow on web and Expo mobile across five reasoning categories.

**Architecture:** Fastify owns identity authorization, content release, scoring and session writes in PostgreSQL. Next.js and Expo share public contracts and tokens, never private keys or scoring imports. Redis/BullMQ processes a transactional outbox; AI stays disabled.

**Tech Stack:** pnpm, TypeScript, Next.js, Expo, Fastify, Prisma/PostgreSQL, Better Auth, Redis/BullMQ, Vitest, Playwright, Maestro.

**Spec:** `docs/specs/2026-11-08-greenfield-design.md`; governing requirements: `docs/specs/ReasoningApp-v3.md`.

## Global Constraints

- Work in the current workspace. No previous app exists. Create a local feature branch before implementation; do not push or provision services.
- Categories: inductive, logical, numerical, verbal, mechanical. All learner copy and templates use UK English, with externalised strings.
- Ten original development fixtures per category. No fixture is independently reviewed, published or production eligible. A production configuration cannot enable development content or bypass verification.
- Keep answer keys, private explanations and scoring server-only. Only explicitly authorized examples and committed/released responses receive solutions.
- Native Expo components and web components are separate. Shared packages expose framework-neutral public contracts, diagram descriptions and tokens.
- Core learning uses static content. AI, live billing, real recipients, paid provisioning, publication and production deployment remain disabled.
- Unimplemented V3 workflows must remain documented as deferred, even if their models exist.
- Use compatible stable dependencies, exact pins and a lockfile, following official documentation. Record actual verification, not claimed OS/device support.

## Review Focus

1. Concurrent starts, answer commits and submit retries must not produce duplicate activity or mutate a result (Task 4).
2. Session/item ID mixing and help requests before submission must not disclose another user's content or solutions (Tasks 4–5).
3. Post-answer review must preserve independent first-attempt evidence and record help separately (Task 5).
4. Production configuration must reject development fixture/verification bypasses, including environment combinations (Tasks 1–3).
5. Dropped network responses and client reloads must recover committed state without creating duplicate answers (Tasks 6–7).

## File responsibilities and public interfaces

`packages/contracts/src/` owns runtime schemas and their inferred DTOs. `question-render-spec` owns structured sequence/table/mechanical diagram data and accessible alternatives. `question-validation` validates private authoring inputs on the server. `scoring-engine` is private server code. `database` owns Prisma schema, migrations and development fixtures. `design-tokens` exposes colour, spacing and typography values. `config` validates runtime environments.

Public identifiers are opaque strings. `CategoryId` is the five category literal union. Modes are LEARN, PRACTICE, MOCK, DAILY, REVIEW; states are CREATED, IN_PROGRESS, SUBMITTED, SCORED, EXPIRED, ABANDONED. Public items contain `sessionItemId`, `questionVersionId`, `stimulus`, structured `diagram`, ordered `options: {key,text}[]`, `categoryId`, `skillId` and development-content label, with no key or explanation. Feedback is a distinct authorized DTO.

## Task 1: Workspace, shared contracts and safe configuration

**Files:** root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `.env.example`, `tsconfig.base.json`, `vitest.config.ts`, `.github/workflows/ci.yml`; `apps/{api,web,mobile,worker}/package.json`; `packages/*/package.json`; `packages/contracts/src/{index,session,learning-support}.ts`; `packages/question-render-spec/src/index.ts`; `packages/design-tokens/src/index.ts`; `packages/config/src/index.ts`; `infra/compose.yaml`; `tests/unit/config.test.ts`; `docs/platform-matrix.md`.

**Interfaces:** `readConfig(env): AppConfig` validates DB/Redis/auth URLs, origins, auth secret and environment. `AI_ASSISTANCE_ENABLED` is false; true is rejected until a provider rollout exists. Runtime schemas include `CreateSessionInput`, `CommitAnswerInput`, `SessionDto`, `FeedbackDto`, `ProgressDto` and `ApiErrorDto`.

- [x] Check official Node, Expo, Next.js, Prisma and Fastify requirements; choose a compatible supported Node LTS rather than assuming the installed Node 26 is appropriate. Pin dependencies; configure scripts `test`, `typecheck`, `build`, `test:integration`, `test:e2e`, `db:migrate`, `db:seed`.
- [x] Write configuration tests that reject production fixture/verification bypasses, missing secrets and unexpected origins. Run the tests and observe the missing implementation failure.
- [x] Implement environment schemas and public DTOs. Create all approved workspace packages, local PostgreSQL/Redis/Mailpit services, and CI using isolated test databases with fake email only.
- [x] Run `pnpm test tests/unit/config.test.ts`, `pnpm typecheck` and `docker compose -f infra/compose.yaml config`; expect passing tests, zero type errors and valid Compose. Commit the verified foundation.

## Task 2: Persistent schema and original development content

**Files:** `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/*/migration.sql`, `packages/database/src/{client,seed}.ts`, `packages/database/src/fixtures/{inductive,logical,numerical,verbal,mechanical}.ts`; `packages/question-validation/src/{index,hint-validation}.ts`; `packages/scoring-engine/src/index.ts`; `tests/content/bank.test.ts`; `tests/integration/database.test.ts`; `docs/{content-policy,migrations}.md`.

**Interfaces:** `scoreOption(questionVersion, optionKey): {correct:boolean}` accepts only an option belonging to the immutable version; unknown options throw. `validateQuestion(input): ValidationIssue[]` verifies options, key, explanation, provenance, assumptions and three ordered hint stages. Database exports one Prisma client factory. Content state includes explicit development fixtures separately from publishable records.

- [x] Write failing tests for exactly 10 fixtures/category, option-key membership, unique versions, verbal Cannot Say, explicit numerical units/rounding, mechanical assumptions, full sequence rules, logical skill boundaries and empty/disclosing hints. Structural detection of hint leakage is advisory; document human review requirements.
- [x] Implement the complete V3 logical schema and Better Auth-required account/verification/session relations, mapping AuthSession deliberately. Include approved hint/explanation versions, assistance events and audit/report models. Add the specified unique constraints and foreign keys plus a PostgreSQL partial unique index for one active session/user. Define row-locking strategy and idempotency storage for Task 4.
- [x] Author all 50 original fixtures plus five lessons/worked examples. Fixtures use explicit provenance and never fabricated reviewer metadata. Seed only in development/test. Preserve immutable published content through protected write services and tests.
- [x] Generate and apply the migration to a disposable real PostgreSQL database; validate relations, uniqueness, active-session constraint and fixture production rejection. Run `pnpm test tests/content`, `pnpm test:integration -- database`, and Prisma validation; expect all passing. Document rollback limitations and commit.

## Task 3: Maintained auth, entitlement and safe local automation

**Files:** `apps/api/src/{app,server}.ts`; `apps/api/src/modules/auth/{auth,authorization,mail}.ts`; `apps/api/src/modules/entitlements/service.ts`; `apps/worker/src/{index,outbox}.ts`; `tests/integration/{auth,outbox}.test.ts`; `docs/authentication.md`.

**Interfaces:** `buildApp(deps): Promise<FastifyInstance>` supports injected real test DB and fake mail provider. `requireLearner(request): Promise<{userId:string}>` authenticates verified sessions. `requirePracticeAccess(userId): Promise<void>` checks server entitlements. Auth mounts at `/api/auth/*`; product routes use `/v1`. Native uses Better Auth's Expo plugin/SecureStore, web uses HTTP-only cookies and trusted-origin/CSRF protection.

- [ ] Write and run failing real-DB tests for register, verification, sign-in/out, recovery, revoked sessions, unverified access, forged identity headers, blocked origins and cross-user access.
- [ ] Integrate Better Auth's Prisma adapter and Expo plugin using official integration documentation. Explicitly configure cookie flags, trusted origins, body limits, rate limiting and secret redaction. Use a same-origin web proxy to the API; document LAN native configuration without disabling origin protections.
- [ ] Persist verification/recovery/welcome outbox messages transactionally where supported; document any library-hook boundary and test retry recovery. Worker claims rows safely, uses stable delivery/dedupe IDs and delivers to Mailpit/fake providers only. Real provider configuration is rejected in this slice.
- [ ] Test entitlements and development-only verified seeding; outbox retries must not duplicate deliveries. Run `pnpm test:integration -- auth outbox` and `pnpm typecheck`; expect all passing. Commit.

## Task 4: Catalog, practice engine and private server scoring

**Files:** `apps/api/src/modules/catalog/{routes,service}.ts`; `apps/api/src/modules/sessions/{routes,service,repository,serialization}.ts`; `tests/integration/sessions.test.ts`; `tests/security/session-access.test.ts`.

**Interfaces:** `GET /v1/categories`; `GET /v1/lessons/:categoryId` releases only the designated worked example; `POST /v1/sessions {categoryId,mode}`; `GET /v1/sessions/:id`; `POST /v1/sessions/:id/items/:itemId/answer {optionKey,selfReportedReason?}`; `POST /v1/sessions/:id/submit`; `GET /v1/sessions/:id/results`. Mutation requests require `Idempotency-Key`. Successful committed responses are immutable; conflicting changes return 409. Missing/foreign owned resources return uniform 404. Invalid payloads return 400, blocked operations 403. Session hydration returns committed selected options without leaking keys for unreleased items.

- [ ] Write failing tests for create/hydrate/commit/submit, invalid option/version, cross-user and mixed-session IDs, identical retries, conflicting idempotency reuse and zero-answer submission. Reject incomplete submission with 409; never fabricate results.
- [ ] Implement deterministic selection from the eligible bank, immutable version/option ordering snapshots, serializable writes or per-session locks, and persist response/result plus outbox events atomically. Grade private keys server-side. Mock/Daily creation is not exposed to public clients yet; policy tests may create their records through test DB setup.
- [ ] Exercise concurrent starts, answer-vs-submit races and duplicate submissions against real PostgreSQL; only one valid result may persist. Ensure late responses cannot alter SCORED sessions. Deadline expiration follows server time with no client-controlled reveal flags.
- [ ] Run `pnpm test:integration -- sessions` and `pnpm test tests/security/session-access.test.ts`; expect all passing, and inspect serialized pre-answer responses for solution/key leakage. Commit.

## Task 5: Static learning support, progress and review

**Files:** `apps/api/src/modules/learning-support/{authorization,context-builder,hint-service,tutor-service,related-item-selector,policies,routes}.ts`; `apps/api/src/modules/learning-support/providers/ai-provider.ts`; `apps/api/src/modules/personalization/{review-scheduler,progress,learning-summary}.ts`; `tests/{unit,security,integration}/learning-support.test.ts`.

**Interfaces:** V3's hints/explanation/tutor/related-practice routes and session learning-summary route; `GET /v1/progress`; `POST /v1/question-reports`. `authorizeSupport(actor,session,item,action)` derives permission exclusively from persisted state. `nextReview(outcome,previousInterval,now)` uses 1/3/7 days, repeating the first interval on an independent miss; no missed-day penalty. `getLearningSummary(sessionId,userId)` returns improved/revisit/nextAction text and evidence counts.

- [ ] Write and run failing tests for every action in each mode/state, mock active help blocking, whole-mock release, no pre-answer solution context, unknown item versions, hint-stage exhaustion, request retries and cross-user requests.
- [ ] Implement authored hints and explanation release in transactions; a committed practice answer permits its feedback, a scored mock permits whole-session review, Daily waits for completion. Pre-answer support loads only hint context. Personal responses use `Cache-Control: private, no-store`; no shared solution cache.
- [ ] Record pre-answer and post-answer help separately. Preserve independent first-attempt outcomes; expose independent counts and assisted counts, with zero-data accuracy null. Related selection excludes the current/held-out item and gracefully returns unavailable when exhausted. Generate real-data summaries with insufficient-evidence language. Reports never mutate keys or results.
- [ ] Tutor is authenticated/authorized before returning structured `AI_DISABLED`; static eligible feedback still works. Test AI-off operation, related-bank isolation, help recording and actual-outcome scheduling via `pnpm test` and `pnpm test:integration`; expect all passing. Commit.

## Task 6: Web learner flow and accessibility

**Files:** `apps/web/src/app/{layout,page}.tsx`, auth pages, `learn/[categoryId]/page.tsx`, `sessions/[id]/page.tsx`, `results/[id]/page.tsx`, `progress/page.tsx`, `profile/page.tsx`, `daily/page.tsx`; `apps/web/src/components/{player,learning-support}/*`; `apps/web/src/lib/{api,auth-client}.ts`; `apps/web/src/strings/en-GB.ts`; `tests/e2e/web-learning.spec.ts`.

**Interfaces:** consumes only public contracts and Task 3–5 endpoints. `ExplainThisPanel`, `HintLadder`, `WorkedExample`, `MisconceptionNote`, `RelatedPracticeAction`, `SessionLearningSummary` render authorized server DTOs. Client mutations keep one idempotency key through retries and rehydrate server state after ambiguous failures.

- [ ] Read applicable frontend design and React performance skills. Write Playwright tests for sign-in → category lesson → practice → commit → feedback → results, plus each category/diagram, keyboard focus and retry/reload recovery. Run first to confirm missing-route failures.
- [ ] Implement responsive learner navigation, navy/blue tokens, externalised copy, accessible diagram alternatives and semantic controls. Full solutions never appear in initial HTML, RSC payloads or bundles for unreleased items. Display the development-content label consistently.
- [ ] Implement loading/empty/blocked/error/report states, honest progress and a clearly unavailable Daily surface. Support keyboard and reduced motion; prevent double-click mutations without depending on UI disablement for security.
- [ ] Run `pnpm test:e2e`, `pnpm --filter @reasoning/web build` and public-bundle dependency inspection. Inspect desktop and narrow-screen layouts in a real browser and capture evidence. Expect passing flows and no private imports. Commit.

## Task 7: Native learner flow and resilience

**Files:** `apps/mobile/app/` auth, tabs, lessons, sessions and results routes; `apps/mobile/src/components/player/{explain-this-panel,hint-ladder,worked-example,session-learning-summary}.tsx` plus misconception/related components; `apps/mobile/src/lib/{api,auth-client,drafts}.ts`; `apps/mobile/src/strings/en-GB.ts`; `tests/e2e/mobile-learning.yaml`.

**Interfaces:** same public contracts/endpoints as web. SecureStore holds auth state through Better Auth's supported native integration. SQLite stores local selections keyed by user/session/item/version, never answer keys or credentials; server response state wins when a draft is stale.

- [ ] Write native component tests for assistance labels, loading/error/blocked states and response recovery. Run before implementation. Add Maestro sign-in → Learn → Practice → results flow.
- [ ] Implement native Home/Practice/Daily/Progress/Profile navigation and device-appropriate text, option controls and structured diagrams. Adapt layout for tablets, screen readers and touch targets. Never show a full solution before server release.
- [ ] Persist retry keys and drafts across restarts; clear/account-scope drafts on logout. Test network-loss-after-commit and resumed sessions, with no duplicate answers and no cross-user draft leakage. Explain that scoring needs connectivity.
- [ ] Run mobile tests, TypeScript, Expo doctor and bundle export. Run Maestro on an available emulator/device; record an explicit blocker if unavailable. Never report export as native runtime proof. Commit.

## Task 8: Final review, docs and milestone evidence

**Files:** `README.md`; `docs/{decision-log,architecture,platform-matrix,learning-method,language-policy,ai-assistance-policy,ai-evaluation-set,release-checklist,delivery-evidence}.md`; `docs/adr/001-web-billing.md`; CI final verification commands.

**Interfaces:** no new product APIs. Evidence maps each approved acceptance condition to executed checks or an explicit outstanding blocker.

- [ ] Verify clean-database migration/seed and documented setup instructions from a fresh local configuration. Run the whole unit/content/security/integration suite, web E2E, builds and native checks; capture actual commands, counts, versions and available UI/device evidence.
- [ ] Document original fixture status and independent reviewer gates; actual platform coverage; auth/retention/privacy boundaries; deferred schema-only workflows; AI activation requirements and an unevaluated five-category evaluation set. Billing ADR remains proposed, not founder-approved integration.
- [ ] Use requesting-code-review for a fresh whole-branch review against V3, this design and the five Review Focus cases. Reproduce material findings in failing tests, fix them, then rerun affected checks and the complete suite. Record unresolved limitations.
- [ ] Update this plan's checkboxes and delivery evidence honestly. Commit verified changes locally. Hand over runnable commands and outstanding release blockers. Do not deploy, push, publish or claim the milestone complete without both executed learner paths and required checks.

## Plan self-review

Every approved first-milestone capability maps to Tasks 1–8. Review Focus cases have owning tests. Deferred V3 functionality is represented in the schema and decision log, not claimed implemented. Auth uses Better Auth, with official Expo and Prisma references checked on 8 November 2026:

- https://better-auth.com/docs/integrations/expo
- https://better-auth.com/docs/adapters/prisma
- https://better-auth.com/docs/installation

Exact framework pins are intentionally selected in Task 1 after checking compatible official requirements. No dependency or platform support claim has been made during planning.

## Execution handoff

Recommend subagent-driven execution: independent implementation/review gates for each task before final whole-branch review. Native execution remains an option. Founder chooses the method and confirms this implementation plan before code execution, as required by the writing-plans workflow.


