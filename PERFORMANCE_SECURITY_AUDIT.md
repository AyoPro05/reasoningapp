# ReasoningApp performance and security audit

Date: 10 November 2026. Initial audit of the current greenfield implementation, not a production penetration test or release certification.

Update, 11 November: Task 5 static support/progress is independently accepted after fixing post-answer worked-example help accounting and consolidating the mutation replay policy. The fix passed 514 default-suite tests and 40 session/support integration tests, plus type checking and compilation. Earlier broad integration evidence passed 89 tests across two commands, with one healthy-Redis skip; it remains separate evidence for the earlier source. The pg warning and expected fault-log capture remain Minor concerns. The Next.js learner UI is now in progress. The original timing measurements below remain the baseline before these changes.

The governing scope remains the approved V3 Learn → Practice → results milestone. There is no deployed application, production customer traffic or existing search ranking to measure. This report records implemented controls, verified defects, dependency advisories and delivery gaps separately. No production credentials, tokens, cookies, private keys or customer records are included.

## A. Architecture assessment

- **Clients:** Next.js 16.4.5 web and Expo 58.0.23 / React Native 0.88.1 mobile packages are installed. Learner screens have not been implemented. Files beneath `node_modules/@reasoningapp/` are generated dependency copies; edit the originals under `packages/` and `apps/`.
- **Server:** Fastify 5.12.8, TypeScript, Zod runtime contracts and Better Auth 1.7.18. Entry points are `apps/api/src/server.ts`, `apps/api/src/app.ts` and `apps/worker/src/index.ts`.
- **Persistence:** Prisma 7.10.1 with the PostgreSQL adapter and pg 8.23.1. Three forward migrations define immutable content, owner/version foreign keys and one active assessment per learner. Local PostgreSQL 18.6 runs on loopback. Existing migrations were also successfully deployed to the explicitly named local development database during this session.
- **Jobs:** PostgreSQL outbox plus BullMQ 6.7.2 / ioredis 5.11.1. Only fake authentication-mail delivery is implemented. New session events persist atomically but do not yet have product-event consumers. Redis is existing approved infrastructure, not a new optimisation proposed by this audit.
- **Trust boundaries:** maintained cookie authentication → current verified learner → current entitlement → owned session/item → stage-specific public projection. Answer keys, explanations and scoring remain server-only.
- **Hosting:** no remote repository, production deployment, CDN, external email provider, paid monitoring or live billing is configured by this work. Docker/native-device tooling is unavailable locally.
- **Accepted stages:** workspace, schema/content, authentication/outbox, catalog/sessions and static support/progress. Both clients remain later stages.

The current modular monorepo is suitable for this milestone. No framework migration, additional cache, load balancer, database index or paid service is justified by the measurements collected here.

## B. Existing performance and security baseline

### Verification actually performed

| Check | Observed result | Limits |
|---|---|---|
| Default Vitest suite | 122 passed, exit 0 | 115 unit/content tests plus 7 database-backed security tests |
| Integration suite excluding `outbox-startup.test.ts` | 61 passed, 1 skipped, exit 0 | Healthy Redis skipped; four startup cases explicitly excluded |
| Focused session integration | 11 passed | Real PostgreSQL, maintained authentication, races, rollback and retries |
| Focused security plus auth transport | 11 passed | Seven session security tests and four transport tests |
| Type checking and compilation | Exit 0 | API/worker/shared compilation; not a Next.js or native application build |
| Compiled API smoke | Authenticated service creation 201; unauthenticated `/v1/me` 401 | Local compiled runtime with an ignored workspace resolver |
| Registry audit, production dependencies | 2 moderate advisories; exit 1 | Scanner inventory reports 840 dependencies; no high/critical advisories returned |
| Explicit registry audit, development dependencies | No advisories returned; exit 0 | Scanner inventory reports 196 dependencies; not proof of absence of vulnerabilities |
| Browser learner click tests | Not run | Learner routes/screens do not exist yet |
| Native learner execution | Not run | SDK/emulator/device tools unavailable |

The earlier reviewed Task 3 run passed the four real-driver startup-outage tests. An intervening session failed before application code because the maintained TypeScript loader's Windows user lookup returned `uv_os_get_passwd/ENOMEM`. On 11 November the maintained loader initialised normally and all four startup-outage tests passed again, without dependency or operating-system patches. The healthy-Redis test and actual CI execution remain unverified.

Test output contains expected sanitised fault-injection messages and an unsuppressed pg deprecation warning. It is not described as pristine. Following the usage interruption, the same independent reviewer completed the frozen-snapshot review: spec PASS, quality PASS WITH MINOR CONCERN, no blocking findings. All 17 source hashes matched. Task 4 is accepted; the driver warning and wider execution gaps remain open.

### Local API timing baseline

Task 5 verification evidence (11 November): the default suite passed 502/502; integration passed 85 tests and skipped one healthy-Redis case, excluding the four startup cases. A subsequent focused run passed all four startup cases, giving 89 integration passes and one skip across two commands on the same frozen source. This covers authored hint stages, persisted release policies, owner/version checks, private/no-store responses, idempotency, independent versus assisted evidence, actual-outcome scheduling, related-practice isolation and report immutability. It does not establish client behaviour or production readiness. Initial fresh runs failed at database setup because local network access was denied; after permission restoration and restarting the owned database process in that network context, both suites passed. Failed environment logs are retained separately. Independent review subsequently identified the two issues described above; regression tests reproduced the accounting defect, the six-file fix passed 514 default and 40 session/support integration tests, and scoped re-review accepted both fixes. No new broad integration rerun is claimed for the fix.

Method: compiled API, real local PostgreSQL and a synthetic verified test learner. Three warm-ups followed by 20 sequential Fastify `inject` requests per route. p50/p95 use nearest-rank samples. All 60 measured responses returned 200. Synthetic learner/session/outbox records were removed afterwards.

| Route | Samples | p50, ms | p95, ms | Response bytes |
|---|---:|---:|---:|---:|
| `/v1/categories` | 20 | 2.46 | 3.60 | 303 |
| `/v1/lessons/numerical` | 20 | 6.02 | 7.73 | 1,295 |
| `/v1/sessions/:id` | 20 | 7.34 | 8.33 | 6,274 |

These are local server measurements, excluding TCP, TLS, proxies, browser work and concurrent load. They establish a baseline, not production latency, capacity or an improvement percentage. No LCP, INP, CLS, browser bundle size, query plan or sustained-throughput measurement exists yet. There is no measured case for speculative caching or index changes.

### Controls inspected

- `apps/api/src/modules/auth/auth.ts:47` explicitly retains origin/CSRF checks, disables proxy-header trust, sets HTTP-only/SameSite cookies and enables secure cookies for HTTPS. Production config requires HTTPS. Password recovery revokes existing sessions; verification is required.
- `apps/api/src/modules/auth/authorization.ts` obtains the maintained session without cookie-cache shortcuts and checks current verification. Forged identity/forwarding headers are covered by tests.
- `apps/api/src/modules/sessions/routes.ts` applies authentication and entitlement checks to every product route. `repository.ts:25` locks the owner; `:38` locks an owner-scoped session. Item membership is checked before replay. Strict request schemas reject client keys, versions and reveal flags.
- `service.ts:40` checks stored idempotency outcomes under the owner lock. Responses, result, replay record and outbox event commit together. Real uniqueness-collision tests prove rollback. Server expiry is persisted before refusal.
- `serialization.ts` projects public fields explicitly. Practice excludes designated lesson examples and held-out content. Personal catalog/session/result responses currently send `Cache-Control: no-store`.
- Raw SQL in reviewed runtime paths uses Prisma parameterised tagged templates. The focused source search found no runtime unsafe raw-query API, dynamic execution, shell invocation or raw HTML rendering. This is supporting inspection, not a proof against all injection classes.
- `packages/config/src/index.ts:45` rejects inconsistent environments; production rejects fixture/verification bypass flags. AI and live billing activation are rejected. Ignored environment files hold local secrets, which were not printed.

These checks follow the principles of checking permissions on every request and explicit denial described in the [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). This report is not a completed [OWASP ASVS verification](https://owasp.org/projects/asvs?tab=main).

No high-confidence exploitable application vulnerability was established in this initial review. Dependency advisories and untested surfaces below remain unresolved; this statement is not a clean security sign-off.

## C. Prioritised findings register

Priority describes delivery/remediation order. It is distinct from a vulnerability severity. Missing milestone features are not represented as exploitable vulnerabilities.

| ID | Finding | Impact | Risk | Priority | Recommendation |
|---|---|---|---|---|---|
| REV-001 | Session engine independent review completed | Core correctness and privacy gate accepted | Verified scoped review | P1 | Retain the Minor driver concern for final review |
| QA-001 | Learner UI and full click journey absent | Main milestone cannot be used | Delivery gap | P1 | Finish static support, then implement and exercise both clients |
| REL-001 | Four worker startup tests cannot initialise `tsx` | Current outage evidence incomplete | Local runtime gap | P1 | Rerun in a permitted environment without weakening assertions |
| QA-002 | Healthy Redis, CI and native execution unverified | Release compatibility/reliability unknown | Evidence gap | P1 | Obtain actual service/CI/device execution |
| CONT-001 | Development bank lacks independent editorial review | Content cannot be published | Release gate | P1 | Subject and editorial review before publication |
| DEP-001 | Two moderate Expo CLI transitive advisories | Conditional tooling availability risk | Reachability unconfirmed | P2 | Verify compatible upstream remediation and rebuild/export |
| PERF-001 | pg emits overlapping-query deprecation warning | Future driver compatibility concern | Observed warning | P2 | Diagnose maintained adapter path before any driver change |
| SEC-001 | Browser headers, cache and bundle protections untested | Browser confidentiality/XSS controls unverified | Surface not built | P2 | Verify them when implementing authenticated web routes |
| DEV-001 | Git index writes initially denied | Scoped access restored on 11 November | Recovery/workflow gap | P2 | Save accepted work as a checkpoint; configure a private remote separately |
| ERR-001 | Error DTO fallback defect corrected | Restores predictable bounded API errors | Verified correction | P2 | Retain regression coverage |

### REV-001 — Independent session review

- **Component/file:** frozen Task 4 source snapshot, based on commit `7c4e7ff`.
- **Issue/evidence:** the initial review was interrupted by a usage limit. The same reviewer subsequently completed both verdicts against the full frozen snapshot, with 17/17 file hashes matching and no Critical/Important findings.
- **Severity/impact:** high delivery importance; no new exploit is asserted. Ownership, idempotency and grading are load-bearing.
- **Recommended solution:** resume the existing review seat when available; avoid duplicate reviewers. Resolve Critical/Important findings with regression tests and scoped re-review.
- **Complexity/dependencies:** bounded source review; reviewer availability.
- **Status:** COMPLETED.
- **Verification:** `task-4-review.md` records spec PASS and quality PASS WITH MINOR CONCERN. The Minor pg compatibility concern remains PERF-001; CI, healthy Redis and device evidence remain QA-002.
- **Rollback:** preserve the working tree and review snapshot. Revert only reviewed Task 4 changes if required; do not reset databases or discard unrelated work.

### QA-001 — UI and end-to-end journey

- **Component/file:** `apps/web/package.json`, `apps/mobile/package.json`; planned client source routes.
- **Issue/evidence:** both client directories contain installed package foundations, without learner application screens. No Playwright learner journey or Maestro execution has passed.
- **Severity/impact:** high milestone gap, not a confirmed security vulnerability.
- **Recommended solution:** complete Task 5's static help/progress boundary, then build the approved UI and test it against the real API. Follow the UI/click acceptance criteria below.
- **Complexity/dependencies:** substantial; accepted server interfaces and static support are prerequisites.
- **Status:** NOT STARTED.
- **Verification:** source inventory confirms absent screens. API injection tests are not browser click tests.
- **Rollback:** isolate client changes; preserve API contracts and server data. No framework replacement is proposed.

### REL-001 — Worker test runtime initialisation

- **Component/file:** `tests/integration/outbox-startup.test.ts`; installed `tsx` runtime.
- **Issue/evidence:** all four fresh child processes exit before `publish-started`. A direct isolated `node --import tsx` diagnostic reproduces `uv_os_get_passwd/ENOMEM` in `node:os.userInfo()` before application code.
- **Severity/impact:** high current verification gap; not evidence that the shutdown fix regressed.
- **Recommended solution:** restore a supported execution environment and rerun all four original scenarios, retaining actual normal exit, resource cleanup and durable pending-row assertions. Do not patch OS identity APIs, suppress the tests or relax their budget.
- **Complexity/dependencies:** environment-dependent; no speculative product fix is recommended.
- **Status:** BLOCKED.
- **Verification:** previous reviewed run passed; current failure and explicit exclusions are retained separately. Compiled API smoke does not replace these cases.
- **Rollback:** no product change made for this finding; ignored compiled-runner helpers can be omitted outside this sandbox.

### QA-002 — External runtime evidence

- **Component/file:** `tests/integration/outbox-redis.test.ts`, `.github/workflows/ci.yml`, future client E2E tests.
- **Issue/evidence:** healthy Redis delivery is skipped, GitHub CI has not executed here, and no Android/iOS device run exists.
- **Severity/impact:** high release-readiness gap; no all-platform or queue-success claim is supported.
- **Recommended solution:** run the existing Redis test with its guarded local database, ordinary frozen workspace installation and CI, followed by browser and real native runtime tests.
- **Complexity/dependencies:** Redis/CI/device environment availability. No paid provisioning is authorised by this recommendation.
- **Status:** BLOCKED.
- **Verification:** fake-provider and outage tests are distinct from healthy queue execution. Compilation/export cannot stand in for device execution.
- **Rollback:** keep test records isolated; stop only task-owned services. No destructive resets.

### CONT-001 — Content publication gate

- **Component/file:** `packages/database/src/fixtures/`, `docs/content-policy.md`.
- **Issue/evidence:** 50 original development questions and five lessons explicitly retain pending review metadata. Structural validation is not subject/editorial approval.
- **Severity/impact:** high content-integrity release gate, already recognised by the approved scope.
- **Recommended solution:** independent review of keys, assumptions, diagrams, alternative sequence rules, hints and explanations. Keep the development label and production bypass rejection until then.
- **Complexity/dependencies:** human subject/editorial review; no invented sign-off.
- **Status:** BLOCKED.
- **Verification:** content/configuration tests passed; no human review has occurred.
- **Rollback:** retain immutable historical versions. Corrections require new versions rather than rewriting used questions/results.

### DEP-001 — Dependency advisory triage

- **Component/file:** `pnpm-lock.yaml`; Expo → `@expo/cli` → `glob` → `minimatch`.
- **Issue/evidence:** registry scans report moderate advisories for installed `glob` 13.0.7 and `minimatch` 10.2.6. Maintainer advisories describe cancellation continuing traversal and pattern-expansion resource consumption respectively. See the [glob advisory](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).
- **Severity/impact:** registry severity moderate. An attacker-controlled API path into these operations was not found; the observed dependency path is through Expo CLI tooling. Native/web bundle reachability has not been verified.
- **Recommended solution:** investigate an upstream-compatible Expo/CLI patch, then exact-lock the compatible change and run installation, Expo export and client checks. The advisories list fixes in glob 14.0.2+ and minimatch 11.0.1; these cross installed major versions, so do not force an untested override.
- **Complexity/dependencies:** compatibility investigation; major dependency changes require the review/approval specified in the pasted brief.
- **Status:** NOT STARTED.
- **Verification:** production/default scans exit 1 with two moderate entries; explicit development scan exits 0 with none returned. These are registry results, not exploit reproduction or a complete supply-chain certification.
- **Rollback:** preserve exact current manifests/lockfile and restore them if a reviewed update breaks exports; never run automatic force-fix commands.

### PERF-001 — pg compatibility warning

- **Component/file:** installed pg / `@prisma/adapter-pg` / Prisma interpreter; session read/create paths.
- **Issue/evidence:** unsuppressed warning states that submitting a query while another is executing is deprecated for pg 9. Trace identifies `Client.query` → `PgTransaction.performIO` → `PgTransaction.queryRaw` → Prisma interpreter. This establishes the observed call chain, not a fully diagnosed upstream cause.
- **Severity/impact:** medium maintenance/compatibility concern. Current pinned pg 8 transactions, race tests and rollback tests pass; no measured corruption or latency regression was found.
- **Recommended solution:** investigate the maintained adapter's supported combination and a minimal upstream-compatible remedy. Keep pg pinned; compare the same baseline before/after any change. Do not suppress warnings or rewrite the adapter speculatively.
- **Complexity/dependencies:** investigation; any dependency change needs compatibility evidence.
- **Status:** IN PROGRESS.
- **Verification:** trace, successful creation and current local timing baseline retained. No performance improvement is claimed.
- **Rollback:** no product optimisation implemented; retain current pins until a reviewed change is validated.

### SEC-001 — Browser security verification

- **Component/file:** future Next.js layout/proxy/route configuration and client API/cache code.
- **Issue/evidence:** the browser application does not yet exist, so CSP, frame restrictions, referrer policy, private/no-store handling, authenticated HTML indexing and client-bundle solution isolation cannot be verified. Existing product API responses use no-store.
- **Severity/impact:** medium verification/readiness gap, not a demonstrated XSS or cache leak.
- **Recommended solution:** implement policies appropriate to Next.js and test delivered headers, browser caches, RSC/HTML and public bundles. Preserve maintained origin/CSRF controls. Authenticated learner pages should not expose private session content to indexing. See [OWASP HTTP header guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html).
- **Complexity/dependencies:** web implementation and real browser execution.
- **Status:** NOT STARTED.
- **Verification:** no browser header, SEO or bundle-security pass is claimed.
- **Rollback:** change headers incrementally against a real browser; retain working authentication and navigation. No blanket insecure CSP exception is proposed.

### DEV-001 — Local version-control checkpoint

- **Component/file:** protected `.git/index` and current working tree.
- **Issue/evidence:** earlier Git add/commit attempts could not create `index.lock`. A new scoped metadata grant on 11 November restored staging access. Accepted Task 4/5 source and audit documentation are prepared for a development checkpoint; unfinished web helpers are excluded.
- **Severity/impact:** medium recovery/workflow issue, not an application vulnerability.
- **Recommended solution:** commit the accepted checkpoint and retain review snapshots; configure the intended private remote before pushing.
- **Complexity/dependencies:** environment access.
- **Status:** ACCESS RESTORED; checkpoint prepared.
- **Verification:** scoped metadata permission allowed staging; the staged diff excludes environment secrets, generated dependencies and unfinished web helpers. Full review packages retain the accepted source hashes.
- **Rollback:** preserve the working tree. Do not use clean/reset commands to remove unfinished or unrelated work.

### ERR-001 — Corrected error response contract

- **Component/file:** `apps/api/src/errors.ts`, `apps/api/src/app.ts`, `tests/unit/auth-transport.test.ts`.
- **Original problem/root cause:** the handler constructed message keys such as `errors.NOT_FOUND`; the public schema rejects underscores. The handler then threw while normalising an error and Fastify returned its fallback format.
- **Evidence/severity:** two security tests reproduced malformed 400/404 response bodies. This was a medium API contract defect; credential exposure was not demonstrated.
- **Exact change:** explicit message-key mapping for all public error codes; strict DTO schema retained. Parser/body-limit/rate-limit and session error tests cover delivered responses.
- **Complexity/dependencies:** small existing-handler correction; no dependency or schema change.
- **Status:** COMPLETED.
- **Verification/before-after:** focused security progressed from 5 passing / 2 failing to 7 passing; security plus transport 11 passing. Full default suite 122 passed. This is a functional improvement, not a speed measurement.
- **Security/SEO impact and remaining risks:** bounded consistent errors; no SEO surface yet. Overall Task 4 independent review remains pending.
- **Rollback:** revert only the mapping/handler correction if a reviewed alternative is adopted; retain regression tests and never restore malformed responses as an accepted outcome.

## D. Safe, justified improvements

Already implemented and tested during Task 4: required ownership checks and strict DTO projection, canonical idempotency replay, atomic scoring/outbox writes, example exclusion, active-session recovery/abandonment, CI migration ordering and corrected error normalisation. The session creation defect was diagnosed as an invalid nested owner field; Prisma now inherits ownership from the parent while database foreign keys remain intact.

No application optimisation or dependency update was made after receiving the audit brief. Its requested audit-before-next-change checkpoint is honoured. The timing and registry commands above were measurements, using synthetic local data.

Future low-risk work should use the existing framework: explicit loading/error states, stable layout, aborting obsolete requests, retry-safe mutations and bounded public DTOs. Memoisation, caching, new indexes and infrastructure require a measured reason rather than a checklist-driven addition.

## E. Decisions and approval boundaries

Previously approved monorepo/learning scope remains valid. No new framework, schema model or paid infrastructure is needed for the immediate path.

The pasted brief requires review before the next change and explicit approval for major dependency/schema/architectural changes, paid infrastructure and deployment. Dependency remediation must first establish compatibility; no major override has been applied. Hosting, production allowances, external monitoring, production roles/backup/restore, real mail, live payments and release remain separate decisions. No deployment or messages to real recipients occurred.

## F. Step 1 — close the session review gate

Resume the existing independent Task 4 reviewer against the frozen source snapshot when availability returns, then fix any material findings with focused regressions and scoped re-review. Acceptance requires separate spec and quality verdicts, the current evidence gaps retained, and no unreviewed source changes. This is the highest-priority next action because the UI will rely on session ownership, immutability and grading.

The requested implementation sequence then continues: static authored help/progress → polished web learner flow → native learner flow → full click/device verification and final audit update. A test-only backend or clickable mock-up will not be labelled a functioning end-to-end application.

**Review checkpoint:** the user approved proceeding after the audit. Step 1's independent review is complete; execution has moved to Task 5. Existing approval for the learner milestone persists, without another design approval loop.

## UI and click-test acceptance criteria

- Use the approved navy/blue/light-neutral design with readable hierarchy, deliberate question layouts and structured accessible diagrams. Externalise UK English strings. Development-content labels remain visible. No invented progress, mastery or employer-pass probabilities.
- Build working sign-in, recovery, lesson, practice, results and progress routes. Show honest empty, loading, blocked, unavailable and retry states. Confirm persisted server state before showing saved/scored success.
- Exercise each of the five categories through lesson → a different practice problem → commit → authorised static feedback → submit → actual results. Derive counts from persisted items; current practice banks exclude examples and contain nine candidates per category.
- Click-test double submission, dropped responses, same-key retry, reload recovery, active-session resume/abandonment, expired sessions, unauthenticated access and denied access. Inspect database state rather than trusting button disablement.
- Verify hints and explanation permissions, pre-/post-answer assistance records, report behaviour and real-data summaries after Task 5 exists. Direct active-Mock/Daily help requests must remain blocked even when UI controls are bypassed.
- Inspect desktop and narrow viewports in a real browser; capture screenshots. Verify keyboard order/focus, semantic controls, alternative diagram text, reduced motion, error announcements and no horizontal overflow. Measure browser performance only once real pages exist; label throttled/network simulations explicitly.
- Inspect HTML/RSC payloads and client bundles for premature keys/explanations and private package imports. Verify cookie forwarding, CSRF/origin restrictions, no-store behaviour and appropriate browser headers against the running application.
- Execute native runtime journeys on available devices/emulators. Record export/type checks separately from actual device execution. Keep Daily/Mock features visibly unavailable until implemented.

## Evidence and recovery locations

Source and reviewed decisions are in the repository; ignored local evidence is in `.superpowers/sdd/2026-11-08-learn-practice-results/`:

- `task-4-report.md`, `task-4-review-diff.txt` — implementation report and frozen full-source review snapshot.
- `task-4-corrected-red-integration.log`, `task-4-corrected-red-security.log` — 18 initial missing-route failures before runtime implementation.
- `task-4-green-integration.log`, `task-4-green-errors-security.log`, `task-4-full-default.log`, `task-4-full-integration.log` — passing scoped/default/explicitly filtered checks.
- `task-4-pg-warning.log` — unsuppressed warning trace.
- `dependency-audit.log`, `dependency-audit-all.log`, `dependency-audit-dev.log` — registry results, including nonzero advisory exits.
- `audit-api-baseline.json`, `audit-api-baseline.log` — measured local timing baseline.

Ignored evidence is local and must be retained alongside the working tree during recovery. The document embeds the key results so it remains understandable without those logs. Further audit revisions must preserve dates, exact executed checks, unresolved statuses and the distinction between local measurements and production results.
