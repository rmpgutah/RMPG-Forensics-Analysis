# Contributing to RMPG Forensics Analysis

## Development Setup

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8 (`npm install -g pnpm`)

### Quick Start

```bash
pnpm install
pnpm --filter @rmpg/shared build
pnpm dev:desktop
```

### Build Order

The shared package must be built before the desktop package:

```bash
# 1. Build shared types and utilities
pnpm --filter @rmpg/shared build

# 2. Type-check the desktop app
cd packages/desktop && npx tsc --noEmit

# 3. Build the desktop app
pnpm --filter @rmpg/desktop build
```

## Code Conventions

### TypeScript

- Use strict TypeScript — avoid `as any` casts. Use proper type narrowing instead.
- All IPC channel names are defined in `packages/shared/src/constants.ts`.
- Export shared types from `packages/shared/src/types/`.

### IPC Handlers

- Register handlers in the appropriate file under `packages/desktop/src/main/ipc/`.
- All handler files export a `register*Handlers()` function called from `ipc/index.ts`.
- Use the `IpcResult<T>` type for handler return values:

```typescript
type IpcResult<T = void> = { success: true; data: T } | { success: false; error: string };
```

### React Components

- Pages go in `packages/desktop/src/renderer/pages/`.
- Reusable components go in `packages/desktop/src/renderer/components/`.
- Use Zustand stores for state management (`packages/desktop/src/renderer/store/`).
- Use `useProcess` hook for IPC calls with progress tracking.

### Styling

- Use Tailwind CSS utility classes.
- Follow the existing color palette: primary `#6495ED`, backgrounds `#0a1828` / `#0f2238`.
- Use CSS variables for theme tokens where available.

### Accessibility

- Add `aria-label` attributes to interactive elements without visible text labels.
- Use semantic HTML elements (`<main>`, `<nav>`, `<section>`).
- Ensure keyboard navigation works for all interactive elements.
- Use `aria-live` regions for dynamic status updates.

## Pull Request Guidelines

1. Ensure `npx tsc --noEmit` passes in `packages/desktop/`.
2. Ensure `pnpm --filter @rmpg/shared build` succeeds.
3. Test your changes locally in dev mode (`pnpm dev:desktop`).
4. Keep PRs focused — one feature or fix per PR.
5. Update documentation if your change affects the public API or user-facing behavior.

## Project Structure

```
packages/
  shared/        → Types, constants, utilities shared across packages
  desktop/       → Electron app
    src/main/    → Main process: IPC handlers, services, native tool wrappers
    src/preload/ → Context bridge (exposes IPC to renderer safely)
    src/renderer/→ React app: pages, components, hooks, stores
```
