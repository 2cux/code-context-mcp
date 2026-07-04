# Project Rules

## Package Manager
This project uses **pnpm** as its package manager. Never use npm or yarn.
Run `pnpm install` to install dependencies and `pnpm run build` to compile.

## Code Style
- Use TypeScript strict mode for all new files.
- Prefer `interface` over `type` for object shapes.
- Use explicit return types on public functions.
- Naming: camelCase for variables, PascalCase for classes/components.

## Testing
- Every new feature must include unit tests using vitest.
- Test files live in `tests/` and mirror the `src/` structure.
- Run `pnpm test` before pushing any commit.

## Error Handling
- Never swallow errors silently. Always log with context.
- Use structured error types, not plain strings.
- Compression failures must return original content (fail-open).

## Git
- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- Branch naming: `feature/description`, `fix/description`.
- Always squash before merging to main.
