# Phase 2 — Routing Rule Engine

> **Status:** ✅ Complete
> **Depends on:** Phase 1 (monorepo scaffold, shared package)
> **Next phase:** Phase 3

---

## What was implemented

Phase 2 implements the routing rule engine as **pure, dependency-free TypeScript**
in `packages/shared/src/rule-engine/`. It has zero external imports — no database
driver, no HTTP framework, no Zod. It takes data in and returns data out.

The engine is built from four composable layers following SOLID principles:

| Layer | Module | Responsibility |
|-------|--------|----------------|
| 1. Operators | `operators.ts` | Registry of comparison functions (`eq`, `>`, `in`, etc.) |
| 2. Field resolver | `field-resolver.ts` | Resolves dot-separated paths on a Parcel |
| 3. Condition evaluator | `condition-evaluator.ts` | Evaluates one Condition against a Parcel |
| 4. Rule matcher | `rule-matcher.ts` | Evaluates one Rule's `all`/`any` conditions |
| 5. Rule engine | `rule-engine.ts` | Orchestrates preconditions + routing rules |

### Test coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `operators.test.ts` | 29 | Every built-in operator, boundary values, type errors, extensibility |
| `field-resolver.test.ts` | 12 | System fields, nested paths, custom namespace, shadowing protection |
| `condition-evaluator.test.ts` | 8 | Numeric/string/in conditions, boundaries, invalid fields |
| `rule-matcher.test.ts` | 9 | AND logic, OR logic, combined, vacuous match, invalid input |
| `rule-engine.test.ts` | 19 | All spec-required scenarios (see below) |
| **Total** | **77** | (+ 8 from Phase 1 = **85 total**) |

---

## How this connects with Phase 1

```
Phase 1 created:                    Phase 2 added:
                                    
packages/shared/                    packages/shared/
  src/                                src/
    index.ts  ──── re-exports ────►     rule-engine/
    (ApiStatus, ApiResponse)              index.ts
                                          types.ts
                                          errors.ts
                                          operators.ts
                                          field-resolver.ts
                                          condition-evaluator.ts
                                          rule-matcher.ts
                                          rule-engine.ts
                                          *.test.ts (×5)
```

- **No Phase 1 files were modified** except `packages/shared/src/index.ts`,
  which gained one line: `export * from './rule-engine/index.js'`.
- The shared package still compiles with `tsc`, still produces `dist/`, and
  is still consumed by `apps/api` and `apps/web` via workspace symlinks.
- All 8 Phase 1 config tests continue to pass.

---

## File-by-file breakdown

### `packages/shared/src/rule-engine/types.ts`

Pure TypeScript interfaces — no runtime code, no Zod, no dependencies.

**Key types:**
- `Parcel` — the shape the engine evaluates against (`weight`, `value`,
  `destinationCountry`, `recipient`, `custom`)
- `Rule` — a routing or precondition rule with `conditions` and `action`
- `Condition` — a single `{ field, operator, value }` triple
- `RuleEngineResult` — the engine's output: department, status, reason, etc.

### `packages/shared/src/rule-engine/errors.ts`

Three typed error classes with structured fields for programmatic handling:
- `RuleConflictError` — carries `ruleIdA`, `ruleIdB`, `priority`
- `FieldResolutionError` — carries `fieldPath`
- `ConditionEvaluationError` — for operator type mismatches

### `packages/shared/src/rule-engine/operators.ts`

A `Map<string, OperatorFn>` registry with `registerOperator()` / `getOperator()`.

Built-in operators: `eq`, `neq`, `>`, `>=`, `<`, `<=`, `in`, `not_in`.

**Extensibility:** Call `registerOperator('contains', fn)` from outside this
module. No other file needs to change — not the evaluator, not the matcher,
not the engine.

### `packages/shared/src/rule-engine/field-resolver.ts`

Resolves dot-separated field paths (`weight`, `recipient.address.city`,
`custom.fragile`) against a Parcel.

**System field protection:**
- Only known top-level fields (`weight`, `value`, `destinationCountry`,
  `recipient`) and `custom.*` paths are allowed.
- Unknown top-level fields → `FieldResolutionError`.
- A `custom.weight` key can never shadow the system `weight` field.

### `packages/shared/src/rule-engine/condition-evaluator.ts`

`ConditionEvaluator` class — the thinnest layer. Takes one Condition + one
Parcel, resolves the field, looks up the operator, returns boolean.

### `packages/shared/src/rule-engine/rule-matcher.ts`

`RuleMatcher` class — evaluates a Rule's `conditions.all` (AND) and
`conditions.any` (OR) blocks. Receives a `ConditionEvaluator` via DI.

### `packages/shared/src/rule-engine/rule-engine.ts`

`RuleEngine` class — the orchestrator. Receives a `RuleMatcher` via DI.

---

## Execution flow

### How a parcel is evaluated

```
RuleEngine.evaluate(parcel, rules)
│
├─ 1. Separate rules by type
│     ├─ precondition_rules
│     └─ condition_rules
│
├─ 2. findWinningRule(preconditions, parcel)
│     ├─ Group by priority (Map<number, Rule[]>)
│     ├─ Sort priorities ascending (lower number = higher precedence)
│     └─ For each priority group:
│         ├─ Filter rules through RuleMatcher
│         ├─ 0 matches → next group
│         ├─ 1 match  → winner found, stop
│         └─ 2+ matches → throw RuleConflictError
│
├─ 3. findWinningRule(conditionRules, parcel)
│     └─ Same logic as above
│
└─ 4. buildResult(parcel, conditionRule, precondition)
      ├─ No condition_rule matched → UNROUTED
      ├─ Matched + precondition.block_until_approved → PENDING_APPROVAL
      └─ Matched + no blocking precondition → ROUTED
```

### Dependency flow between modules

```
                    ┌──────────┐
                    │ operators │ ← registerOperator() for extensibility
                    └─────┬────┘
                          │ getOperator()
                          ▼
┌────────────────┐   ┌────────────────────┐
│ field-resolver │──►│ condition-evaluator │
└────────────────┘   └─────────┬──────────┘
                               │ evaluator.evaluate()
                               ▼
                         ┌─────────────┐
                         │ rule-matcher │
                         └──────┬──────┘
                                │ matcher.match()
                                ▼
                          ┌─────────────┐
                          │ rule-engine │
                          └─────────────┘
```

Each layer depends only on the one below it. Adding a new operator touches
only `operators.ts`. Adding a new system field touches only `field-resolver.ts`
and `types.ts`. The engine never changes.

---

## Key design decisions

- **Operator registry (Map) instead of switch/if-else chain** — the spec
  explicitly requires that adding a new operator must not touch rule-matching
  or engine code. A `Map<string, OperatorFn>` with `registerOperator()` makes
  operators a pluggable concern. The switch-statement approach would violate OCP
  because every new operator requires editing a function.

- **Lower priority number = higher precedence** — matches the most common
  convention (CSS specificity, Unix nice values, k8s pod priority). Rules are
  grouped by priority and evaluated group-by-group. If the highest-priority
  group has a match, lower groups are never evaluated, making conflict
  detection scoped to each priority level.

- **RuleConflictError is a hard error, not a warning** — two same-priority
  rules both matching is a configuration error that should never be silently
  resolved. The engine throws a typed error with both rule IDs so the caller
  can surface it clearly. Phase 3 should additionally enforce priority
  uniqueness at write time.

- **Constructor injection for ConditionEvaluator → RuleMatcher → RuleEngine** —
  each layer receives its dependency via constructor. Tests can inject mocks.
  The engine never directly imports the evaluator; it goes through the matcher.
  This keeps each layer independently testable.

- **System field allowlist in field-resolver** — instead of allowing any field
  path and relying on TypeScript's type system (which doesn't exist at runtime),
  the resolver explicitly checks the first path segment against a known set.
  This prevents `custom.weight` from ever being confused with `weight`.

- **`buildResult` makes UNROUTED take precedence** — if no condition_rule
  matches, the result is always UNROUTED regardless of whether a precondition
  matched. Rationale: you can't be "pending approval for routing" if there's
  no route. The `requiresApproval` field is `null` when UNROUTED.

- **Reason generation re-evaluates `any` conditions to find which matched** —
  the RuleMatcher returns a boolean, but the reason needs to show which
  specific OR-conditions were satisfied. Instead of complicating the matcher
  API with match metadata, the reason generator does a lightweight
  re-evaluation of only the matched rule's `any` conditions. Since the engine
  is pure and deterministic, re-evaluation is safe.

- **Comparison operators throw on type mismatch** — if a condition says
  `weight > "abc"`, the operator throws `ConditionEvaluationError` rather
  than silently returning false. This is consistent with the "no silent
  error swallowing" rule and surfaces rule misconfigurations loudly.

---

## What this phase does NOT do (yet)

- **No MongoDB storage** — rules are passed in as an in-memory array. The engine
  does not load, persist, or cache rules. That's Phase 3.

- **No rule CRUD API** — no endpoints to create, read, update, or delete rules.
  Phase 3.

- **No parcel ingestion or XML parsing** — the engine receives a typed `Parcel`
  object. Converting raw XML to this shape is Phase 5.

- **No `destinationCountry` defaulting** — the engine treats it as a required
  string it receives. The "default to NL" logic belongs in the mapping layer
  (Phase 5) and needs data-owner confirmation.

- **No type coercion** — `weight` and `value` must already be numbers. Coercion
  from XML string nodes is an ingestion concern (Phase 5).

- **No Zod validation schemas** — the engine uses pure TypeScript interfaces.
  Zod schemas for request/response validation will be added when the API layer
  needs them (Phase 3).

- **No worker pool integration** — the engine is synchronous and single-threaded.
  Piscina integration happens in a later phase.

- **No precondition chaining** — only one precondition (highest priority match)
  affects the result. If multiple approvals are needed simultaneously, that's
  a future enhancement.

---

## How to extend this later

**Adding a new operator** (e.g. `contains`, `regex`, `between`):
Call `registerOperator('contains', (field, cond) => ...)` in a setup file
or at application startup. No other module changes. The operator is immediately
available in rule conditions.

**Adding a new system field to Parcel** (e.g. `senderCountry`):
1. Add the field to the `Parcel` interface in `types.ts`.
2. Add the field name to `KNOWN_TOP_LEVEL_FIELDS` in `field-resolver.ts`.
3. Add it to the `systemView` record in `resolveField()`.
That's it — the evaluator, matcher, and engine are untouched.

**Adding a new rule type** (e.g. `validation_rule`):
1. Add the literal to the `Rule.type` union in `types.ts`.
2. In `rule-engine.ts`, add a filter + handler for the new type in `evaluate()`.
The existing precondition and condition_rule logic is unchanged.
