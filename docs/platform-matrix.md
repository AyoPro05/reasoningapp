# Platform and verification record

Checked 8 November 2026. This is the Task 1 foundation, not a runnable learner
application or a claim of device support.

## Version selection

- Node **24.22.2 LTS**, pinned by `.node-version` and `engines.node`; pnpm
  **10.34.9**, pinned by `packageManager` and `engines.pnpm`. The initially
  installed Node 26.13.0 was not assumed compatible. The official release page
  currently lists both 24 and 26 as LTS; Prisma's documented Node ranges include
  24 and do not include 26. The common documented choice is Node 24.
  [Node release status](https://nodejs.org/en/about/previous-releases),
  [pnpm compatibility](https://pnpm.io/installation).
- Expo **58.0.23**, React **19.3.0**, React Native **0.88.1**. The controller
  checked npm metadata and Expo's packaged `bundledNativeModules.json` before
  installation. Expo's engine range is `^22.13 || ^24.3 || ^26 || >=27`; the
  SDK reference pairs SDK 58 with React 19.3 and React Native 0.88. Both clients
  use React 19.3.0 to match Expo, rather than the newer npm React patch.
  [Expo compatibility reference](https://docs.expo.dev/versions/latest/).
- Next.js **16.4.5** and React DOM **19.3.0**. The documented Node floor is
  20.9; Node 24 meets it. Browser floors in the installation documentation are
  Chrome/Edge 111, Firefox 111 and Safari 16.4. These are upstream requirements,
  not evidence that this app has run in those browsers.
  [Next.js installation](https://nextjs.org/docs/app/getting-started/installation).
- Prisma CLI and client **7.10.1**. npm's `latest` tag pointed to a version 8
  release candidate, so the controller selected the stable version 7 release.
  Official version 7 requirements are Node `^20.19.0`, `^22.12.0` or `^24.0.0`
  and TypeScript 5.4+. The schema, generated client, migrations and seeds are
  Task 2; they have not been implemented or verified here.
  [Prisma system requirements](https://www.prisma.io/docs/orm/reference/system-requirements).
- Fastify **5.12.8**. Its version 5 floor is Node 20, and its LTS policy covers
  supported Node LTS releases. Fastify is installed for the API; no API server
  is implemented in Task 1.
  [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/).
- BullMQ **6.7.2**, Zod **4.6.7**, TypeScript **7.0.2**, Vitest **5.1.0**,
  Playwright **1.65.0**, Node types **24.19.2**. Exact direct pins were supplied
  by the controller's npm registry checks; `pnpm-lock.yaml` pins transitive
  resolutions and integrity hashes. No wildcard or prerelease direct versions.

## Workspace and commands

Run from the repository root with the pinned Node/pnpm on PATH:

```powershell
pnpm install --frozen-lockfile
pnpm test tests/unit/config.test.ts
pnpm test
pnpm typecheck
pnpm build
docker compose -f infra/compose.yaml config
```

`test` runs actual Vitest unit/content/security suites, failing when no tests
exist. `typecheck` checks all current source and tests. `build` emits JavaScript,
declarations and source maps for the shared foundation in `dist/packages`.
Application compilation, Expo export and native builds are later tasks; the
foundation build is not evidence for any of them. Public package exports target
TypeScript source for downstream Next/Expo bundlers; the emitted foundation is
not a standalone server deployment.

`test:integration` invokes a separate Vitest configuration against
`tests/integration`; `test:e2e` invokes Playwright against `tests/e2e`. Both fail
with no tests, rather than returning an empty success. `db:migrate` invokes the
database package's real Prisma migrate command; `db:seed` invokes its real Node
TypeScript seed entry point. Schema/seed files belong to Task 2 and are absent.
These four commands are deliberately not green Task 1 acceptance checks. They
must become working evidence in the tasks that implement their prerequisites.

All seven approved packages exist. Config, database, question-validation and
scoring-engine are server-only dependencies. Web/mobile declare only contracts,
question-render-spec and design-tokens from this workspace. The private package
manifests reserve their responsibilities without inventing a database, scoring
algorithm or authoring validation ahead of Task 2. Auth, the worker, learner UI,
content, progress services and assistance authorisation are also deferred.

## Environment and local services

Copy `.env.example` to `.env`, generate a random auth secret using its documented
command, then configure server startup to call `readConfig(process.env)` in the
task that creates the server. Config import has no process-wide side effects.
The placeholder secret is deliberately invalid. `NODE_ENV` is required;
`APP_ENV`, when set, must match. Defaults disable all development bypasses, AI,
billing and email delivery. Production rejects every fixture, unreviewed-content,
verified-seeding and verification bypass flag, plus Mailpit/SMTP settings. AI
and live billing cannot be activated in any environment.

Browser/auth URLs must be exact HTTP(S) origins without credentials, paths,
wildcards, queries or fragments; production requires HTTPS. `TRUSTED_ORIGINS`
accepts only the configured browser origin and the fixed `reasoningapp://`
native scheme. No arbitrary native URI, Expo Go wildcard or extra origin is
trusted. LAN/native auth configuration must be specified and tested in Task 3.
Public DTO validation is a shape boundary; it does not replace server ownership,
entitlement, solution-release or eligibility checks in later tasks.

Compose declares PostgreSQL **18.6-alpine**, Redis **8.2.2-alpine** and Mailpit
**v1.27.10**, with loopback-only exposed ports and persistent local DB/Redis
volumes. Mailpit has no forwarding or relay configuration. Use
`docker compose -f infra/compose.yaml up -d` on a host with Docker available.
The Compose syntax is validated locally; image pulls and running-container
health have not been verified in this worker. Credentials in Compose are local
development examples only.

CI uses an ephemeral PostgreSQL service named `reasoningapp_test`, isolated by
GitHub Actions job lifetime, and a separate Redis logical DB. `MAIL_PROVIDER`
is explicitly `fake` and every bypass/AI/billing flag is false. CI runs the
foundation suite, typecheck, build and Compose validation. Its real integration
step becomes active only when Task 2 supplies integration tests; it makes no
claim to have run the absent suite. No external email provider is configured.

## Actual local evidence and limits

- Windows PowerShell: unit tests, TypeScript checks, shared compilation and
  Docker Compose configuration validation executed using local Node 24.22.2
  and pnpm 10.34.9. Full counts and RED/GREEN evidence are in the Task 1 report.
- Network installation is performed by the controller. This worker's initial
  registry request failed DNS; no further permission/network requests were
  made after the revised handoff. Local tool bootstrap is ignored under `work`.
- The controller reports a successful offline frozen installation with the
  sandbox-only `--config.symlink=false` override. Prisma engine/preinstall
  scripts completed. The only installation warning was a skipped optional
  `msgpackr-extract` native optimisation; no worker runtime has been executed.
- The sandbox blocks directory symlinks/junctions. `node-linker=hoisted` avoids
  deep Expo peer paths and `inject-workspace-packages=true` requests injected
  dependencies, but pnpm still attempts workspace links in this environment.
  The controller owns the sandbox-only install workaround and physical package
  copies. Do not commit `symlink=false` or treat copied packages as proof of a
  normal install. TS paths and Vitest's source alias check the actual live source.
  After source changes, scratch copies must be refreshed before runtime use.
- `.npmrc` keeps the pnpm store inside ignored `work/pnpm-store`; exact engine
  requirements intentionally reject the system fallback pnpm/Node. The local
  controller wrapper must put both pinned Node and pnpm launchers on PATH for
  nested package-manager commands.
- Docker daemon execution, Linux/macOS execution, web browser flow, Expo bundle
  export, Android emulator/device and iOS simulator/device flows are unverified.
  CI is authored but has not been run on GitHub. Android's proposed product
  baseline and SDK-dependent iOS/Xcode floors remain for Task 7 verification.
- There is no production-eligible content. Independent editorial review, all
  learner flows and the later V3 workflows remain deferred. No deployment,
  provisioning, publication, live billing, AI or real recipients are enabled.
