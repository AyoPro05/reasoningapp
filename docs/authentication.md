# Authentication and local delivery (Task 3)

This slice runs maintained Better Auth 1.7.18, its Prisma adapter and the
`@better-auth/expo` 1.7.18 server plugin through Fastify 5.12.8. Password hashing,
credential checks, signed cookies, email verification and recovery tokens remain
inside Better Auth. No custom password algorithm or mock authentication layer is used.

## Server interfaces

`buildApp({ db, config, mailProvider?, enqueueMail?, logStream? })` returns a ready
Fastify instance without opening a listener. The caller owns the injected Prisma
client and closes it on shutdown. `mailProvider` is a fake delivery boundary; auth
callbacks enqueue durable work and never call a provider directly. `enqueueMail`
allows controlled persistence failures in integration tests. `logStream` allows
private-data assertions against actual structured logs.

Auth endpoints are mounted at `/api/auth/*`. The minimal product probes are:

- `GET /v1/me`: `{ userId }` from a verified, authoritative auth session.
- `GET /v1/practice-access`: `{ allowed: true }` only with the server-owned
  `practice` entitlement. Other callers receive a 401 or 403 error DTO.

Public shapes are runtime schemas in `@reasoningapp/contracts`. Future product
routes call `requireLearner(request)`, then the bound
`request.server.requirePracticeAccess(userId)`. The entitlement service reads
PostgreSQL on every check: status ACTIVE, startsAt at/before server time, expiry
strictly after server time (or null), and revokedAt null. Query parameters,
identity headers and client subscription flags do not grant access.

The Prisma adapter maps session modelName to `authSession`, the client delegate
for the existing `AuthSession` model. `PracticeSession` is an assessment model and
is never used for authentication. User, Account and Verification are the existing
database models; this task adds no duplicate identity schema or migrations.

## Origins, cookies and transport

The Fetch Request URL is constructed from validated AUTH_URL plus the incoming
path/query, never Host or X-Forwarded-Host. Request headers are converted with
Better Auth's `fromNodeHeaders`. Each response cookie is copied with
`Headers.getSetCookie()`; cookies are never split on commas or joined together.

Cookies are host-only, HttpOnly, SameSite=Lax, Path=/, and Secure when AUTH_URL is
HTTPS. Cookie caching is disabled. `requireLearner` asks for a noncached session,
so database revocation, expiry and a newly unverified account apply immediately.
The verification bypass flag is rejected by this slice even in development.

Better Auth origin and CSRF checks are explicitly enabled, including NODE_ENV=test
(the library otherwise defaults origin checks off in tests). Fastify additionally
enforces exact configured origins, requires an Origin or configured Expo-origin
for unsafe methods, and blocks cross-site browser navigation for unsafe methods.
GET/HEAD/OPTIONS are exempt from the navigation-only rejection, so verification
and recovery links opened from webmail can reach Better Auth's token and callback
validation without an Origin header. Explicit untrusted origins remain rejected.
`null`, wildcard
origins, arbitrary Expo Go origins and other custom-scheme targets are rejected.
Credentialed CORS uses explicit HTTP origins only.

Fastify has trustProxy=false. The bridge overwrites `x-reasoningapp-client-ip` with
the trusted `request.ip`; Better Auth reads only this configured IP header.
Client X-Forwarded-For, X-Real-IP and forged internal headers cannot change the
limiter identity. Fastify limits each socket client to 60 requests/minute, and
Better Auth's maintained endpoint rules remain active (including its stricter
sign-in/signup and recovery rules). Both counters are process-local in this
local slice; multi-instance deployment needs a reviewed shared limiter and a
specific trusted-proxy policy. Never enable broad proxy trust to fix a test.

Bodies are limited to 32 KiB. The mounted adapter accepts JSON. Request/body/URL
and cookie logging is disabled; structured request serializers omit URLs/headers.
Better Auth's own raw logger is disabled because callback and origin errors can
include private URLs. Application failure logs contain fixed codes/request IDs,
never errors, tokens, passwords, recipients or payloads.

## Later web and native clients

Web clients will use a same-origin proxy for `/api/auth/*` and `/v1/*` to the API.
Forward Origin and Cookie unchanged and preserve every Set-Cookie header. Keep
the API cookie host-only and make browser fetches include credentials. Do not
store web session tokens in localStorage. The proxy and browser client belong to
later client tasks; neither is claimed implemented here.

Native clients will use `expoClient` from `@better-auth/expo/client` with the
`reasoningapp` application scheme and `expo-secure-store` storage. The server
plugin accepts the configured `reasoningapp://` Expo-origin, which the Fastify
boundary verifies exactly before the plugin can override Origin. There is no
`exp://` trust exception at the API boundary, even though the packaged Expo
plugin contributes it in development.

For physical-device LAN development, use an explicit reachable HTTP AUTH_URL
and matching WEB_ORIGIN in validated local configuration. Run a development
build with the configured scheme. Do not add wildcard CORS, disable CSRF or
trust all LAN/Expo Go origins. SecureStore integration, actual devices, browser
support and cookie behaviour on target platforms remain unverified until the
client tasks. HTTPS must terminate at a correctly configured proxy in a future
deployment; this local API listener does not provision TLS.

## Callback transaction and failure boundaries

The adapter explicitly uses its supported sequential mode (`transaction:false`).
Identity/account writes and application callback outbox writes are separate
commits. A successful user insert is not a mail receipt. Partial identity failure
is not claimed atomic. No callback transaction is inferred from an awaited hook.
The shared `enqueueAuthMail(tx, message)` accepts an existing Prisma transaction
and participates in that caller's commit/rollback where a caller actually owns
one; the integration test proves rollback and concurrent deduplication.

Verification/reset callbacks persist `auth.mail` events. Deduplication derives
from user ID and a SHA-256 digest of the private URL; welcome uses one stable
per-user key. Private links are in the restricted database payload only, never
queue job data or logs. Welcome is enqueued after verification, with an
idempotent retry at the next verified session creation. Unverified sessions
cannot trigger welcome through the product authorization gate.

Better Auth 1.7.18 catches errors from `runInBackgroundOrAwait`, including signup
verification-mail and password-reset-mail callbacks, even when no background
handler is configured. Signup can return 200 with token=null after callback
persistence fails. This means account creation succeeded, not email delivery.
The application catches the failure first, emits `AUTH_MAIL_ENQUEUE_FAILED`, and
attempts to persist a token-free `auth.mail.enqueue-failed` FAILED marker with
the template key and fixed reason. It then rethrows a sanitised error. Successful
resend resolves that enqueue marker; only the actual `auth.mail` row can later
record delivery. If PostgreSQL itself is unavailable, a durable diagnostic
cannot be guaranteed: `AUTH_MAIL_FAILURE_MARKER_UNAVAILABLE` is logged. There is
no claim of durable delivery without a committed mail event.

The learner remains unverified and can resend verification against the same
identity/account. Email verification uses the maintained signed JWT and does
not add duplicate Verification rows. Recovery uses the library's persisted,
expiring, consumable reset tokens. A repeated recovery request can legitimately
issue a new token; it is not the same operation as replaying a worker delivery.
The library directly awaits `afterEmailVerification`; welcome enqueue failure
can therefore return 500 after verification itself already committed. The next
verified sign-in repairs welcome without duplicating its outbox row.

## Durable outbox and BullMQ

`OutboxEvent` remains PostgreSQL's source of truth. Polling publishes only due
`auth.mail` IDs to BullMQ 6.7.2 using the pinned ioredis driver. Queue jobs contain
`{ outboxId }` only and use that ID as jobId. Publisher outages leave rows intact.
Jobs are removed on completion/failure; periodic database polling can republish
due work. Failure markers and deferred workflow events are not published.

Producer connection/command timeouts are one second, with a two-second publication
deadline that actively disconnects the underlying client. Producer reconnects are
disabled; a later database polling pass creates a fresh producer after disposing
the failed one. Aborting shutdown immediately interrupts pending producer work.
Both timeout and abort await the actual publication settlement and connection end;
there is no detached Promise.race operation. Worker shutdown marks the consumer
closing, makes its inherited Redis retry strategy stop-aware, and interrupts the
injected client through its real connection lifecycle. During reconnect backoff,
the next connecting transition is interrupted so readiness waiters receive an
actual end event. It lets Worker.close own blocking/backend cleanup and joins the
run before closing DB. Consumer reconnect and BullMQ run-retry delays are bounded
to 250 ms; the connection timeout remains one second. Backend readiness promises
are not bypassed with synthetic statuses or forced closed ahead of initialisation.
Signal listeners/deadline timers are removed.
This bounds Redis startup-outage waits; it does not promise bounded execution of
an unrelated stalled database/provider call. A failed publication leaves the due
row PENDING with its existing attempt count, available for a later polling pass.

A worker atomically claims a due PENDING or expired PROCESSING row using its
status and attempt generation, increments attempts and sets a 30-second lease in
availableAt. Concurrent claimants cannot both own the same generation. Completion
and failure updates include that generation as a fence, so a late old worker
cannot overwrite a newer receipt. An abandoned lease becomes claimable after
expiry. Mail failures use exponential delays (1, 2, 4, 8 seconds before the fifth
attempt), then retain a FAILED row. Invalid payloads/event types become DISABLED.
No raw exception is persisted or logged. This bound applies to handled provider
failures that persist their update. Repeated process crashes leave expired
PROCESSING leases recoverable and can exceed five claim generations before a
receipt/handled failure commits; it is not a total-five-external-calls guarantee.
Inspect terminal rows administratively; no public replay endpoint is exposed.

The provider receives the stable outbox ID as deliveryId. The fake sink remembers
IDs in memory, so acknowledgement loss followed by retry in the same process
does not duplicate its receipt. That map does not survive process restart.
Acceptance followed by a crash before the database receipt is an ambiguous
delivery; without a provider's durable idempotency guarantee, retry can duplicate
the external effect. This is not an exactly-once system. A slow provider can
outlive a lease; fencing protects database state, not an external side effect.
Only the fake provider is supported here.

MAIL_PROVIDER=mailpit is accepted by the shared configuration validator for a
future local transport, but Task 3 startup rejects it explicitly as unavailable.
It never substitutes fake delivery for Mailpit. SMTP transport, live providers,
real mail, billing and AI remain disabled. No SMTP connection is made.

## Development seed and verification

`seedVerifiedDevelopmentUser` is an explicit server-only helper. It requires
development/test, developmentFixturesEnabled and seedVerifiedUsers; production
always fails before writes. Only synthetic `@example.invalid` identities are
accepted. It uses Better Auth's maintained password hash, serialises matching
seed calls and creates one credential account plus a development-source practice
entitlement. It never verifies or overwrites an unrelated existing account.
Seeding is not run automatically at API startup, and an ordinary registration
does not receive a practice entitlement.

Portable project checks are `pnpm test`, `pnpm typecheck`, `pnpm build` and
`pnpm test:integration -- auth outbox`. Build covers shared packages, the API and
worker; it is a type-checked source build, not a deployment bundle. Tests use
the existing optional test-env loader with inherited CI environment priority.
Task 3 DB tests require explicit loopback:55432/reasoningapp_integration and
remove only their own run's records. They never reset a database.

Run `pnpm dev:api` and `pnpm dev:worker` in separate terminals for the local slice.
Both use the directly declared, pinned root tsx 4.23.15 dependency and optionally
load root .env through Node 24's `--env-file-if-exists=.env`.
Inherited environment variables retain priority. API uses validated
AUTH_URL for its local listener. Worker needs the configured local Redis service;
starting it without Redis does not establish queue availability. No scratch helper
or shell-specific script is part of the tracked runtime commands.

The real-Redis integration test requires RUN_REDIS_INTEGRATION=true and an explicit
loopback Redis database 15. CI enables it against its Redis service and maps
PostgreSQL to port 55432. It checks retained jobs across producer restart,
ID-only queue payloads and a failed-send retry. Local Redis/Docker are unavailable;
the test is skipped locally, and passing fake-broker tests do not prove queue
runtime behaviour. CI execution is required before claiming Redis verification.

Full practice/session engine, native/web auth clients, social sign-in, device
leases/transfers, live subscriptions, publication, production deployment, full
Mock/Daily/Review flows and other V3 automation remain deferred.

Integration references: the coordinator verified the official
[Fastify integration guide](https://better-auth.com/docs/integrations/fastify).
Actual options/semantics were checked against the installed 1.7.18 package
sources and BullMQ 6.7.2/ioredis APIs; no inaccessible network tools were used.
