# ReasoningApp
## Consolidated delivery specification - Version 3.0
7 November 2026 | English-only launch and guided-learning update
Working name only; final brand remains undecided.

## Document status
This consolidated revision carries forward the core product, platform, commercial, architecture, schema, and delivery requirements from Version 2 and adds explicit English-only delivery, a bounded learner-facing AI assistant, and a simpler guided-learning method. It is a build specification, not proof of an implemented or tested application. Where conflicts arise, Version 3 governs the learning and language requirements. Do not infer approval of previously unresolved commercial or platform decisions.

## 1. Product, audience, and commercial scope
A new consumer reasoning-practice application, separate from BizOpt. Help job applicants prepare for recruitment assessments and adults maintain a reasoning-practice habit. The founder's cybersecurity recruitment experience motivates the product; this is not a cybersecurity knowledge exam.

Launch categories: inductive, logical, numerical, verbal, mechanical. Launch modes: Learn, Practice, Mock, Daily, Mistake Review, optional Preparation Plan. Keep the baseline optional. Do not add a separate chatbot product or extra learning menus for this update.

Target subscription: GBP 5.99/month, auto-renewing until canceled. Confirm actual store price options and tax display before production. No paid trial or annual plan is approved. Proposed free allowance remains tutorials plus five sample questions/category. Do not import BizOpt's introductory offer, team pricing, or organization schema.

Requested one-device restriction remains unresolved against store access/restoration requirements. Proposed alternative: personal account, no sharing, one active practice session, secure device transfer, compliant restoration. Require founder approval before hardcoding a permanent hardware lock.

No claims of guaranteed assessment success, hiring, increased IQ, cognitive treatment, or psychometric validation. No copied competitor questions, diagrams, text, branding, testimonials, user statistics, or publisher affiliation. Use original/licensed content and substantiated authorship claims only.

## 2. English-only launch - explicit requirement
All learner UI, lessons, questions, explanations, AI assistance, notifications, emails, support templates, and store-listing drafts are English for launch. Use UK English editorial conventions. Disable language selectors and automatic translation. Do not market multilingual support or use operating-system locale to change question language.

Keep interface strings separate from code and use locale-aware formatting for dates, numbers, and prices. This is maintainable engineering, not approval to build another language. Do not translate verbal passages or reasoning questions automatically; future language support requires separate subject/editorial review and testing.

If a user asks the assistant in another language, respond politely in English that the current app supports English only, and offer a simpler English explanation. Do not send the non-English input to a translation workflow. Reject unsafe/unnecessary input and enforce length limits. Device accessibility services remain usable; do not attempt to disable OS assistive tools.

## 3. Existing learning surfaces, improved rather than expanded
Keep Home | Practice | Daily | Progress | Profile on mobile and suitable desktop navigation. Integrate assistance into existing lesson, question, explanation, and review screens. No new chatbot tab, social feed, leaderboard, or unrelated feature.

Core guided-learning loop:
Try independently -> Commit answer -> See reviewed feedback -> Understand the step -> Attempt a different related item without help -> Revisit the concept later.

For a new skill, offer one short worked example before a related problem. After success, fade prompts and show unassisted items. For a mistake, show a concise explanation and a targeted follow-up. Do not repeatedly interrupt a learner who is already succeeding.

Design rationale: spacing practice, active retrieval, interleaving worked examples with solving, and feedback about learning are supported by general learning research. Exact scheduling, interface, and adult recruitment-preparation outcomes remain product hypotheses to evaluate, not proven guarantees for this app.

## 4. Learner-facing AI explanation assistant
Add a contextual Explain this panel, not an unrestricted chatbot. Available actions:
- Explain more simply.
- Show the reviewed steps.
- Explain why my selected answer was wrong.
- Help me understand this term.
- Give a small hint in eligible untimed practice before submission.
- Try a similar question from the approved bank.

AI may paraphrase or clarify the approved solution; it does not grade, invent new correct answers, publish questions, decide readiness, or solve live employer tests. Similar-question selection is deterministic from published items, not fresh unchecked generation.

Content grounding includes the exact question version, reviewed explanation, allowed stage-specific hints, units/assumptions, and the learner's selected answer where relevant. Before submission, expose only the next approved hint; do not give the model a full key or solution in a pre-answer hint request. Use authored hint text without a model call by default.

After submission, the server checks access and releases a bounded explanation context. Never trust a client-supplied answer key, solution, session mode, or reveal permission. Do not send account details, payment data, unrelated history, or personal employer-test material to the model.

Return a structured response with a short plain-English explanation, optional reviewed steps, one misconception note if supported, and suggested next action. Do not expose chain-of-thought, speculative internal reasoning, invented confidence percentages, or model claims of authority. Worked solution steps are instructional content grounded in the approved solution.

If approved material is missing, inconsistent, or the provider fails: show the reviewed static explanation if valid; otherwise show a content-review message and report option. Do not improvise an answer. If a learner disputes a solution, preserve official scoring, create a report, and route to review rather than having AI silently correct it.

## 5. Mode-specific assistance rules
Learn: worked examples, hints, explanations, and reviewed related items allowed. Clearly label assisted activity.
Practice: graded hints before answer only when explicitly permitted; explanation after committed submission; assisted items excluded from unassisted readiness indicators.
Mock IN_PROGRESS: block hint, explanation, AI, answer-key, and reviewed-solution endpoints server-side. Disable chat tools. UI hiding alone is insufficient. Leaving the screen follows the published timer policy.
Mock SUBMITTED/SCORED: allow explanation only after the session's declared release rule; ensure the whole mock is submitted rather than revealing one answer early.
Daily: publish challenge rules; default scored challenge unassisted, with explanation after completion. Assisted learning alternatives must not share the same score comparison.
Review: clarification and related items allowed; record help separately.

Test permission checks via direct requests, not just screen interactions. Prevent cross-user/cross-session context leakage and pre-answer disclosure through cache keys or shared URLs.

## 6. Simpler useful learning improvements
A. Worked example then your turn: one reviewed example alternates with an approved related problem; fade scaffolding as independent performance improves.
B. Hint ladder: authored hint 1 identifies the relevant concept, hint 2 identifies a useful relationship, hint 3 provides a partial method. Full solution follows submission. Exact hints require review to avoid accidental disclosure.
C. Mistake-to-next-step: map a reviewed distractor to a possible misconception. Phrase as a possibility, not a diagnosis. Offer an optional short learner-selected reason: guessed, misunderstood rule, calculation, rushed, or not sure. Never infer cause solely from speed.
D. Spaced return: revisit missed concepts with a different approved item after a delay. Initial configurable intervals may be 1, 3, and 7 days; these are heuristics, not validated optimal intervals. Missed days incur no penalty; successful independent retrieval lengthens spacing.
E. Gradual timing: begin untimed for learning, offer optional timed practice when independent accuracy improves, preserve an explicit route directly to mocks. Never silently change a timer mid-session.
F. Small session ending: three lines: what improved, what to revisit, and the next useful action. Use real data, say insufficient data when appropriate, and never claim job readiness from a few attempts.

These are improvements inside existing screens and recommendation logic, not six new products.

## 7. Readiness and progress guardrails
Prefer observable indicators: recent unassisted accuracy by skill, timing under stated conditions, breadth of skills practised, due review, and sample size. Do not call a number a probability of passing an employer test.

Keep assisted/untimed/mock/offline/daily outcomes separate. Opening a full explanation marks the attempt as assisted where relevant; independent follow-up is a separate response. Store when help was used so the server can distinguish pre-answer assistance from post-answer review.

A readiness summary may say: Practised 8 of 12 targeted skills; limited recent evidence in ratios. Use configurable, documented minimum evidence before showing trends. Percentiles and validated adaptive testing remain disabled until justified.

## 8. AI reliability, safety, cost, and privacy
Core learning always works with the AI provider unavailable. Static reviewed solutions and authored hints are the baseline. AI is optional elaboration, not a prerequisite for practice, scoring, review, or plan generation.

Use provider abstraction, server-only credentials, authenticated endpoints, per-user rate limits, token/output limits, timeout/cancellation, circuit breaker, budgets, and a kill switch. No unlimited AI promise at GBP 5.99. Proposed allowance and model choice require cost review and founder approval; show any actual limit clearly.

Cache only safe non-personal explanation variants keyed by questionVersionId, explanationVersion, action, promptVersion, language, and access stage. Personalized responses require user/session scoping. Never use a shared pre-answer cache to expose solutions. Store approved context version, provider/model/prompt version, status, latency, and estimated usage, with minimum necessary content retention.

Use clear AI-assisted labels. Do not portray automated prose as a psychologist or certified assessor. Treat user text as untrusted; block instructions to ignore rules, reveal keys, translate tests, or solve uploaded live-assessment content. Minimize free text; no file-upload solver.

Document vendor data processing, retention/training settings, data region where available, and relevant consent/disclosure. Do not claim zero retention without provider verification. Avoid storing full chat logs by default. Do not log tokens, keys, or sensitive model inputs.

## 9. Platform stack and compatibility carried forward
Native: React Native + Expo + TypeScript for iPhone/iPad and Android phones/tablets. Browser: Next.js + React + TypeScript learner app, marketing, and restricted editorial admin for Windows/macOS/Linux/ChromeOS. API: Fastify TypeScript modular monolith. Data: PostgreSQL + Prisma. Jobs: Redis/BullMQ plus database outbox. Mobile persistence: SQLite; credentials: Expo SecureStore. Assets: S3-compatible storage/CDN. Workspace: pnpm.

Proposed billing: RevenueCat native Apple/Google integration; choose either its web billing or a direct Stripe web adapter through an ADR. One normalized entitlement model; no accidental double subscriptions. Proposed tests: Vitest, real DB/queue integration, Playwright web, Maestro mobile, physical devices. Monitoring: Sentry and redacted logs.

Proposed Android 10+ baseline needs approval. iOS minimum derives from chosen Expo SDK and every native dependency; prioritize current/two prior supported major versions. Browser current/previous stable releases within Next.js supported bounds. Verify dated official docs and record actual tested OS/device/browser evidence. No every-historical-OS promises. Do not hardcode time-sensitive framework floors from old chat.

Share contracts, question specifications, deterministic rules, skill taxonomy, entitlement definitions, recommendation rules, and design tokens. Keep private key/scoring content server-only. Use adapted native/web renderers for diagrams and device-appropriate UI; never wrap a desktop site as the primary native experience.

## 10. Content, scoring, and session integrity
Categories must have reviewed original content: inductive full-sequence rules/alternative-answer review; logical skill boundaries; numerical units/rounding; verbal entailment/contradiction; mechanical explicit physical assumptions. Use structured reviewed diagrams, not unchecked generated images.

Pipeline Draft -> Validation -> Subject Review -> Editorial Approval -> Published -> Monitor -> Correct/Retire. No self-approval by default. Each item requires stimulus, stable options, private key, worked explanation, distractor rationale, provenance, reviewer, and immutable version. New fields include approved hints and short explanations. AI drafts require the same review.

Proposed content gates remain 10 checked/category development, 50 approved/category beta, 100 approved/category paid launch. Keep held-out mock content separate; do not auto-publish to reach counts.

Session states CREATED -> IN_PROGRESS -> SUBMITTED -> SCORED, plus EXPIRED and ABANDONED. Online mocks: server deadline, monotonic client display, explicit cutoff/backgrounding rules, incremental saves, idempotent submit, concurrency protection, exact option/question versions, no pre-submit answer keys. Corrections never silently mutate historical results.

## 11. Schema contract and learning patch
Carry forward identity: User, UserPreference, AuthSession, DeviceInstallation, DeviceLease.
Catalog/content: Category, Skill, CategorySkill, Lesson, Question, QuestionVersion, QuestionOption, AnswerKey, QuestionAsset, QuestionSkill, ContentReview.
Assessment: AssessmentBlueprint, AssessmentSection, PracticeSession, SessionItem, Response, SessionResult.
Personalization: SkillProgress, ReviewSchedule, StudyPlan, StudyTask.
Billing: BillingCustomer, Subscription, PurchaseTransaction, Entitlement, ProviderEvent.
Engagement: DailyChallenge, ChallengeEntry, Achievement, UserAchievement.
Automation/governance: OutboxEvent, Notification, NotificationAttempt, NotificationPreference, QuestionReport, SupportTicket, AuditEvent, ConsentRecord.

Extend existing models where appropriate; avoid duplicate tables:
- ApprovedHint: questionVersionId, stage, text, publication/review metadata; unique(questionVersionId,stage).
- ExplanationVersion: questionVersionId, version, shortText, workedSteps, distractorRationales, approval status/reviewer; immutable published versions.
- LearningSupportEvent: userId, sessionItemId, action, assistanceStage, hintStage, timestamp; distinguishes before-answer from post-answer review.
- TutorRequest: userId, sessionItemId, approved context version, action, status, prompt/model version, usage, latency, sanitized error, createdAt; avoid full transcripts by default.
- Response: assistanceLevel/source if not already recorded; misconceptionTag or optional selfReportedReason; submittedAt.
- ReviewSchedule: last independent outcome, dueAt, interval, policyVersion.
- SkillProgress: assisted and unassisted counts, recency, sample size; avoid a fake mastery probability.
- Related item selection: use skill/template tags or a small reviewed relationship mapping; no unchecked generated follow-up bank.

Constraints: unique(questionId,version); unique(questionVersionId,optionKey); unique(sessionId,position); unique(sessionItemId) for current response; unique(provider,externalEventId); unique(provider,externalTransactionId); unique(userId,skillId); notification dedupe key. Preserve full response revision history if required without violating the current-response constraint.

Generate complete valid Prisma relations, enums, indexes, foreign keys, migration SQL, and rollback notes. Use consumer ownership, not gratuitous multi-tenancy. Published hints and explanations follow the same immutable version/review rules. Prevent one user's tutor context leaking to another.

## 12. Repository and delivery patch
Existing workspace:
apps/mobile; apps/web; apps/api; apps/worker.
packages/contracts; database; question-render-spec; question-validation; scoring-engine; design-tokens; config.
tests/unit, integration, security, content, e2e; docs; infra.

Learner mobile screens remain under auth, tabs, lessons/[id], sessions/[id], results/[id], review/[id], settings. Web must include learner sessions/results/progress, not marketing/admin alone. Avoid duplicate route-group URLs.

Add or adapt these files:
apps/api/src/modules/learning-support/authorization.ts
apps/api/src/modules/learning-support/context-builder.ts
apps/api/src/modules/learning-support/hint-service.ts
apps/api/src/modules/learning-support/tutor-service.ts
apps/api/src/modules/learning-support/related-item-selector.ts
apps/api/src/modules/learning-support/providers/ai-provider.ts
apps/api/src/modules/learning-support/policies.ts
apps/api/src/modules/personalization/review-scheduler.ts
packages/contracts/src/learning-support.ts
packages/question-validation/src/hint-validation.ts
apps/mobile/src/components/player/explain-this-panel.tsx
apps/mobile/src/components/player/hint-ladder.tsx
apps/mobile/src/components/player/worked-example.tsx
apps/mobile/src/components/player/session-learning-summary.tsx
apps/web/src/components/learning-support/ [equivalent browser components]
docs/learning-method.md
docs/ai-assistance-policy.md
docs/ai-evaluation-set.md
docs/language-policy.md

Adapt names to approved existing repository structure; no duplicate services or needless microservices.

## 13. API and component acceptance
Suggested endpoints under /v1:
POST /sessions/:id/items/:itemId/hints - returns next permitted approved hint.
POST /sessions/:id/items/:itemId/explanation - returns permitted reviewed solution version.
POST /sessions/:id/items/:itemId/tutor - bounded action, grounded response only.
GET /sessions/:id/items/:itemId/related-practice - selects an approved eligible item.
GET /sessions/:id/learning-summary - computes three-line actual-data summary.

Validate ownership, entitlement/allowance, mode/state, item version, permission, rate limit, and idempotency as relevant. Never accept client reveal permissions or answer keys. Similar-item selections must not expose held-out mock items. Track assistance server-side.

Components: ExplainThisPanel, HintLadder, WorkedExample, MisconceptionNote, RelatedPracticeAction, SessionLearningSummary. Integrate into existing player/results/review; no new AI tab. Include loading, blocked, unavailable, limit, report, accessibility, theme, and network states.

## 14. Broader security, commerce, and operations
Verified account, maintained auth, secure recovery/session revocation, server ownership, least privilege, input validation/rate limits, encrypted transport, safe storage, deletion/export/retention. No card/password/token/key data in logs.

Normalized billing via verified events, transaction identity, restore, account-linking, retries/dead letters/current-state reconciliation, cancellation distinct from paid access, refunds/revocations. No redirect activation or silent purchase transfer. Store policy and device lock require review.

Keep prior lifecycle automation: verification, welcome, recovery/password-change, activation, payment recovery/expiry, optional reminders/digests, report acknowledgment. Outbox/worker delivery, signatures/dedupe, consent, suppression, fake provider in tests.

Proposed hosting: paid Render web/API plus separate workers, managed PostgreSQL/Redis, object storage/CDN, Expo build workflows. Check costs/region/privacy/runtime before procurement. Separate dev/staging/prod, no ephemeral-disk durability or process-local reminder scheduling. Backups/restore, migrations/rollback, incidents, and secret validation documented.

Offline stage 1: resilient local drafts, online mocks. Stage 2 approved downloadable packs with versioned manifests, signed expiring leases, protected storage, idempotent sync/conflict rules. No perfect offline anti-cheating/device enforcement claims. Static reviewed learning works offline where packaged; AI clearly unavailable without connectivity.

## 15. Tests, evaluation, and gates
Preserve original unit/integration/mobile/web tests for scoring, numerical/verbal/diagram correctness, session state, ownership, answer privacy, timing/cutoff, duplicate submit, restore/cancel/refund, notifications, offline sync, accessibility, and device matrix.

New release-blocking tests:
- English only across UI/templates/assistant; no exposed language selector or auto-translation.
- Direct tutor/hint/explanation API calls rejected during active mocks.
- Cross-user access and shared-cache solution leaks blocked.
- Pre-answer model context contains no key/full solution.
- Published solution and recorded key stay consistent; model cannot alter grading.
- Hint/reveal usage recorded and excluded from independent readiness metrics.
- Similar practice uses a different approved eligible item; no held-out exposure.
- Timeout/outage/limit uses static valid fallback; no improvisation.
- Versioned context/caches prevent stale incorrect explanation reuse.
- Spaced review reschedules from actual outcomes with documented heuristics.
- Language prompt injection, reveal-key requests, and unsupported claims handled safely.
- Offline core practice continues with AI disabled.

Create a reviewed evaluation set across all five categories, including ambiguity, disputed keys, numeric rounding, mechanical assumptions, verbal Cannot Say, and adversarial requests. Human reviewers assess fidelity to solution, absence of answer contradiction, clarity, leakage, and safety. Document thresholds and review results before enabling AI in production; do not claim a validator guarantees factual correctness. Any known material contradiction/leakage blocks rollout until fixed.

Measure independent follow-up accuracy and later retention attempts, not time chatting. Compare with baseline static explanations during beta, with consent/privacy controls. General learning research informs design but does not establish this app's effectiveness.

## 16. Build order and approvals
1 Audit repository, decision log, confirmed/default/blocker map.
2 Workspace/CI/contracts/schema, compatible versions, documented platform matrix, auth/themes/navigation.
3 Cross-platform slice: original question -> saved response -> server score -> reviewed explanation -> progress.
4 Five-category rendering, editorial review, approved explanations/hints.
5 Practice/mocks and permission gates; resilience tests.
6 Sandbox billing/account automation.
7 Static guided loop: worked example/hints/related approved item/spaced review/summary.
8 Optional grounded AI behind feature flag, after evaluation and cost policy approval.
9 Progress/plans/daily and approved offline packs.
10 Closed beta: content, accessibility, real-device tests, monitoring/restore/security.
11 Founder-approved store/public release.

For this update to an existing build, implement only missing portions in small diffs, not a rebuild. No AI during mock. No automatic production rollout.

Outstanding decisions: final name; iOS/Android launch order; device policy; exact OS/browser matrix; budget/reviewers; sample allowance; AI budget/allowance/provider; audience; refunds; offline scope. No live charges, real messages, paid provisioning, destructive migrations, deployment, or publication without approval.

## 17. Sources and limitations
Consolidates the conversation and proposed architecture; it is not a fresh audit of store rules or current framework versions. Recheck official technical/policy documentation before implementation and release.

Learning design references:
IES/What Works Clearinghouse, Organizing Instruction and Study to Improve Student Learning: https://ies.ed.gov/ncee/WWC/PracticeGuide/1
IES discussion of retrieval, spacing, interleaving and feedback: https://ies.ed.gov/learn/blog/lightbulb-moment-how-ies-sparks-research-teaching-and-practice
These support general instructional principles, not guaranteed adult assessment results or the exact review intervals proposed here.
Technical references to verify: https://docs.expo.dev/versions/latest/ ; https://nextjs.org/docs/architecture/supported-browsers ; https://www.revenuecat.com/docs/getting-started/installation/expo ; https://developer.apple.com/app-store/review/guidelines/

## Appendix. Codex / Claude update and delivery prompt
Use the following prompt with this entire document. A separate text copy is supplied.

```text
You are the principal engineer, learning-product architect, and security lead for ReasoningApp. Implement the accompanying Version 3.0 specification. Inspect the repository first. Reuse working code and all approved Version 2 platform/security/billing requirements; do not rebuild or duplicate auth, billing, or session services. Version 3 adds English-only delivery and guided learning, not a new chatbot product.

CONFIRMED SCOPE
Five categories: inductive, logical, numerical, verbal, mechanical. Mobile assessment preparation plus daily reasoning practice. Target GBP 5.99/month. No BizOpt trial/team features. No guaranteed passing, IQ/medical benefit, affiliation, or psychometric-validity claims. Original/licensed content only.

STACK / DEVICES
React Native/Expo/TypeScript iOS/iPadOS/Android phone/tablet; Next.js React learner web/admin/public site; Fastify TypeScript modular API; PostgreSQL/Prisma; SQLite drafts; SecureStore credentials; Redis/BullMQ with DB outbox; object storage/CDN; pnpm workspace. RevenueCat native purchases proposed, choose ONE web billing approach via ADR. Shared contracts/specs/rules/tokens; keys and sensitive scoring content server-only. Test Vitest/integration/Playwright/Maestro/physical devices; monitoring redacted logs/Sentry.
Verify compatible stable SDK/dependencies, commit lockfile, publish dated tested support matrix. Android 10+ is proposed; iOS minima follow SDK/native dependencies; browser current/previous supported releases. No all-device/historical-OS claims. Include actual browser learner practice, not marketing alone.

ENGLISH ONLY
English UI/content/explanations/AI/emails/push/support/listing drafts. UK English conventions. No language picker, automatic translation, or multilingual advertising. Keep strings separate and format dates/prices correctly. Non-English requests receive a brief English notice and simpler-English option; no translation workflow. Do not disable OS accessibility.

LEARNING METHOD - NO FEATURE BLOAT
Integrate into existing Learn/Practice/Results/Review screens:
Try -> commit -> reviewed feedback -> understand -> different related approved item without assistance -> revisit later.
Use one reviewed worked example before a related problem for novices; gradually fade scaffolding. Authored hint ladder: concept, relationship, partial method; solution after submission. Offer a misconception note supported by reviewed distractor mapping and optional learner reason; do not diagnose from speed. Spaced review uses different approved questions; initial 1/3/7-day intervals are configurable heuristics, not proven optimal. Encourage independent accuracy before optional timing, never change a timer silently. End with three lines: improved, revisit, next action from real evidence. No new chatbot tab, social features, or guilt streaks.

CONTEXTUAL EXPLAIN THIS ASSISTANT
Actions: explain simply, show reviewed steps, explain selected distractor, clarify term. Pre-answer hints use reviewed authored hints, not a model with the full solution. Related practice selects from approved bank; no unchecked generated follow-up. AI is optional clarification, not scoring authority, publisher, readiness assessor, live employer-test solver, or general chat.
Use exact approved question/explanation version. Server builds permitted context and authorizes user/item/mode/state/entitlement. No client-supplied key/solution/permission. Before answer do not send full key/solution to model. After submission use only the permitted reviewed solution. Structured concise English response: explanation, optional instructional steps, supported misconception note, next action. Do not request or expose chain-of-thought or fabricated confidence scores.
On missing/inconsistent context, timeout, outage, or usage limit: valid static reviewed explanation or review/report message. Never improvise. A dispute creates a report; AI cannot change scores/keys. Static core learning works with AI disabled and, for packaged content, offline.

MODE SECURITY
Learn: help allowed and labeled. Practice: hints only when allowed; mark pre-answer help assisted. Post-answer review must not erase timing of help. Mock active: server blocks ALL hints/AI/explanations/key endpoints; no UI-only gates. Reveal after whole-session submission and declared release policy. Daily scored defaults unassisted; feedback after completion. Review allows explanation and tracks help. Block direct request bypass, cross-user access, cached solution leakage, held-out mock exposure.

DATA / MIGRATIONS
Preserve Version 3 logical models: identity/preferences/devices, catalog/skills/lessons, immutable question versions/options/keys/assets/reviews, sessions/items/responses/results, progress/review/plans, billing/entitlements/provider inbox, daily/achievements, outbox/notifications, reports/support/audit/consent.
Add only missing approved-hint stages; immutable explanation versions; LearningSupportEvent for stage/action/timestamp; minimal TutorRequest metadata; response assistance/self-reported reason; review policy version/outcome; assisted vs independent progress counts. Use existing skill/template tags for related items or a small reviewed mapping. Full transcripts off by default.
Generate complete valid Prisma relations/enums/indexes/FKs/migration/rollback notes. Preserve uniqueness for question version, option key, session position, current response per item, provider events/transactions, user-skill progress, notification dedupe. Keep historical scoring versions. Never silently overwrite published items or old results.

IMPLEMENTATION PATCH
API module learning-support/: authorization, context-builder, hint-service, tutor-service, related-item-selector, providers/ai-provider, policies. Extend personalization/review-scheduler. Add contracts/learning-support and reviewed hint validation. Mobile and web: ExplainThisPanel, HintLadder, WorkedExample, MisconceptionNote, RelatedPracticeAction, SessionLearningSummary inside existing screens. No new tab. Add loading/unavailable/limit/report/blocked/accessibility/theme/network states.
Suggested /v1 session item endpoints: hints, explanation, tutor, related-practice; session learning-summary. All validate ownership, exact version, mode/state, permission, allowance, rate limit. No mock bank leakage.

CONTENT / SCORING
Deterministic server scoring online; no live AI requirement. Verbal True=entailed, False=contradicted, Cannot Say=neither. Numerical units/rounding/tolerances explicit. Inductive full sequence plus competing-rule review. Mechanical assumptions reviewed. Logical skill boundaries explicit. Reviewed structured diagrams, not unchecked AI images.
Draft->validation->subject review->editorial approval->publish->monitor/correct/retire; no self-approval by default. Every explanation/hint version reviewed. Proposed bank gates 10/category development, 50 beta, 100 paid; not auto-publication permission. Hold out mocks.
Session CREATED->IN_PROGRESS->SUBMITTED->SCORED, EXPIRED/ABANDONED; server deadline, monotonic display, declared cutoff, incremental saves, idempotent/concurrency-safe submit, exact option order, no premature key. Assistance is server-recorded. No fake 100% for no data, population percentiles, or employer pass probabilities. Separate modes/assistance/offline.

AI OPERATIONS
Server-only keys, provider adapter, feature flag/kill switch, timeout, rate/token/output/user and total spend budgets, circuit breaker. No unlimited AI claim; actual allowance needs founder cost approval. Cache safe public paraphrases only by exact question/explanation/action/prompt/language/access stage; scope personalized output to user/session. Prevent stale context and pre-answer solution cache reuse. Minimize retention; no secrets or sensitive inputs in logs. Record model/prompt/context/latency/status/usage. Document vendor retention/training/region settings truthfully. Free text bounded/untrusted; no upload solver. Prompt-injection protections and output evaluation, not a claim of perfect AI validation.

BILLING / DEVICES / PRIVACY
Verified events and periodic provider reconciliation, restore, account-linking, retries/dedupe, refunds/revocation, cancellation distinct from paid access. One-device permanent lock is unresolved: review store requirements and seek approval; propose personal account/one session/secure transfer/compliant restore. No perfect offline enforcement.
Maintained auth/verification/recovery/session revocation; ownership/admin least privilege; rate limits; retention/export/delete. Separate transactional from optional messages, outbox + workers, consent/suppression/signatures/dedupe, fake providers in tests. No real recipients or charges in tests. Audience and refund policies need approval.

TESTS / EVALUATION
Retain platform/scoring/billing/session/accessibility/offline tests. Add English-only behavior; mock API blocking; cross-user/cache leakage; no pre-answer key context; AI cannot change score; help tracked/excluded from independent readiness; different approved related items; no held-out exposure; timeout/static fallback; versioned caches; review rescheduling; English reveal-key/prompt-injection tests; AI-offline core learning.
Build human-reviewed evaluation items in all five categories, covering ambiguity, disputed keys, verbal Cannot Say, rounding, mechanical assumptions, and adversarial requests. Assess fidelity, contradiction, clarity, leakage/safety. Agree thresholds before enabling; any known material contradiction/leakage blocks rollout. Do not call automatic checks proof of correctness.
Measure independent follow-up and later retrieval, not chat volume. General spacing/retrieval/worked-example evidence is rationale, not proof this app improves job outcomes. Document experiments/privacy.

DOCS
Update PRD, architecture, stack decisions, dated platform matrix, content/scoring/device/billing/privacy policies, decision log, release checklist. Add learning-method.md, ai-assistance-policy.md, ai-evaluation-set.md, language-policy.md.

ORDER
Audit; document confirmed/proposed/blocker decisions; foundation/auth/schema; mobile+web deterministic practice slice; content/review; secure mock permissions/resilience; sandbox billing/automation; STATIC guided loop; optional AI behind flag after evaluation/cost approval; remaining progress/daily/offline; closed beta and evidence; founder-approved release.
For an existing build, implement missing portions in small diffs and do not redo completed foundations.

DELIVERY
Each increment: changed files, migrations, commands actually run, test results, UI evidence, configuration placeholders, limitations, release blockers. Never claim unrun tests passed or untested OS compatibility. No paid provisioning, destructive production migration, deployment, real email/charge, or publication without approval. Start with repository audit and first missing static guided-learning slice; keep AI off until authorized and tested.

```
