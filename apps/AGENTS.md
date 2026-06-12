# apps/AGENTS.md

Follow the root `AGENTS.md` first. This file only records module-level boundaries for `apps/`.

## Active apps

- `apps/web`: Next.js 16 App Router + React 18 web runtime. Entrypoints live in `apps/web/app/`; the main client shell is `apps/web/src/App.tsx`. During local `tools-dev` web runs, `apps/web/next.config.ts` rewrites `/api/*`, `/artifacts/*`, and `/frames/*` to `OD_PORT`.
- `apps/daemon`: Express + SQLite local daemon and `od` bin. It owns REST/SSE APIs, agent CLI spawning, skills, design systems, artifact persistence, static serving, and local data under `.od/`.
- `apps/desktop`: Electron shell. Desktop does not guess the web port; it reads runtime status through sidecar IPC and opens the reported web URL.
- `apps/packaged`: Thin packaged Electron runtime entry. It starts packaged daemon/web sidecars, registers the `od://` entry protocol, and delegates desktop host behavior to `apps/desktop`.

## Daemon layout

- `apps/daemon/src/` contains only daemon app source.
- `apps/daemon/tests/` contains daemon tests.
- `apps/daemon/sidecar/` contains the daemon sidecar entry.
- CLI/agent argument definition changes belong in `apps/daemon/src/runtimes/defs/`; stdout parser changes belong with the matching runtime helpers and parser tests.

### Router layout

- Existing daemon domain endpoints belong in the matching daemon route file; avoid adding route handlers directly to `apps/daemon/src/server.ts` unless the route is bootstrap-wide or has no clear domain owner.
- New route registrars should be wired into the matching semantic section in `server.ts`; keep sections broad and reuse existing sections before adding a new one.
- Bootstrap-wide routes describe daemon availability or startup metadata shared by every domain. `/api/health` and `/api/version` stay in `server.ts` because they only report process-level status.
- Domain routes describe a product capability or data model. `/api/active` belongs in `apps/daemon/src/routes/active-context.ts` because transient UI focus is its own domain, while chat routes own persistent conversation and run state.
- Add endpoints to an existing route file when they share the same domain language and dependency set. Split a new module under `apps/daemon/src/routes/` when the endpoint introduces a distinct domain or has little dependency overlap with existing route modules.

## Web/daemon payload and media-loading discipline

- List endpoints that feed index, gallery, workbench, or dashboard views must return list-card DTOs, not full detail DTOs. Keep heavy fields such as raw embedding vectors, full media-understanding transcripts, large provider payloads, logs, rendered artifacts, and binary/file contents on detail, download, or explicit expansion endpoints.
- When a capability needs both list and detail views, the daemon should make the distinction visible in code with a named list-slimming helper or dedicated list DTO type. The shared contracts should allow list responses to omit heavy detail-only fields without forcing consumers to receive placeholder payloads.
- Frontend list views must not mount `<video>`, `<audio>`, iframe previews, or other media elements with real `src` values for every row/card just to render a gallery. Use thumbnails, static placeholders, or explicit preview buttons; load the original media only when the user opens a preview or expands a specific item.
- Effects that trigger initial web/daemon fetches must be safe under React StrictMode double invocation in development. Use in-flight request guards, abort handling, or a local data cache so dev-mode diagnostics do not double daemon traffic or mask production performance characteristics.
- Before adding a media-heavy workbench or expanding an existing list payload, measure response size, request count, and first usable render time through the normal web proxy path. Treat repeated same-origin file requests and MB-scale JSON list responses as product bugs, not incidental dev-server noise.

## Test layout

- App tests live in each app's `tests/` directory, sibling to `src/`; preserve source-relative subpaths inside `tests/` when useful.
- Keep app `src/` directories source-only; do not add new `*.test.ts` or `*.test.tsx` files under `src/`.
- `apps/web/tests/` contains web-owned Vitest tests and uses `*.test.ts` / `*.test.tsx`.
- Playwright UI automation belongs in `e2e/ui/`; do not add Playwright suites or UI automation helper scripts under `apps/web`.

## Sidecar awareness

- App business layers must not import sidecar packages or branch on `runtime.mode`, `namespace`, `ipc`, or `source`.
- Keep sidecar awareness in `apps/<app>/sidecar` or the desktop sidecar entry wrapper.

## Packaged runtime

- `apps/nextjs` has been removed; do not restore it.
- Packaged web uses Next.js SSR through the web sidecar; do not put Next output under daemon `OD_RESOURCE_ROOT`.
- Packaged `OD_RESOURCE_ROOT` is only for daemon non-Next read-only resources: `skills/`, `design-systems/`, and `frames/`.
- Packaged data/log/runtime/cache paths must be namespace-scoped and must not depend on daemon or web ports.
- Daemon↔web packaged traffic still uses an HTTP origin/port because Next.js dev server and SSR proxy paths assume HTTP origins; switching to Unix sockets would require patching Next internals. The invariant is that data/log/runtime/cache paths never embed ports.

## Common app commands

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/web test
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/desktop typecheck
pnpm --filter @open-design/desktop build
pnpm --filter @open-design/packaged typecheck
pnpm --filter @open-design/packaged build
```
