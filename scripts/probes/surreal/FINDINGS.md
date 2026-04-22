# SurrealDB integration probe — findings

Run date: 2026-04-21
Surreal binary: 2.6.0 (macOS arm64)
TypeScript SDK: `surrealdb@2.0.3`
Bun: 1.3.9, Node 22.22
Anthropic Agent SDK: `@anthropic-ai/claude-agent-sdk@0.2.111`

All seven probes ran green. Recommendation at the bottom.

---

## Probe 1 — spawn + WS + CRUD (5/5)

`Bun.spawn` of `surreal start --bind 127.0.0.1:<port> --user root --pass root memory`
followed by WS connect from Bun reaches a clean responsive state in ~2s. Basic CRUD
(CREATE, SELECT, parameterized QUERY, UPDATE.merge, DELETE) all work.

**Gotchas locked in:**

- `run` is a reserved word in SurrealQL (it's a built-in fn). All harness tables must
  be prefixed (`harness_run`, `harness_phase`, etc.) or quoted.
- SDK 2.x is **strictly typed** at the API surface: `select`, `create`, `update`, `delete`
  take a `Table` instance or `RecordId`/`AnyRecordId`, NOT raw strings. A raw string
  silently misroutes — the error you get is a confusing
  `Can not execute X using value: '<table>'`.
- SDK 2.x is **fluent**: `db.create(table).content(data)`, `db.update(id).merge(data)`.
  Passing data as a 2nd positional arg compiles but no-ops (record gets `id` only).
- The `db.merge(id, data)` shortcut from older docs is **gone**. Use `update(id).merge(data)`.
- Result objects are class instances; `JSON.stringify` enumerates only public fields.
  Use `JSON.parse(JSON.stringify(x))` (or the SDK's `.json()` fluent option) to dump.

## Probe 2 — schema migration (5/5)

`DEFINE TABLE OVERWRITE` + `DEFINE FIELD OVERWRITE` + `DEFINE INDEX OVERWRITE` re-runs
cleanly on the same DB — usable as a boot-time migration that's idempotent.

`ASSERT $value IN [...]` enforces enums (verified: invalid status rejected with a
crisp error). `record<harness_run>` field type gives us SurrealKV-native record links;
`SELECT * FROM harness_phase WHERE run = $r` works with a record-id parameter.

## Probe 3 — live queries (4/4)

`db.live(table).subscribe(cb)` delivers CREATE / UPDATE / DELETE events to a separate
WS connection. `live.kill()` stops the subscription cleanly — writes after kill
produce no spurious events. End-to-end latency in-memory: **sub-millisecond**.

LiveMessage shape: `{ queryId: Uuid, action: "CREATE" | "UPDATE" | "DELETE" | "KILLED",
recordId: RecordId, value: object }`.

## Probe 4 — `SurrealSessionStore` adapter (8/8 conformance + 1/1 integration)

Implemented full adapter (append / load / listSessions / delete / listSubkeys) in
`SurrealSessionStore.ts` (~120 LOC). Self-rolled conformance suite covers the contract
spelled out in the SDK type docs:

| # | Check | Result |
|---|---|---|
| 1 | `load()` on missing key returns `null` | ok |
| 2 | Single-batch append/load roundtrip preserves entry order | ok |
| 3 | Multi-batch append maintains overall order across calls | ok |
| 4 | Distinct sessionIds isolated within same projectKey | ok |
| 5 | `subpath` (subagent transcript) isolated from main transcript | ok |
| 6 | `listSessions(projectKey)` returns sessionIds + valid mtimes | ok |
| 7 | `listSubkeys` returns subagent paths only | ok |
| 8 | `delete()` cascades from main key to subpaths; siblings survive | ok |

**Integration**: real `query()` against `claude-haiku-4-5-20251001` with
`sessionStore = SurrealSessionStore` persisted **12 transcript entries** to Surreal
under projectKey = `-Users-luisnovo-dev-projetos-harness` (encoded cwd). Single haiku
turn, ~7s wall clock, zero adapter bugs.

**Adapter-design gotchas:**

- SurrealQL `option<string>` rejects JS `null`. Must omit the field entirely when
  unset. Sending `subpath: null` errors with
  `Found NULL for field 'subpath' but expected a option<string>`.
- ORDER BY columns must appear in SELECT list. Can't `SELECT entry ORDER BY batch_id`
  even if batch_id is in the table.
- Aggregates over datetimes need `time::max(at)`, NOT `math::max(at)` (the latter
  silently returns null).
- The contract is **deep-equal, not byte-equal**. Surreal sorts object keys
  alphabetically on retrieval. JSON.stringify-based equality breaks; need a real
  recursive deep-equal in tests (and trust the SDK doesn't byte-compare).

## Probe 5 — mirror_error fault injection (3/3)

Wrapped `SurrealSessionStore` to kill the surreal subprocess before the 2nd append.
Result during a real haiku query:

- Query continued normally and **completed with subtype=success**.
- Local SDK transcript stayed intact: 12 lines in
  `~/.claude/projects/-Users-...-harness/<sessionId>.jsonl`.
- A `{type: "system", subtype: "mirror_error"}` event arrived in the message stream.

**Important caveat**: the mirror_error fired **~60s** after the subprocess kill
(SDK's internal append timeout). During those 60s the SDK retries / blocks. This is
a long stall window — for hot paths in a high-traffic deployment, we may want to
wrap our adapter with our own faster timeout that fails fast and lets the SDK's
mirror_error fire sooner. Documented as a known characteristic.

## Probe 6 — cross-process resume via store (5/5) — THE PROOF

Phase 1 ran a query embedding a unique secret token (`azure-rhinoceros-7891`) into
the conversation. Captured sessionId. Then **physically deleted** the local JSONL at
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Phase 2 called `query()` with
`resume: sessionId` and the same store.

**Result**: model echoed back the exact secret token. The SDK loaded the transcript
from our `SurrealSessionStore.load()`, materialized it to a temp file, and the
subprocess resumed from there. This is the load-bearing claim that justifies the
whole architecture, and it works.

## Probe 7 — bench (informational)

| Operation | n | min | mean | p50 | p95 | max |
|---|---|---|---|---|---|---|
| `surreal start` boot to ready | 5 | 1.84s | 2.10s | 2.13s | 2.20s | 2.21s |
| Live query notification (in-mem) | 40 | 0.42ms | 0.60ms | 0.55ms | 0.80ms | 1.72ms |
| `append` batch=1 entry | 30 | 0.18ms | 0.25ms | 0.21ms | 0.28ms | 0.93ms |
| `append` batch=10 entries | 30 | 0.46ms | 0.55ms | 0.53ms | 0.63ms | 0.79ms |
| `append` batch=100 entries | 30 | 3.17ms | 3.55ms | 3.54ms | 3.72ms | 3.89ms |

Boot cost (~2s) means `harness server` startup adds 2s when it spawns surreal as a
subprocess. Acceptable for a long-running daemon. If we ever want fast cold starts
we can pre-spawn or share with a system-installed surreal.

Append is sublinear: 100 entries cost ~14× a single entry, not 100×. The SDK batches
at ~100ms cadence, so per-batch cost dominates over per-entry cost. Net hot-path
overhead is negligible (~0.5ms for typical batches).

Live latency is essentially free in-memory; over real network it'll be RTT-bound,
but for in-process Mode B (surreal sidecar on localhost) staying single-digit ms
is realistic.

---

## Trade-offs locked in by this probe

**Confirmed worthwhile:**

- `SurrealSessionStore` is real and small (~120 LOC for the adapter, ~50 LOC for
  schema). The Anthropic SDK does the heavy lifting (encoding, batching, retry-ish).
- Multi-host resume **actually works**. This justifies a centralized DB even though
  it costs us the SQLite-WAL multi-process simplicity.
- Live queries are responsive enough to drive the web UI directly without a polling
  layer.
- Schema enforcement (ASSERT, types, indexes) gives us defense-in-depth that we
  didn't have with `bun:sqlite` (which was effectively schemaless).

**Friction we'll pay forever:**

- SDK 2.x fluent + class-instance API is verbose and easy to misuse silently. We'll
  want a thin internal helper layer in `state/` that wraps the common patterns
  (insert + return, bulk insert with id refs, etc.).
- Object-key alphabetization. Our types must not assume preserved key order. Tests
  must use deep-equal.
- `option<T>` ≠ `T | null` in SurrealQL terms — adapter has to omit, not nullify.
- 60s mirror timeout is long. Consider an explicit per-call wrapper timeout in our
  state layer if Surreal latency ever becomes an issue.

**Operational footprint:**

- Need to bundle/distribute `surreal` binary or require user-install. Bundle via npm
  postinstall is the path of least friction for users. Risk: per-platform binaries
  add ~10–20MB to install. Acceptable for self-hosted; questionable for `bunx`
  one-shots. Defer the bundling decision but collect evidence for or against.

## Recommendation

**Go.** Commit to SurrealDB for Tier 4. The architecture works as designed:

- Filesystem-first run state (our `state.json`) for Mode A standalone.
- `SurrealStateStore` mirror for Modes B/C (publisher-from-runner, no watcher).
- `SurrealSessionStore` for SDK transcripts — solved problem, ~120 LOC.
- Live queries for the web UI — sub-ms latency, sound contract.
- `surreal start` as a subprocess of `harness server` in Mode B; pointing at
  remote URL for Mode C with no code change.

Three concrete things to design carefully before implementation:

1. **A small internal helper around the SDK's verbose fluent API.** The probes show
   that misuse is silent (no errors, just empty results). We need a thin typed
   layer in `packages/core/src/state/surreal/` that hides `Table`/`RecordId`/`.content()`
   behind ergonomic functions like `insertRun(state)`, `appendPhase(runId, phase)`.

2. **Explicit append timeouts wrapping the SessionStore adapter** so we don't eat
   60s stalls when the central Surreal is down. Wrap in `Promise.race` with our own
   ~5s timeout that throws → SDK fires mirror_error promptly → run continues with
   only local persistence.

3. **A `surreal` binary bundling decision**: postinstall download per-platform vs
   require install. Benchmark a real `harness server` boot in both setups before
   committing.

Open follow-ups (not blockers):

- Try `surrealkv://` file storage (probes used `memory://` for speed). Verify
  cross-restart durability and recovery semantics.
- Explore `DEFINE PERMISSIONS` for the Mode C team scenario where the web UI may
  eventually connect directly to the DB with a scoped JWT.
- Probe the `@surrealdb/node` embedded engine someday if we want to drop the
  external binary dependency entirely (single-process limitation will still apply,
  so it'd only fit Mode A — which currently doesn't need a DB at all). Probably
  not worth it.
