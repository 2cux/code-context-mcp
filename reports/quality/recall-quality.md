# Recall Quality Report

GeneratedAt: 2026-07-14T07:58:22.110Z
Git commit: 36b901ce61b2c99153d2ea4ba31db120d33eb12a
Git dirty: true
Fixture version/hash: recall-quality-gate-v1 / b1a9dbd3ef2d43eb5c557bf4fe62c527d33c151aacd4b16513281d1ec8f3fe6a
Repeatable command: `npm run quality:reports`

## Baseline Measurement

Threshold: none enforced (baseline measurement only).
Measured result: Recall@1 100.0% (20/20), Recall@3 100.0% (10/10), false recall 0.0% (0/5), cross-scope hits 0, non-active leaked IDs 0, duplicate result sets 0.
Verdict: MEASURED

## Release Gate Result

Threshold: Recall@1 >= 80.0%, Recall@3 >= 95.0%, cross-scope hits = 0, non-active leaked IDs = 0, duplicate result sets = 0. False recall is informational.
Measured result: Recall@1 100.0%, Recall@3 100.0%, cross-scope hits 0, non-active leaked IDs 0, duplicate result sets 0.
Verdict: PASS

## Recall@1 Details

| Query | Target | Rank | In Top 1 | Total Results |
|---|---|---:|---|---:|
| pnpm package manager lock file | Always use pnpm | 1 | yes | 3 |
| TypeScript strict mode tsconfig noUncheckedIndexAccess | Enable TypeScript strict mode | 1 | yes | 4 |
| ESLint flat config eslint.config.mjs | Use ESLint flat config | 1 | yes | 6 |
| React Router v6 lazy loading client-side routing | Decided to use React Router v6 | 1 | yes | 5 |
| SQLite sql.js WASM storage architecture decision | Architecture decision: use SQLite | 1 | yes | 2 |
| Vitest test runner Jest alternative decision | Decided to use Vitest as the test runner | 1 | yes | 10 |
| WebSocket connections not cleaned up memory leak ChatWindow | WebSocket connections not being cleaned up | 1 | yes | 6 |
| race condition PaymentService double charge concurrent | race condition in PaymentService.processPayment | 1 | yes | 2 |
| N+1 query UserList SELECT roles performance | N+1 query in UserList | 1 | yes | 2 |
| auth redirect loop token expired interceptor 401 | auth redirect loop when token expires | 1 | yes | 2 |
| quality eval baseline memory recall benchmark | Building offline quality eval baseline | 1 | yes | 2 |
| API refactor express fastify zod validation | Refactoring the REST API layer: migrating from express to fastify | 1 | yes | 4 |
| vitest v2.0 jsdom v8 coverage test framework | vitest v2.0.0 — test runner | 1 | yes | 8 |
| zod v3.23 schema validation runtime type inference | zod v3.23.8 — schema validation | 1 | yes | 5 |
| express-rate-limit v7 Redis store middleware | express-rate-limit v7.2.0 | 1 | yes | 1 |
| React 18.3 concurrent useTransition useDeferredValue | react v18.3.1 + react-dom v18.3.1 | 1 | yes | 3 |
| session logout cookie Max-Age test failure AssertionError | should clear cookie on logout | 1 | yes | 9 |
| avatar URL CDN prefix uploads test failure | expected avatar URL to start with 'https://cdn.example.com' | 1 | yes | 8 |
| E2E checkout timeout element not visible flaky CI | TimeoutError: Test exceeded 30000ms | 1 | yes | 10 |
| bulk tiered discount price calculation AssertionError 10000 | should apply tiered discount for bulk orders | 1 | yes | 3 |

## Recall@3 Details

| Query | Target | Rank | In Top 3 | Total Results |
|---|---|---:|---|---:|
| package manager lock file dependencies | Always use pnpm | 1 | yes | 3 |
| frontend routing framework decision architecture | Decided to use React Router v6 | 1 | yes | 4 |
| memory leak performance cleanup component bug | WebSocket connections not being cleaned up | 1 | yes | 5 |
| test runner framework coverage vitest | vitest v2.0.0 | 1 | yes | 5 |
| API refactor migration backend framework | Refactoring the REST API layer | 1 | yes | 5 |
| test failure assertion logout cookie session | should clear cookie on logout | 1 | yes | 5 |
| type safety TypeScript config strict settings | Enable TypeScript strict mode | 1 | yes | 5 |
| validation schema runtime type checking | zod v3.23.8 | 1 | yes | 5 |
| architecture decision storage database local | Architecture decision: use SQLite | 1 | yes | 2 |
| pricing calculation discount order bulk failure | should apply tiered discount | 1 | yes | 3 |

This report separates current baseline measurements from the release gate. Baseline values are not release results.
