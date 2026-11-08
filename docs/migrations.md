# Database migrations and local verification

The database uses PostgreSQL and Prisma **7.10.1**, with `@prisma/adapter-pg` **7.10.1** and `pg` **8.23.1**. `packages/database/prisma.config.ts` uses v7 `defineConfig`, with the datasource URL in config rather than the Prisma schema. It loads the ignored local `.env` only as a fallback; inherited variables take precedence. Never log environment values. The maintained Better Auth core mapping is included without enabling auth workflows.

## Generate, build and migrate

Use Node **24.22.2** and pnpm **10.34.9**. Product scripts are platform-neutral. On this controller machine invoke them through `./work/pnpm.ps1`; the ignored helper supplies the pinned runtime and pnpm PATH. A normal checkout uses the same scripts through installed pnpm. `work/` is not a product dependency.

```sh
pnpm install --frozen-lockfile
pnpm --filter @reasoningapp/database db:generate
pnpm exec prisma validate --config packages/database/prisma.config.ts
pnpm --filter @reasoningapp/database db:deploy
pnpm --filter @reasoningapp/database db:seed
pnpm test tests/content
pnpm test:integration -- database
pnpm typecheck
pnpm build
```

Generate before typechecking/building a clean checkout. The `prisma-client` generator emits to ignored `packages/database/src/generated/prisma`, uses ESM and `importFileExtension="js"`, and is reproducible through `db:generate`. Do not commit the generated tree. Root TypeScript compilation includes the generated source and emits its JavaScript beside the compiled database client. The server-only package entry exports the single `createDatabaseClient(databaseUrl)` factory; each process owns its client lifecycle and disconnects at shutdown. The factory supplies `new PrismaPg({connectionString})`, not the removed v6 datasource constructor API. The seed runs via pinned `tsx` and does not execute simply by importing the database package.

Three migrations are required: `20261108170000_task2_foundation` (Prisma-generated tables, enums, indexes and foreign keys), `20261108170100_integrity_guards` (PostgreSQL checks, partial active-session index, immutable-content triggers and item validation), and `20261108174500_required_arrays_immutable_mode` (required-array NOT NULL constraints and immutable parent session mode). The third is a forward correction; the first two applied migrations remain unchanged. Future Prisma diffs do not recreate the custom SQL. Keep those guards when changing schema; review migration SQL rather than using `db push` as a replacement. Initial schema SQL is generated with:

```sh
pnpm exec prisma migrate diff --config packages/database/prisma.config.ts --from-empty --to-schema packages/database/prisma/schema.prisma --script --output packages/database/prisma/migrations/20261108170000_task2_foundation/migration.sql
```

For the authorised local setup, PostgreSQL **18.6** listens on loopback port **55432**. `reasoningapp_dev` is the development database. Real integration tests explicitly require UTF8 **reasoningapp_integration**, `NODE_ENV=test`, and a loopback host, using ignored `.env.test`. They never truncate/reset the database and clean up only their UUID-scoped test records. Do not use the unrelated `reasoningapp_test` scratch database, whose WIN1252 encoding is unsuitable. No Docker or WSL is required for this machine's existing native service.

The v7 native migration engine needs the datasource supplied by `--config`, including for an empty-to-schema diff. Omitting it can produce no SQL despite CLI exit code 0: parent DEBUG output identified a missing `--datasource <JSON>` engine argument. Check that the output file exists and is non-empty; never interpret exit code alone as successful generation. This was a missing-config command issue, not a demonstrated sandbox/native-engine restriction.

The worker cannot access loopback sockets. Parent commands for test migrations must inherit `.env.test` explicitly, for example:

```powershell
./work/pnpm.ps1 exec node --env-file=.env.test node_modules/prisma/build/index.js migrate diff --config packages/database/prisma.config.ts --from-empty --to-schema packages/database/prisma/schema.prisma --script --output packages/database/prisma/migrations/20261108170000_task2_foundation/migration.sql
./work/pnpm.ps1 exec node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy --config packages/database/prisma.config.ts
./work/pnpm.ps1 test:integration -- database
```

This does not run a destructive reset. Deploying into a non-empty database with unrelated tables requires deliberate baselining, not guessing or marking migrations applied. Record actual command results separately from commands awaiting parent execution.

Tracked CI provisions `reasoningapp_integration`, generates the ignored client before source checks and deploys all tracked migrations before integration tests. `.env.test` is optional: missing files are ignored only for `ENOENT`, while inherited CI variables take precedence over local values. Integration tests retain their exact loopback/database/test-environment guard. CI enables `DEVELOPMENT_FIXTURES_ENABLED` and `ALLOW_UNREVIEWED_CONTENT` only on the integration step; email verification bypass, verified-user seeding, AI and billing flags remain false. The tests seed content without creating users through an auth bypass. Actual user/auth tests create explicit UUID-scoped synthetic rows and remove them afterwards.

## Required arrays and fixed session mode

Prisma 7's `String[]` scalar-list syntax does not encode an explicit PostgreSQL column NOT NULL constraint: the generated initial DDL left `SessionItem.optionOrder` and `ExplanationVersion.workedSteps` nullable. `cardinality(NULL)` is NULL, and a PostgreSQL CHECK accepts that UNKNOWN result. The forward correction explicitly sets both columns NOT NULL while retaining all existing non-empty/cardinality checks. Do not drop these custom column constraints in a future generated migration or assume that Prisma's required TypeScript list type enforces raw SQL writes. Omitted and explicit SQL NULL values must fail; empty arrays must still fail their existing checks. No default empty array or invented historical values are introduced.

`PracticeSession.mode` is immutable at the database boundary for the entire session lifetime. A valid item cannot acquire a different release meaning through a later parent-mode update. Same-mode writes and ordinary state changes remain allowed. This trigger is custom SQL and must also be preserved by future migrations. Start a separate session when changing mode; do not rewrite an existing session's mode.

The forward correction is explicitly transactional. Existing NULL arrays cause SET NOT NULL to fail and the correction rolls back; inspect and repair such data through a reviewed process before retrying. Do not fabricate option order or worked steps, mutate published content, or rewrite the first two migration files to make deployment pass. The focused regression suite uses rollback-only synthetic transactions, including on baseline failures, so it leaves no active session or invalid array row behind.

## Better Auth mapping

`User` maps to SQL `user` and preserves `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`. `AuthSession` maps to `auth_session` and preserves the maintained library's `id`, unique `token`, `expiresAt`, `ipAddress`, `userAgent`, timestamps and cascading `userId` relation. Task 3 must configure Better Auth with `session: {modelName: 'AuthSession'}` and the Prisma adapter's PostgreSQL provider. The Prisma delegate is `authSession`; product assessment sessions remain `PracticeSession`.

`Account` maps to `account`: account/provider/user IDs, password hash, access/refresh/ID tokens, token expiry dates, scope and timestamps. Unique `(providerId,accountId)` prevents duplicate linked identities. `Verification` maps to `verification` with identifier, value, expiry and timestamps; it deliberately has no fabricated required user relation because email/recovery verifications can precede a user account. Identifiers are indexed, not unique, so maintained verification lifecycles can create more than one record. `emailVerified` defaults false. Schema compatibility does not claim an executed Better Auth flow; Task 3 must verify the chosen maintained release against this deliberate mapping.

## Task 4 locking and idempotency contract

The unique partial index permits at most one `CREATED`, `IN_PROGRESS` or `SUBMITTED` assessment session per user, across all modes. Treat submitted-but-not-yet-scored as active. Expiration must be persisted before a replacement start; the index cannot depend on wall-clock time. Use a transaction and lock the owning `user` row before concurrent starts; handle the unique-conflict result explicitly.

Answer, hint, feedback release and submit operations must lock the owned `PracticeSession` row using parameterised `SELECT ... FOR UPDATE` before reading mutable state/deadlines, and then lock the item if needed. Every operation uses the same ordering: user (when starting), session, item. Submit waits for in-flight commits, closes answering and scores the persisted responses in the same transaction. Check a server-owned deadline after acquiring the lock. Never grade a client-supplied question or key. The unique current response per item and composite option/version FKs complement the lock; neither alone prevents a late answer racing submit. Response revisions, if later required, belong in separate history records, not extra current responses.

`IdempotencyRecord` stores `(userId,operation,key)` uniquely, an exact 64-character canonical request hash, session ownership, HTTP status, bounded replay DTO, creation and expiry. Hash the route/resource ID and normalised body, never credentials. After locking, consult the record before rejecting an already-transitioned state: identical retries return the original committed result, conflicting hashes return conflict. Commit the record, response/result, assistance/progress and relevant outbox writes together. A rolled-back transaction leaves no replay record. Do not persist solution-bearing replay bodies for unauthorised stages; recheck caller ownership and entitlement on replay. Cleanup must retain records for at least the supported retry window. Do not make network/provider calls inside these transactions.

Composite FKs bind responses and explanation versions to exact item versions. Item selection/order/release is immutable. Support events, tutor requests and reports also bind user ownership to the same item, and pre-answer tutor records cannot reference a full explanation context. SQL validates that option order contains every version option exactly once and that worked-example release is designated and Learn-only. These are storage protections; Task 4 still owns route authorisation and mode/state enforcement.

## Rollback and corrections

These are initial forward migrations; Prisma has no automatic safe down migration. On the explicitly disposable integration database only, a controller may recreate that named database after checking the resolved target and recording why. Never apply that procedure to an unknown database. Tests themselves do not recreate it.

For a shared database, take and verify a backup first and use a reviewed forward repair. Dropping tables would destroy historical versions, results, review decisions and audit records. Removing only the partial index reopens concurrency bugs; removing only triggers reopens published-content mutation. A failed PostgreSQL migration can leave partially executed DDL because Prisma migration files are not implicitly wrapped as a whole: inspect `_prisma_migrations`, actual objects and error output, then repair or restore before `migrate resolve`. Do not edit an applied migration checksum. Reverting application code does not reverse database data. Retire published content explicitly and author a new version for corrections.
