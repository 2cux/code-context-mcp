/**
 * Memory Fixtures — Quality Eval
 *
 * These fixtures are used to seed the SQLite in-memory database
 * for recall quality evaluations.
 *
 * Each fixture has: type, content, summary, confidence, sourceRef, tags, scopeId.
 *
 * We create 3 scopes to test scope isolation:
 *   - quality-eval-scope-a (primary — 10 memories)
 *   - quality-eval-scope-b (distractor — 5 memories)
 *   - quality-eval-scope-c (empty)
 */

import type { SaveMemoryInput } from "../../src/memory/types.js";

export const SCOPE_A = "quality-eval-scope-a";
export const SCOPE_B = "quality-eval-scope-b";
export const SCOPE_C = "quality-eval-scope-c";

export const SEED_MEMORIES: SaveMemoryInput[] = [
  // ---- Scope A: 10 memories of various types ----

  // project_rule: pnpm is the package manager
  {
    scopeId: SCOPE_A,
    type: "project_rule",
    content: "Always use pnpm as the package manager. Never use npm or yarn.",
    summary: "Use pnpm for package management",
    confidence: 0.95,
    sourceRef: "CLAUDE.md",
    tags: ["pnpm", "package-manager", "project-rule"],
  },
  // project_rule: TypeScript strict mode
  {
    scopeId: SCOPE_A,
    type: "project_rule",
    content: "Enable TypeScript strict mode in tsconfig.json for all new projects. This ensures type safety across the codebase.",
    summary: "TypeScript strict mode required",
    confidence: 0.9,
    sourceRef: "tsconfig.json",
    tags: ["typescript", "strict", "config"],
  },
  // decision: React Router v6
  {
    scopeId: SCOPE_A,
    type: "decision",
    content: "Decided to use React Router v6 for client-side routing with lazy loading via React.lazy().",
    summary: "React Router v6 chosen for routing",
    confidence: 0.85,
    sourceRef: "conversation:2026-06-15",
    tags: ["react", "routing", "decision"],
  },
  // bug: WebSocket memory leak
  {
    scopeId: SCOPE_A,
    type: "bug",
    content: "WebSocket connections not being cleaned up on component unmount. The cleanup function in useEffect is missing close() call. Affects components/chat/ChatWindow.tsx.",
    summary: "WebSocket cleanup missing in ChatWindow",
    confidence: 0.9,
    sourceRef: "src/components/chat/ChatWindow.tsx",
    tags: ["websocket", "memory-leak", "bug"],
  },
  // user_preference: tabs vs spaces
  {
    scopeId: SCOPE_A,
    type: "user_preference",
    content: "Developer prefers tabs for indentation (2-space width) and single quotes for strings.",
    summary: "Tabs + single quotes preference",
    confidence: 0.7,
    sourceRef: "user:preferences",
    tags: ["formatting", "preference"],
  },
  // current_task: quality eval
  {
    scopeId: SCOPE_A,
    type: "current_task",
    content: "Building offline quality eval baseline for compression and recall. Creating fixtures, test suite, and baseline report.",
    summary: "Quality eval baseline implementation",
    confidence: 0.85,
    sourceRef: "conversation:2026-07-07",
    tags: ["quality", "eval", "current-task"],
  },
  // test_failure: session logout
  {
    scopeId: SCOPE_A,
    type: "test_failure",
    content: "tests/unit/auth/session.test.ts > should clear cookie on logout — AssertionError: expected 'set-cookie' header to be 'session=; Max-Age=0' but got 'session=invalidated; Max-Age=3600'",
    summary: "Session logout test: wrong cookie value",
    confidence: 0.95,
    sourceRef: "tests/unit/auth/session.test.ts",
    tags: ["test-failure", "auth", "session"],
  },
  // api_contract: login endpoint
  {
    scopeId: SCOPE_A,
    type: "api_contract",
    content: "POST /api/auth/login accepts { email: string, password: string } and returns { token: string, user: User }. Errors: 400 for invalid input, 401 for wrong credentials, 429 for rate limited.",
    summary: "Login API contract",
    confidence: 0.8,
    sourceRef: "src/routes/auth.ts",
    tags: ["api", "auth", "contract"],
  },
  // dependency: vitest
  {
    scopeId: SCOPE_A,
    type: "dependency",
    content: "Using vitest v2.0.0 for testing. Configured in vitest.config.ts with jsdom environment for components and node environment for unit tests.",
    summary: "Vitest v2.0.0 test framework",
    confidence: 0.9,
    sourceRef: "package.json",
    tags: ["testing", "vitest", "dependency"],
  },
  // command: pnpm typecheck
  {
    scopeId: SCOPE_A,
    type: "command",
    content: "pnpm typecheck runs tsc --noEmit. Returns 3 TS errors: TS2304 in userService.ts:15, TS2554 in userService.ts:42, TS2322 in format.ts:88.",
    summary: "pnpm typecheck results (3 errors)",
    confidence: 0.8,
    sourceRef: "command:pnpm",
    tags: ["build", "typecheck", "command"],
  },

  // ---- Scope B: 5 distractor memories ----

  {
    scopeId: SCOPE_B,
    type: "project_rule",
    content: "Use npm for package management in this project. Lock file is package-lock.json.",
    summary: "Use npm (different project)",
    confidence: 0.9,
    sourceRef: "CLAUDE.md",
    tags: ["npm", "package-manager"],
  },
  {
    scopeId: SCOPE_B,
    type: "decision",
    content: "Decided to use Vue 3 with Pinia for state management instead of React.",
    summary: "Vue 3 chosen for frontend",
    confidence: 0.85,
    sourceRef: "conversation:2026-05-20",
    tags: ["vue", "decision", "frontend"],
  },
  {
    scopeId: SCOPE_B,
    type: "bug",
    content: "Vue reactivity issue: nested object changes not triggering re-render. Need to use reactive() instead of ref() for deeply nested state.",
    summary: "Vue reactivity bug with nested objects",
    confidence: 0.8,
    sourceRef: "src/stores/userStore.ts",
    tags: ["vue", "reactivity", "bug"],
  },
  {
    scopeId: SCOPE_B,
    type: "current_task",
    content: "Implementing user profile page with avatar upload and notification preferences.",
    summary: "User profile page implementation",
    confidence: 0.75,
    sourceRef: "conversation:2026-07-05",
    tags: ["feature", "profile", "current-task"],
  },
  {
    scopeId: SCOPE_B,
    type: "test_failure",
    content: "tests/component/ProfileAvatar.test.ts — AssertionError: expected avatar URL to start with 'https://' but got '/uploads/avatar.png'",
    summary: "Avatar URL test failure",
    confidence: 0.85,
    sourceRef: "tests/component/ProfileAvatar.test.ts",
    tags: ["test-failure", "avatar", "profile"],
  },
];
