/**
 * Memory Fixtures — Recall Quality Gate
 *
 * Comprehensive fixed memory set covering 6 memory types:
 *   project_rule, decision (architecture_decision), bug (bug_fix),
 *   current_task (task_context), dependency, test_failure
 *
 * Layout:
 *   - SCOPE_A (primary, ~30 memories): active + non-active (superseded/forgotten/expired)
 *   - SCOPE_B (distractor, ~8 memories): different project, different tech stack
 *   - SCOPE_C (empty): for scope isolation baseline
 *
 * Design constraints:
 *   - No embedding or external model dependency
 *   - Varied confidence (0.55–0.95) for confidence-weight eval
 *   - Varied creation dates for recency-weight eval
 *   - Non-active memories included for leakage detection
 *
 * Query → target mappings are documented inline for each memory.
 */

import type { SaveMemoryInput } from "../../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export const QG_SCOPE_A = "quality-gate-scope-a";
export const QG_SCOPE_B = "quality-gate-scope-b";
export const QG_SCOPE_C = "quality-gate-scope-c";

// Fixed date offsets for recency-weight testing
const NOW = new Date("2026-07-08T12:00:00Z");
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

// ===========================================================================
// ACTIVE: project_rule (4 memories)
// ===========================================================================

const PROJECT_RULE_PNPM: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "project_rule",
  content:
    "Always use pnpm as the package manager. Never use npm or yarn. Lock file pnpm-lock.yaml is committed to the repo.",
  summary: "Use pnpm for package management",
  confidence: 0.95,
  sourceRef: "CLAUDE.md",
  tags: ["pnpm", "package-manager", "project-rule"],
};

const PROJECT_RULE_TS_STRICT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "project_rule",
  content:
    "Enable TypeScript strict mode in tsconfig.json. Set strict: true, noUncheckedIndexAccess: true, noImplicitReturns: true for all projects.",
  summary: "TypeScript strict mode required",
  confidence: 0.92,
  sourceRef: "tsconfig.json",
  tags: ["typescript", "strict", "config"],
};

const PROJECT_RULE_ESLINT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "project_rule",
  content:
    "Use ESLint flat config (eslint.config.mjs) with @typescript-eslint/strict-type-checked rules. No legacy .eslintrc files allowed.",
  summary: "ESLint flat config mandatory",
  confidence: 0.88,
  sourceRef: "eslint.config.mjs",
  tags: ["eslint", "linting", "project-rule"],
};

const PROJECT_RULE_FORMAT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "project_rule",
  content:
    "Code formatting: 2-space indentation, single quotes for strings, trailing semicolons required. Prettier config at project root.",
  summary: "Code formatting with Prettier, 2-space indent",
  confidence: 0.82,
  sourceRef: ".prettierrc",
  tags: ["formatting", "prettier", "project-rule"],
};

// ===========================================================================
// ACTIVE: decision / architecture_decision (4 memories)
// ===========================================================================

const DECISION_REACT_ROUTER: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "decision",
  content:
    "Decided to use React Router v6 for client-side routing with lazy loading via React.lazy(). Rationale: declarative routing, nested layouts, loaders for data fetching.",
  summary: "React Router v6 chosen for routing",
  confidence: 0.85,
  sourceRef: "conversation:2026-06-15",
  tags: ["react", "routing", "decision"],
};

const DECISION_VITEST: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "decision",
  content:
    "Decided to use Vitest as the test runner instead of Jest. Reasons: faster startup, native ESM support, Vite integration, compatible API with Jest.",
  summary: "Vitest chosen over Jest for testing",
  confidence: 0.88,
  sourceRef: "conversation:2026-05-10",
  tags: ["testing", "vitest", "decision"],
};

const DECISION_SQLITE: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "decision",
  content:
    "Architecture decision: use SQLite with sql.js (WASM) for local storage layer. No server process needed. FTS5 for full-text search when available, LIKE fallback otherwise.",
  summary: "SQLite via sql.js for local storage",
  confidence: 0.90,
  sourceRef: "docs/adr/001-storage-layer.md",
  tags: ["sqlite", "storage", "architecture", "decision"],
};

const DECISION_SSR: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "decision",
  content:
    "Architecture decision: client-side rendering (CSR) only, no SSR. Rationale: simpler deployment, lower server cost, the app is a dashboard so SEO is not required.",
  summary: "CSR only, no SSR needed for dashboard app",
  confidence: 0.78,
  sourceRef: "docs/adr/002-rendering-strategy.md",
  tags: ["csr", "ssr", "architecture", "decision"],
};

// ===========================================================================
// ACTIVE: bug / bug_fix (4 memories)
// ===========================================================================

const BUG_WEBSOCKET_LEAK: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "bug",
  content:
    "Bug: WebSocket connections not being cleaned up on component unmount. The cleanup function in useEffect is missing ws.close() call. Affects ChatWindow.tsx, causes memory leak after ~10 navigations.",
  summary: "WebSocket cleanup missing in ChatWindow",
  confidence: 0.90,
  sourceRef: "src/components/chat/ChatWindow.tsx",
  tags: ["websocket", "memory-leak", "bug"],
};

const BUG_RACE_CONDITION: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "bug",
  content:
    "Bug: race condition in PaymentService.processPayment(). Two concurrent calls can double-charge if the check and deduct are not atomic. Reproducible under load test with >100 concurrent requests.",
  summary: "Race condition double-charge in PaymentService",
  confidence: 0.93,
  sourceRef: "src/services/paymentService.ts",
  tags: ["race-condition", "payment", "bug"],
};

const BUG_NPLUS1_QUERY: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "bug",
  content:
    "Bug: N+1 query in UserList component. Each user row triggers a separate SELECT for roles. Should use eager loading with JOIN or batch fetch. Affects performance when >50 users listed.",
  summary: "N+1 query in UserList component",
  confidence: 0.87,
  sourceRef: "src/components/users/UserList.tsx",
  tags: ["n+1", "performance", "bug"],
};

const BUG_AUTH_REDIRECT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "bug",
  content:
    "Bug: auth redirect loop when token expires mid-session. The interceptor retries the failed request without refreshing the token first, causing infinite 401 → retry → 401 cycle.",
  summary: "Auth redirect loop on token expiry",
  confidence: 0.91,
  sourceRef: "src/middleware/authInterceptor.ts",
  tags: ["auth", "redirect-loop", "bug"],
};

// ===========================================================================
// ACTIVE: current_task / task_context (4 memories)
// ===========================================================================

const TASK_QUALITY_EVAL: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "current_task",
  content:
    "Building offline quality eval baseline for memory recall. Creating comprehensive fixtures, Recall@K metric computation, cross-scope isolation tests, and weight tuning for BM25/confidence/recency.",
  summary: "Memory recall quality gate implementation",
  confidence: 0.85,
  sourceRef: "conversation:2026-07-08",
  tags: ["quality", "eval", "current-task", "memory"],
};

const TASK_API_REFACTOR: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "current_task",
  content:
    "Refactoring the REST API layer: migrating from express to fastify, adding request validation with zod schemas, implementing structured error responses (RFC 7807 Problem Details).",
  summary: "API refactor: express → fastify + zod validation",
  confidence: 0.80,
  sourceRef: "conversation:2026-07-06",
  tags: ["api", "refactor", "fastify", "current-task"],
};

const TASK_UI_REDESIGN: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "current_task",
  content:
    "Redesigning the dashboard layout: moving from 3-column to 2-column grid, adding collapsible sidebar, implementing dark mode toggle with CSS custom properties.",
  summary: "Dashboard UI redesign with dark mode",
  confidence: 0.75,
  sourceRef: "conversation:2026-07-04",
  tags: ["ui", "dashboard", "redesign", "current-task"],
};

const TASK_PERF_OPTIMIZE: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "current_task",
  content:
    "Performance optimization sprint: lazy loading route components, image optimization with WebP, bundle splitting per route, reducing initial JS payload below 200KB.",
  summary: "Performance optimization — bundle size reduction",
  confidence: 0.82,
  sourceRef: "conversation:2026-07-02",
  tags: ["performance", "optimization", "current-task"],
};

// ===========================================================================
// ACTIVE: dependency (4 memories)
// ===========================================================================

const DEP_VITEST: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "dependency",
  content:
    "vitest v2.0.0 — test runner + assertion library. Configured in vitest.config.ts with jsdom environment for component tests and node environment for unit tests. Coverage via @vitest/coverage-v8.",
  summary: "vitest v2.0.0 test framework with v8 coverage",
  confidence: 0.90,
  sourceRef: "package.json",
  tags: ["testing", "vitest", "dependency", "v2"],
};

const DEP_REACT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "dependency",
  content:
    "react v18.3.1 + react-dom v18.3.1. Using concurrent features: useTransition, useDeferredValue. Type definitions from @types/react v18.",
  summary: "React 18.3 with concurrent features",
  confidence: 0.85,
  sourceRef: "package.json",
  tags: ["react", "frontend", "dependency", "v18"],
};

const DEP_RATE_LIMIT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "dependency",
  content:
    "express-rate-limit v7.2.0 — rate limiting middleware for Express. Configured: 100 req/15min window per IP, standard headers enabled, Redis store for distributed mode.",
  summary: "express-rate-limit v7.2 for API rate limiting",
  confidence: 0.88,
  sourceRef: "src/middleware/rateLimiter.ts",
  tags: ["rate-limit", "security", "dependency"],
};

const DEP_ZOD: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "dependency",
  content:
    "zod v3.23.8 — schema validation library. Used for: API request validation, environment variable parsing, form validation on the client. Runtime type inference via z.infer<typeof schema>.",
  summary: "zod v3.23 for schema validation",
  confidence: 0.92,
  sourceRef: "src/schemas/index.ts",
  tags: ["validation", "zod", "dependency"],
};

// ===========================================================================
// ACTIVE: test_failure (4 memories)
// ===========================================================================

const TEST_FAIL_SESSION: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "test_failure",
  content:
    "tests/unit/auth/session.test.ts > should clear cookie on logout — AssertionError: expected 'set-cookie' header to contain 'Max-Age=0' but got 'Max-Age=3600'. The logout endpoint sets session TTL instead of immediate expiry.",
  summary: "Session logout cookie expiry test failure",
  confidence: 0.95,
  sourceRef: "tests/unit/auth/session.test.ts",
  tags: ["test-failure", "auth", "session", "cookie"],
};

const TEST_FAIL_AVATAR: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "test_failure",
  content:
    "tests/component/ProfileAvatar.test.ts > should render uploaded avatar — AssertionError: expected avatar URL to start with 'https://cdn.example.com' but got '/uploads/avatar.png'. Missing CDN prefix configuration.",
  summary: "Avatar URL CDN prefix test failure",
  confidence: 0.88,
  sourceRef: "tests/component/ProfileAvatar.test.ts",
  tags: ["test-failure", "avatar", "cdn", "component"],
};

const TEST_FAIL_CI_TIMEOUT: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "test_failure",
  content:
    "tests/e2e/checkout.spec.ts > should complete purchase flow — TimeoutError: Test exceeded 30000ms timeout. Element 'button[data-testid=confirm-payment]' never became visible. Intermittent in CI (3/5 runs fail).",
  summary: "E2E checkout flow timeout in CI",
  confidence: 0.90,
  sourceRef: "tests/e2e/checkout.spec.ts",
  tags: ["test-failure", "e2e", "timeout", "flaky"],
};

const TEST_FAIL_PRICE_CALC: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "test_failure",
  content:
    "tests/unit/pricing/priceCalc.test.ts > should apply tiered discount for bulk orders — AssertionError: expected total to be 8500 (15% off 10000) but got 10000. The tiered discount function ignores order quantity >50.",
  summary: "Bulk discount tier calculation test failure",
  confidence: 0.92,
  sourceRef: "tests/unit/pricing/priceCalc.test.ts",
  tags: ["test-failure", "pricing", "discount", "calculation"],
};

// ===========================================================================
// NON-ACTIVE: superseded / forgotten / expired (5 memories — leakage targets)
// ===========================================================================

const SUPERSEDED_OLD_PNPM: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "project_rule",
  content: "Use npm as the package manager. Lock file is package-lock.json.",
  summary: "OLD: Use npm (superseded by pnpm rule)",
  confidence: 0.60,
  sourceRef: "CLAUDE.md",
  tags: ["npm", "package-manager", "superseded"],
};

const SUPERSEDED_OLD_ROUTER: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "decision",
  content:
    "Previously decided to use React Router v5 for routing. This decision is superseded by the React Router v6 decision.",
  summary: "OLD: React Router v5 (superseded by v6)",
  confidence: 0.55,
  sourceRef: "conversation:2025-11-20",
  tags: ["react", "routing", "superseded"],
};

const FORGOTTEN_TASK_1: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "current_task",
  content:
    "Implement user registration flow with email verification. This task is no longer relevant and has been forgotten.",
  summary: "OLD: User registration flow (forgotten)",
  confidence: 0.50,
  sourceRef: "conversation:2025-12-01",
  tags: ["registration", "forgotten"],
};

const FORGOTTEN_BUG_1: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "bug",
  content:
    "Old bug: console.log spam in production build. This was a false alarm and the memory was forgotten.",
  summary: "OLD: Console log spam (forgotten)",
  confidence: 0.30,
  sourceRef: "src/utils/logger.ts",
  tags: ["logging", "forgotten"],
};

const EXPIRED_DEP_1: SaveMemoryInput = {
  scopeId: QG_SCOPE_A,
  type: "dependency",
  content:
    "webpack v5.75.0 — Previous bundler before migrating to Vite. Expired after migration completed and webpack config was removed.",
  summary: "OLD: webpack v5 (expired — migrated to Vite)",
  confidence: 0.40,
  sourceRef: "package.json",
  tags: ["webpack", "bundler", "expired"],
};

// ===========================================================================
// SCOPE B: Distractor memories (8 memories — different project)
// ===========================================================================

const SCOPEB_NPM_RULE: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "project_rule",
  content:
    "Use npm with package-lock.json for this project. Use npm workspaces for monorepo management.",
  summary: "Use npm with workspaces (Scope B)",
  confidence: 0.88,
  sourceRef: "CLAUDE.md",
  tags: ["npm", "package-manager", "scope-b"],
};

const SCOPEB_VUE_DECISION: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "decision",
  content:
    "Decided to use Vue 3 Composition API with Pinia for state management. Using Vite as the build tool.",
  summary: "Vue 3 + Pinia chosen (Scope B)",
  confidence: 0.85,
  sourceRef: "conversation:2026-04-15",
  tags: ["vue", "pinia", "scope-b"],
};

const SCOPEB_VUE_REACTIVITY_BUG: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "bug",
  content:
    "Vue reactivity issue: nested object changes in Pinia store not triggering UI updates. Need to use storeToRefs() instead of destructuring.",
  summary: "Vue reactivity bug with Pinia store destructure",
  confidence: 0.82,
  sourceRef: "src/stores/useUserStore.ts",
  tags: ["vue", "reactivity", "scope-b"],
};

const SCOPEB_VUE_PROFILE_TASK: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "current_task",
  content:
    "Building user profile page with avatar upload, cropping tool, and notification preferences in Vue 3.",
  summary: "Vue profile page implementation (Scope B)",
  confidence: 0.78,
  sourceRef: "conversation:2026-07-01",
  tags: ["vue", "profile", "scope-b"],
};

const SCOPEB_JEST_DEP: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "dependency",
  content:
    "jest v29.7.0 — test framework for the Vue project. Configured with @vue/test-utils and jsdom environment.",
  summary: "Jest v29.7 for Vue testing (Scope B)",
  confidence: 0.85,
  sourceRef: "package.json",
  tags: ["jest", "testing", "scope-b"],
};

const SCOPEB_AVATAR_TEST_FAIL: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "test_failure",
  content:
    "tests/ProfileAvatar.spec.ts — Test failed: expected image element to have src starting with '/uploads/' but got null. The avatar component does not render when user has no avatar set.",
  summary: "Vue avatar component null-src test failure",
  confidence: 0.87,
  sourceRef: "tests/ProfileAvatar.spec.ts",
  tags: ["vue", "avatar", "scope-b"],
};

const SCOPEB_NUXT_RULE: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "project_rule",
  content:
    "Use Nuxt 3 conventions: auto-imports enabled, file-based routing, useFetch for data fetching. No manual import of Vue composables from #imports.",
  summary: "Nuxt 3 conventions (Scope B)",
  confidence: 0.90,
  sourceRef: "nuxt.config.ts",
  tags: ["nuxt", "conventions", "scope-b"],
};

const SCOPEB_VITE_PLUGIN_BUG: SaveMemoryInput = {
  scopeId: QG_SCOPE_B,
  type: "bug",
  content:
    "Bug: custom Vite plugin for SVG sprites breaks HMR in dev mode. The transform hook modifies the module graph incorrectly, causing full-page reload instead of HMR update.",
  summary: "Vite plugin SVG sprite HMR bug (Scope B)",
  confidence: 0.83,
  sourceRef: "vite.config.ts",
  tags: ["vite", "hmr", "scope-b"],
};

// ===========================================================================
// Exports
// ===========================================================================

/** All active memories for Scope A. Used by the quality gate to seed. */
export const QG_ACTIVE_MEMORIES: SaveMemoryInput[] = [
  // project_rule (4)
  PROJECT_RULE_PNPM,
  PROJECT_RULE_TS_STRICT,
  PROJECT_RULE_ESLINT,
  PROJECT_RULE_FORMAT,
  // decision / architecture_decision (4)
  DECISION_REACT_ROUTER,
  DECISION_VITEST,
  DECISION_SQLITE,
  DECISION_SSR,
  // bug / bug_fix (4)
  BUG_WEBSOCKET_LEAK,
  BUG_RACE_CONDITION,
  BUG_NPLUS1_QUERY,
  BUG_AUTH_REDIRECT,
  // current_task / task_context (4)
  TASK_QUALITY_EVAL,
  TASK_API_REFACTOR,
  TASK_UI_REDESIGN,
  TASK_PERF_OPTIMIZE,
  // dependency (4)
  DEP_VITEST,
  DEP_REACT,
  DEP_RATE_LIMIT,
  DEP_ZOD,
  // test_failure (4)
  TEST_FAIL_SESSION,
  TEST_FAIL_AVATAR,
  TEST_FAIL_CI_TIMEOUT,
  TEST_FAIL_PRICE_CALC,
];

/** Non-active memories (superseded, forgotten, expired) for leakage testing. */
export const QG_NON_ACTIVE_MEMORIES: SaveMemoryInput[] = [
  SUPERSEDED_OLD_PNPM,
  SUPERSEDED_OLD_ROUTER,
  FORGOTTEN_TASK_1,
  FORGOTTEN_BUG_1,
  EXPIRED_DEP_1,
];

/** All Scope A memories (active + non-active). */
export const QG_SCOPE_A_MEMORIES: SaveMemoryInput[] = [
  ...QG_ACTIVE_MEMORIES,
  ...QG_NON_ACTIVE_MEMORIES,
];

/** Scope B distractor memories. */
export const QG_SCOPE_B_MEMORIES: SaveMemoryInput[] = [
  SCOPEB_NPM_RULE,
  SCOPEB_VUE_DECISION,
  SCOPEB_VUE_REACTIVITY_BUG,
  SCOPEB_VUE_PROFILE_TASK,
  SCOPEB_JEST_DEP,
  SCOPEB_AVATAR_TEST_FAIL,
  SCOPEB_NUXT_RULE,
  SCOPEB_VITE_PLUGIN_BUG,
];

/** All seed memories across all scopes. */
export const QG_ALL_MEMORIES: SaveMemoryInput[] = [
  ...QG_SCOPE_A_MEMORIES,
  ...QG_SCOPE_B_MEMORIES,
];

// Non-active memory IDs for leakage assertion
export const QG_NON_ACTIVE_IDS_EXPECTED: string[] = [
  // We can't know exact IDs ahead of time, so we'll use content markers
];

// ===========================================================================
// Query → Target Mappings for Quality Gate Evaluation
// ===========================================================================

/**
 * Precision query → expected target content.
 * Each query should return its target as rank 1 (Recall@1).
 */
export const QG_RECALL_1_QUERIES: {
  query: string;
  targetContent: string;
  label: string;
  type: string;
}[] = [
  {
    query: "pnpm package manager lock file",
    targetContent: "Always use pnpm",
    label: "project_rule: pnpm package manager",
    type: "project_rule",
  },
  {
    query: "TypeScript strict mode tsconfig noUncheckedIndexAccess",
    targetContent: "Enable TypeScript strict mode",
    label: "project_rule: TS strict config",
    type: "project_rule",
  },
  {
    query: "ESLint flat config eslint.config.mjs",
    targetContent: "Use ESLint flat config",
    label: "project_rule: ESLint flat config",
    type: "project_rule",
  },
  {
    query: "React Router v6 lazy loading client-side routing",
    targetContent: "Decided to use React Router v6",
    label: "decision: React Router v6",
    type: "decision",
  },
  {
    query: "SQLite sql.js WASM storage architecture decision",
    targetContent: "Architecture decision: use SQLite",
    label: "decision: SQLite storage",
    type: "decision",
  },
  {
    query: "Vitest test runner Jest alternative decision",
    targetContent: "Decided to use Vitest as the test runner",
    label: "decision: Vitest over Jest",
    type: "decision",
  },
  {
    query: "WebSocket connections not cleaned up memory leak ChatWindow",
    targetContent: "WebSocket connections not being cleaned up",
    label: "bug: WebSocket memory leak",
    type: "bug",
  },
  {
    query: "race condition PaymentService double charge concurrent",
    targetContent: "race condition in PaymentService.processPayment",
    label: "bug: race condition double-charge",
    type: "bug",
  },
  {
    query: "N+1 query UserList SELECT roles performance",
    targetContent: "N+1 query in UserList",
    label: "bug: N+1 query performance",
    type: "bug",
  },
  {
    query: "auth redirect loop token expired interceptor 401",
    targetContent: "auth redirect loop when token expires",
    label: "bug: auth redirect loop",
    type: "bug",
  },
  {
    query: "quality eval baseline memory recall benchmark",
    targetContent: "Building offline quality eval baseline",
    label: "current_task: quality eval",
    type: "current_task",
  },
  {
    query: "API refactor express fastify zod validation",
    targetContent: "Refactoring the REST API layer: migrating from express to fastify",
    label: "current_task: API refactor",
    type: "current_task",
  },
  {
    query: "vitest v2.0 jsdom v8 coverage test framework",
    targetContent: "vitest v2.0.0 — test runner",
    label: "dependency: vitest v2",
    type: "dependency",
  },
  {
    query: "zod v3.23 schema validation runtime type inference",
    targetContent: "zod v3.23.8 — schema validation",
    label: "dependency: zod v3.23",
    type: "dependency",
  },
  {
    query: "express-rate-limit v7 Redis store middleware",
    targetContent: "express-rate-limit v7.2.0",
    label: "dependency: express-rate-limit",
    type: "dependency",
  },
  {
    query: "React 18.3 concurrent useTransition useDeferredValue",
    targetContent: "react v18.3.1 + react-dom v18.3.1",
    label: "dependency: React 18.3",
    type: "dependency",
  },
  {
    query: "session logout cookie Max-Age test failure AssertionError",
    targetContent: "should clear cookie on logout",
    label: "test_failure: session logout cookie",
    type: "test_failure",
  },
  {
    query: "avatar URL CDN prefix uploads test failure",
    targetContent: "expected avatar URL to start with 'https://cdn.example.com'",
    label: "test_failure: avatar CDN URL",
    type: "test_failure",
  },
  {
    query: "E2E checkout timeout element not visible flaky CI",
    targetContent: "TimeoutError: Test exceeded 30000ms",
    label: "test_failure: E2E checkout timeout",
    type: "test_failure",
  },
  {
    query: "bulk tiered discount price calculation AssertionError 10000",
    targetContent: "should apply tiered discount for bulk orders",
    label: "test_failure: bulk discount calculation",
    type: "test_failure",
  },
];

/** Broader queries — should find target within top 3. */
export const QG_RECALL_3_QUERIES: {
  query: string;
  targetContent: string;
  label: string;
  type: string;
}[] = [
  {
    query: "package manager lock file dependencies",
    targetContent: "Always use pnpm",
    label: "broad: package manager",
    type: "project_rule",
  },
  {
    query: "frontend routing framework decision architecture",
    targetContent: "Decided to use React Router v6",
    label: "broad: routing decision",
    type: "decision",
  },
  {
    query: "memory leak performance cleanup component bug",
    targetContent: "WebSocket connections not being cleaned up",
    label: "broad: memory leaks",
    type: "bug",
  },
  {
    query: "test runner framework coverage vitest",
    targetContent: "vitest v2.0.0",
    label: "broad: test framework",
    type: "dependency",
  },
  {
    query: "API refactor migration backend framework",
    targetContent: "Refactoring the REST API layer",
    label: "broad: backend refactor",
    type: "current_task",
  },
  {
    query: "test failure assertion logout cookie session",
    targetContent: "should clear cookie on logout",
    label: "broad: auth test failure",
    type: "test_failure",
  },
  {
    query: "type safety TypeScript config strict settings",
    targetContent: "Enable TypeScript strict mode",
    label: "broad: TS config rules",
    type: "project_rule",
  },
  {
    query: "validation schema runtime type checking",
    targetContent: "zod v3.23.8",
    label: "broad: schema validation",
    type: "dependency",
  },
  {
    query: "architecture decision storage database local",
    targetContent: "Architecture decision: use SQLite",
    label: "broad: storage architecture",
    type: "decision",
  },
  {
    query: "pricing calculation discount order bulk failure",
    targetContent: "should apply tiered discount",
    label: "broad: pricing test failure",
    type: "test_failure",
  },
];

/**
 * Queries expected to return zero results from Scope A.
 * These test "false recall" — the system should NOT return results
 * for concepts that don't exist in the scope.
 */
export const QG_NEGATIVE_QUERIES: {
  query: string;
  label: string;
}[] = [
  // EVERY term in each query must NOT appear in any fixture content/summary.
  // These use highly specific domain terms that are absent from all scopes.
  { query: "GraphQL subscription stitching federation", label: "GraphQL (not in scope)" },
  { query: "gRPC protobuf bidirectional streaming deadline", label: "gRPC (not in scope)" },
  { query: "SolidJS signals reactivity createResource", label: "SolidJS (not in scope)" },
  { query: "RabbitMQ amqp091 exchange deadletter", label: "RabbitMQ (not in scope)" },
  { query: "Terraform hcl2 provider plugin for_each", label: "Terraform (not in scope)" },
];

/**
 * Cross-scope leakage queries: search Scope A with queries that
 * should match Scope B's content to verify scope isolation.
 */
export const QG_CROSS_SCOPE_QUERIES: {
  query: string;
  scopeBContent: string;
  label: string;
}[] = [
  {
    query: "npm workspaces package-lock.json monorepo",
    scopeBContent: "Use npm with workspaces",
    label: "Scope B: npm workspaces (should NOT leak to A)",
  },
  {
    query: "Vue 3 Composition API Pinia state management",
    scopeBContent: "Decided to use Vue 3",
    label: "Scope B: Vue 3 (should NOT leak to A)",
  },
  {
    query: "Nuxt 3 auto-imports file-based routing useFetch",
    scopeBContent: "Use Nuxt 3 conventions",
    label: "Scope B: Nuxt 3 (should NOT leak to A)",
  },
  {
    query: "Jest v29 Vue test utils jsdom",
    scopeBContent: "jest v29.7.0",
    label: "Scope B: Jest (should NOT leak to A)",
  },
  {
    query: "Vite plugin SVG sprite HMR dev mode",
    scopeBContent: "custom Vite plugin for SVG sprites",
    label: "Scope B: Vite HMR bug (should NOT leak to A)",
  },
];

export { NOW };
