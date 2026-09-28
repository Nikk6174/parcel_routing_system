# Phase 1 — Project Scaffold & Configuration System

> **Status:** ✅ Complete
> **Depends on:** Nothing (first phase)
> **Next phase:** Phase 2

---

## What was implemented

Phase 1 sets up the monorepo skeleton, the build/dev toolchain, and a fail-fast
configuration system. There is **zero business logic** — no routing rules, no
database schemas, no UI components. The sole purpose is to ensure every later
phase has a solid, type-safe, testable foundation to build on.

### Deliverables at a glance

| # | Deliverable | Location |
|---|-------------|----------|
| 1 | npm workspaces monorepo | Root `package.json` with `workspaces` field |
| 2 | Three packages: api, web, shared | `apps/api/`, `apps/web/`, `packages/shared/` |
| 3 | TypeScript strict configs | `tsconfig.base.json` + per-package overrides |
| 4 | Zod-validated env config (fail-fast) | `apps/api/src/config/env.ts` |
| 5 | ESLint 9 + Prettier | `eslint.config.mjs`, `.prettierrc` |
| 6 | Root README with architecture decisions | `README.md` |
| 7 | Root scripts: dev, build, test, lint | Root `package.json` scripts |

---

## File-by-file breakdown

### Root level

```
package.json            ← npm workspaces config; root scripts delegate to packages
tsconfig.base.json      ← shared TypeScript strict settings (all packages extend this)
eslint.config.mjs       ← ESLint 9 flat config with typescript-eslint strict preset
.prettierrc             ← code formatting rules
.gitignore              ← ignores node_modules, dist, .env, editor files
.env.example            ← template of all env vars (tracked in git)
.env                    ← actual env values for local dev (git-ignored)
vitest.config.ts        ← root test runner; discovers *.test.ts across all packages
README.md               ← install/run docs, config docs, architecture decisions
```

### `packages/shared/`

```
package.json            ← declares the package name @parcel-routing/shared
tsconfig.json           ← extends base; compiles src/ → dist/ as Node16 ESM
src/
  index.ts              ← exports ApiStatus type and ApiResponse<T> interface
```

**Purpose:** A shared types/schemas package consumed by both `api` and `web`.
In Phase 1 it only exports a generic `ApiResponse<T>` envelope to prove
cross-package imports work. Later phases will add Zod schemas for parcels,
rules, etc.

### `apps/api/`

```
package.json            ← Fastify, Zod, dotenv dependencies; tsx for dev
tsconfig.json           ← extends base; Node16 module resolution; types: ["node"]
src/
  index.ts              ← entry point: loads .env, validates config, starts server
  app.ts                ← Fastify app factory: creates and configures the instance
  config/
    env.ts              ← Zod schema for env vars + loadConfig() function
    env.test.ts         ← 8 unit tests for the config validation
```

### `apps/web/`

```
package.json            ← React, ReactDOM; Vite + plugin-react for dev/build
tsconfig.json           ← extends base; Bundler resolution; JSX react-jsx
tsconfig.node.json      ← separate config for vite.config.ts (composite)
vite.config.ts          ← Vite dev server config with React plugin
index.html              ← HTML shell with SEO meta tags and Inter font
src/
  main.tsx              ← React entry: mounts <App /> into #root
  App.tsx               ← placeholder page (title + "System Online" badge)
  App.css               ← dark theme styles with gradient background + animations
  vite-env.d.ts         ← Vite client type declarations (CSS imports, etc.)
```

---

## Execution flow (how things connect)

### `npm run dev` — what happens step by step

```
┌─────────────────────────────────────────────────────────────────┐
│  npm run dev  (from monorepo root)                              │
│                                                                 │
│  1. predev hook fires automatically                             │
│     └─► npm run -w packages/shared build                        │
│         └─► tsc compiles packages/shared/src/index.ts           │
│             └─► produces packages/shared/dist/index.js + .d.ts  │
│                                                                 │
│  2. dev script runs concurrently (3 processes):                 │
│     ┌──────────────────────────────────────────┐                │
│     │ [shared]  tsc --watch                    │                │
│     │           watches src/ for changes,      │                │
│     │           recompiles dist/ on save       │                │
│     ├──────────────────────────────────────────┤                │
│     │ [api]     tsx watch src/index.ts         │                │
│     │           runs the API server,           │                │
│     │           restarts on any file change    │                │
│     ├──────────────────────────────────────────┤                │
│     │ [web]     vite                           │                │
│     │           Vite dev server with HMR,      │                │
│     │           serves React app               │                │
│     └──────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### API startup flow (file → file → function)

```
apps/api/src/index.ts
│
├─ 1. dotenv.config({ path: '../../.env' })     ← loads root .env into process.env
├─ 2. dotenv.config()                           ← fallback for local .env
│
├─ 3. main()
│     │
│     ├─ 4. loadConfig()                        ← apps/api/src/config/env.ts
│     │     │
│     │     ├─ envSchema.safeParse(process.env)  ← Zod validates all env vars
│     │     │
│     │     ├─ IF INVALID:
│     │     │   ├─ console.error(readable message listing every failed field)
│     │     │   └─ throw new Error('Invalid environment configuration')
│     │     │       └─ caught by main().catch() → console.error + process.exit(1)
│     │     │
│     │     └─ IF VALID:
│     │         └─ returns typed EnvConfig object
│     │
│     ├─ 5. createApp(config)                   ← apps/api/src/app.ts
│     │     │
│     │     ├─ Fastify({ logger: { level: config.LOG_LEVEL } })
│     │     ├─ registers GET /health route
│     │     └─ returns FastifyInstance
│     │
│     └─ 6. app.listen({ port: config.PORT, host: '0.0.0.0' })
│           └─ Fastify logs: "Server listening at http://127.0.0.1:3001"
│
└─ main().catch()
      └─ catches any unhandled startup error → logs + exit(1)
```

### Web startup flow

```
apps/web/index.html
│
└─ <script type="module" src="/src/main.tsx">
    │
    └─ apps/web/src/main.tsx
        │
        ├─ document.getElementById('root')
        │   └─ IF null → throw Error (never silently fail)
        │
        └─ createRoot(rootElement).render(<App />)
            │
            └─ apps/web/src/App.tsx
                └─ renders placeholder page with title + status badge
```

### Cross-package dependency graph

```
                 ┌───────────────────┐
                 │ packages/shared   │
                 │                   │
                 │ ApiStatus (type)  │
                 │ ApiResponse<T>    │
                 └────────┬──────────┘
                          │
                          │  imported via npm workspace symlink
                          │  (@parcel-routing/shared → packages/shared/dist/)
                          │
              ┌───────────┴───────────┐
              │                       │
     ┌────────▼────────┐    ┌────────▼────────┐
     │   apps/api      │    │   apps/web      │
     │                 │    │                 │
     │ Fastify server  │    │ React + Vite    │
     │ config/env.ts   │    │ placeholder UI  │
     └─────────────────┘    └─────────────────┘
```

**How the shared package flows to consumers:**

1. `packages/shared/src/index.ts` is compiled by `tsc` → `packages/shared/dist/index.js` + `index.d.ts`
2. `packages/shared/package.json` declares `"main": "./dist/index.js"` and `"types": "./dist/index.d.ts"`
3. npm workspaces creates a symlink: `node_modules/@parcel-routing/shared` → `packages/shared/`
4. When `apps/api` does `import { ApiResponse } from '@parcel-routing/shared'`, Node resolves the symlink, reads `package.json`, and loads `dist/index.js`. TypeScript reads `dist/index.d.ts` for type checking.

### Test execution flow

```
npm test  (root)
│
└─ vitest run
    │
    └─ vitest.config.ts discovers: apps/*/src/**/*.test.ts
        │
        └─ apps/api/src/config/env.test.ts
            │
            ├─ imports loadConfig from ./env.js
            │
            ├─ 8 tests, each calling loadConfig(mockEnv):
            │   ├─ happy path: all vars valid → returns typed config
            │   ├─ defaults: only MONGO_URI → defaults for PORT, LOG_LEVEL, etc.
            │   ├─ boundary: PORT=1 → accepted (minimum positive int)
            │   ├─ boundary: PORT=0 → throws (not positive)
            │   ├─ invalid: missing MONGO_URI → throws
            │   ├─ invalid: empty MONGO_URI → throws
            │   ├─ invalid: LOG_LEVEL='verbose' → throws (not in enum)
            │   └─ invalid: PORT='abc' → throws (NaN)
            │
            └─ Note: loadConfig() accepts an env parameter so tests
               inject mock env objects instead of mutating process.env
```

---

## Key design decisions

- **npm workspaces over Turborepo/Nx** — zero extra dependencies; npm's built-in
  workspace support handles symlinks, dependency hoisting, and script delegation.
  Turborepo's build caching is unnecessary when the shared package compiles in
  under a second. We can adopt Turborepo later without restructuring.

- **`loadConfig()` accepts an injectable `env` parameter** — the default is
  `process.env`, but tests pass a plain `Record<string, string | undefined>`.
  This avoids test pollution (no need to mutate/restore `process.env`) and
  makes tests deterministic and parallelisable.

- **Two `dotenv.config()` calls with different paths** — when npm workspace
  scripts set CWD to `apps/api/`, the first call (`../../.env`) reaches the
  monorepo root. The second call (no path = CWD) is a fallback for when someone
  runs from root directly. dotenv never overrides already-set variables, so root
  values win and there's no double-loading conflict.

- **`"types": ["node"]` in the API tsconfig** — restricts global type
  declarations to `@types/node` only. Without this, `@types/react` (hoisted from
  the web package) would pollute the API's global scope with DOM types, which
  could mask real type errors (e.g., accidentally using `document` in server code
  and having it compile).

- **Separate `app.ts` factory from `index.ts` entry point** — `createApp(config)`
  returns a configured Fastify instance without starting it. This lets later
  phases write integration tests that call `app.inject()` without binding to a
  port. The entry point (`index.ts`) is the only file that calls `.listen()`.

- **`predev` hook builds shared before `dev` starts watchers** — ensures
  `packages/shared/dist/` exists before `tsx watch` and `vite` try to resolve
  `@parcel-routing/shared`. Without this, the first startup would fail because
  the dist directory doesn't exist yet.

- **Vitest over Jest** — Vitest shares Vite's module resolver and esbuild
  transform pipeline. This means test-time import resolution is identical to
  dev-time resolution — no separate `moduleNameMapper` config, no `ts-jest`
  transform, no ESM/CJS interop headaches.

- **`noUncheckedIndexedAccess: true` in the base tsconfig** — forces developers
  to handle `undefined` when accessing arrays/objects by index. This catches a
  common class of bugs where `arr[i]` is assumed to be defined but could be
  out-of-bounds. Slightly more verbose but prevents runtime `undefined` errors.

---

## What this phase does NOT do (yet)

- **No MongoDB connection** — the `MONGO_URI` env var is validated but never used
  to connect. Database setup is deferred to Phase 2.

- **No routing rules or business logic** — no parcel model, no rule engine, no
  evaluation pipeline. That's Phase 3.

- **No API endpoints** (beyond `/health`) — no REST routes, no request/response
  validation, no error handling middleware.

- **No UI components** — the web app is a static placeholder. No forms, tables,
  dashboards, or API integration.

- **No authentication or authorization** — no JWT, no sessions, no role-based
  access. This is a later-phase concern.

- **No rate limiting middleware** — the config validates `RATE_LIMIT_MAX` and
  `RATE_LIMIT_WINDOW_MS`, but no Fastify plugin actually enforces them yet.

- **No CI/CD pipeline** — no GitHub Actions, no Docker, no deployment config.

- **No piscina worker pool** — the worker thread infrastructure is deferred
  until the phase that needs parallel processing.

---

## How to extend this later

**Adding new env vars:** Add a new field to the `envSchema` Zod object in
`apps/api/src/config/env.ts`. If it's required, omit `.default()`. If optional,
provide a default. Then update `.env.example` and the README table. The `EnvConfig`
type updates automatically via `z.infer`. No other files need to change.

**Adding a new shared type:** Export it from `packages/shared/src/index.ts` (or
create sub-modules and re-export). Run `npm run -w packages/shared build` — both
`api` and `web` can immediately import it via `@parcel-routing/shared`.

**Adding a new package to the monorepo:** Create a directory under `packages/`
or `apps/`, give it a `package.json` with a name, and add it to the root
`workspaces` glob. Run `npm install` to link it. If it produces build output,
add a build step to the root `build` script.
