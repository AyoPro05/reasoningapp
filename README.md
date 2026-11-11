# ReasoningApp

Greenfield implementation of the Version 3 consumer reasoning practice specification.

## Current status

Design approved on 8 November 2026; subagent-driven implementation is underway. The workspace, persistent content, authentication/outbox, catalog/session engine and static learning support/progress have passed independent review. Web interface implementation is now underway; native screens follow.

The repository includes the Prisma schema, three forward migrations, private scoring and validation, 50 unreviewed development questions and five lessons. See the [dated delivery checkpoint](docs/delivery-status.md) for current test results and environment gaps. These checks do not establish a complete learner application or native-device compatibility.

The agreed first milestone is Learn → Practice → results on Next.js web and Expo mobile, backed by a shared Fastify API and PostgreSQL, with original development samples across five reasoning categories.

- [V3 specification](docs/specs/ReasoningApp-v3.md)
- [Delivery prompt](docs/specs/delivery-prompt.txt)
- [Approved greenfield design](docs/specs/2026-11-08-greenfield-design.md)
- [Implementation plan](docs/superpowers/plans/2026-11-08-learn-practice-results.md)
- [Performance and security audit](PERFORMANCE_SECURITY_AUDIT.md)

Generated sample content requires independent subject and editorial review before publication. AI, billing and production deployment remain disabled/deferred.
