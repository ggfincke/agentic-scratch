# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: npm workspaces monorepo, TypeScript (ESM, NodeNext, project
  references), ESLint flat config w/ ported `ggfincke/*` comment-style rules,
  Prettier (Allman / no-semi / single-quote).
- Packages `@scratch-agent/sb3` and `@scratch-agent/runner` — a
  compatibility spike that loads a fixture `.sb3`, validates it, runs it in the
  VM + browser lanes, and writes a run report.
- `@scratch-agent/ir` — a typed Scratch IR with **lossless** `.sb3`
  import/export. A carry-faithful design preserves every field verbatim
  (custom-block mutations, monitors, comments, mixed `warp` encodings, unknown
  forward-compat keys); verified by round-tripping the 48-sprite "Sonic Fighters"
  (5,437 blocks, 1,707 assets) byte-for-byte. Adds canonicalization + structural
  diff, readable per-sprite script summaries, and build ops (add
  sprite/variable/list/broadcast/costume/script) used to generate blank/cat/
  clicker projects from the IR.
- `@scratch-agent/sb3`: full faithful `project.json` types + `.sb3` unpack/pack
  (deterministic zip).
- CLIs: `npm run inspect -- <path>` (readable project summary) and
  `npm run roundtrip -- <path>` (losslessness check) for any `.sb3`.
- Packages `@scratch-agent/validate` and `@scratch-agent/static` — a
  validation stack that catches broken edits before runtime. `validate` runs
  block-graph + referential integrity (id resolution for variables / lists /
  broadcasts / procedures incl. Stage globals, `next`/`parent` & input/shadow
  topology, custom-block prototype<->call matching, monitor / asset / extension
  references, Stage invariants), severity-tiered by VM tolerance: **error** =
  won't load / crashes the VM, **warning** = loads but silently broken, **info**
  = drift. `static` adds 11 advisory smell/bug checks (message never sent /
  received, dead code, empty script / control body, unused variable / custom
  block, hide-without-show, comparing-literals, missing-backdrop, ambiguous
  custom-block signature) plus size metrics. Verified **zero** false-positive
  errors across the fixture corpus and the 5,437-block "Sonic Fighters", and
  adversarially audited for false negatives.
- CLI: `npm run validate -- <path> [--strict]` — schema (`scratch-parser`) +
  graph + static; the gate fails on any error, and `--strict` also fails on
  warnings.
- `@scratch-agent/eval` + a VM test runner. `runner` gains a deterministic
  scenario driver that drives the **real** headless VM through a timeline of
  steps (green flag, key press, sprite / stage click, broadcast, mouse,
  type-answer, wait, snapshot) and captures a rich, labeled state trace
  (position, direction, size, costume, visibility, rotation style, effects,
  volume, say / think bubble, per-sprite variables & lists, plus answer, timer
  and stage backdrop / tempo). Runs are fully reproducible: a virtual clock
  replaces every wall-clock read (`wait`, timer, glide, say-for-secs),
  `Math.random` is seeded, and the date is fixed — all injected **at the edges,
  never in block code**; a headless redraw emulation makes visual loops (e.g.
  forever-move) yield once per tick instead of spinning to the work budget.
  `eval` adds a tiny declarative assertion DSL (probe a sprite property /
  variable / list / timer / answer / said-text; match with `equals` / `closeTo`
  / `gt` / `lt` / `contains` w/ Scratch-faithful coercion); every failure
  carries expected vs observed and a likely location (target + hint).
- `@scratch-agent/ir`: `buildMovement()` — an arrow-key-controlled mover sprite.
- CLI: `npm run vmtest` — runs the canonical scenario suite (clicker, movement,
  cat-loop, wait-timer, broadcast-relay, say, ask-answer, calendar, glide),
  writes JSON + Markdown reports under `runs/`, and exits non-zero on any
  failed assertion.
- Browser visual runner. The browser lane now runs the **same**
  `Scenario`/`Step[]` timeline as the VM lane through a shared, lane-agnostic
  driver, so **browser tick N == VM tick N**. Rendering is frame-exact and
  deterministic: the runner stops scaffolding's free-running loop, single-steps
  the VM itself, and forces an explicit `renderer.draw()` per tick, reusing the
  VM lane's determinism edges in-page (virtual clock, seeded RNG, fixed date,
  fake timers). Input is driven in-page (`postIOData` / `startHats`), and every
  `snapshot` step captures a stage screenshot under `runs/<id>/`.
- In-page visual observation: per-sprite screen-space rects (mapped from renderer
  bounds) for sprite-level localization, plus a downsampled mean-RGB frame grid
  read straight off the GL framebuffer (`gl.readPixels`, no new deps).
- `@scratch-agent/eval`: a visual assertion track. `TestCase` gains an optional
  `visual` list evaluated against the browser lane; new probes `spriteRect`,
  `spriteInRegion`, `notBlank`, `regionInk`, and `regionChanged` reuse the
  existing matcher/localization machinery, and failures localize to the sprite.
  Runs record a video that is **kept only on failure** (`runs/<id>/`) and
  discarded on pass.
- `@scratch-agent/ir`: `buildCollector()` — a key-controlled Player + a falling
  Item that scores on touch. The touch is renderer-dependent, so the headless VM
  lane reads `score 0` while the browser lane reads `score 1`, exercising
  behavior the VM lane cannot observe.
- CLI: `npm run vistest` — runs the browser visual suite, writes screenshots +
  failure videos + a versioned JSON/Markdown report envelope under `runs/`, and
  exits non-zero on any failed assertion.
- Model-based testing. New `@scratch-agent/model` runs finite-state game
  models in **lockstep** with the program: models are authored in Whisker's
  model-JSON format (program / end / user models; nodes; edges w/ `{name,negated,
args[]}` conditions & effects), Zod-validated and lowered to a runtime FSM. No
  external Whisker runtime is vendored — its concepts + format are adopted natively
  atop the existing driver. `runner` gains a per-tick `TickObserver` hook so a
  `ModelChecker` sees every frame-exact tick (post-step state + held keys +
  clicks); the checker takes the first edge whose conditions all pass, checks each
  effect over a **2-step window** (Scratch effects can lag a frame), handles
  stop / stop-all nodes and post-run `end` models, tracks per-edge coverage (the
  trace-attribute analog), and warns on simultaneously-passing edges. Model
  timings convert ms -> ticks against our 60 TPS virtual clock. Supported check
  subset: `VarComp/VarChange`, `AttrComp/AttrChange`, `Output`, `Key/AnyKey`,
  `Click`, `TimeElapsed/TimeAfterEnd`, `Probability`, `SpriteTouching` (browser
  lane), and storage / control effects; `Expr` and color/clone checks are
  deferred and rejected at load with a clear error.
- Mutation testing. New `@scratch-agent/mutate` perturbs a project's IR —
  operator swaps (`+`<->`-`, `>`<->`<`, `and`<->`or`, ...), constant tweaks,
  leaf-statement deletion (with `next`/`parent` relinking + reporter-subtree
  cleanup), and boolean-condition negation — producing enumerable mutant projects.
  `@scratch-agent/eval` runs a base case against each valid mutant (stillborn
  mutants that fail graph validation are excluded) and scores which the suite's
  oracles kill.
- `@scratch-agent/ir`: `buildStateGame()` — a start/play/win/loss game whose Stage
  derives a `state` var (space collects a point; ten points win; damage loses).
  `@scratch-agent/eval` ships the matching model suite: the program model reaches
  `won` and an end model asserts the final win state, while an injected
  score-increment mutation is caught by **both** the model and the state asserts.
- CLIs: `npm run modeltest` (model suite -> versioned report envelope) and
  `npm run mutate` (mutation score + killed/survived/stillborn breakdown under
  `runs/`), each exiting non-zero on failure.
- Transactional repair primitives in `@scratch-agent/ir`: detached
  typed semantic operations, guarded references, atomic baseline-relative
  application, hard resource and intent/impact budgets, complete attributed
  deltas, and preservation manifests for assets, declarations, workspace state,
  project structure, metadata, and unknown fields.
- Candidate evaluation in `@scratch-agent/eval` and shared runner
  infrastructure: exact baseline expectations, schema/graph/static preflight,
  targeted-before-regression execution, structured failure fingerprints and
  responsibility, and serialized access to process-global VM/browser shims.
- Packages `@scratch-agent/localize` and `@scratch-agent/repair`.
  Deterministic structural localization ranks scripts and implicated blocks
  with reason provenance; the provider-neutral repair controller owns immutable
  requests, retries, evidence escalation, rollback, promotion, exclusive
  artifact retention/export, redaction, and authoritative JSON/Markdown reports.
- Five registered repair benchmarks (R1-R5) spanning literal, insertion,
  broadcast, opcode, and browser-rendered motion faults. The deterministic
  aggregate `npm run repair-bench` verifies one-operation case budgets,
  localization, gate order, preservation, accepted hashes, and R5-only browser
  escalation.
- `@scratch-agent/mcp`, a five-tool local stdio adapter for Codex with generated
  proposal schemas, replay-safe opaque sessions, MCP-native structured errors,
  explicit no-follow input/output roots, quiet protocol stdout, and verified
  exclusive export. `npm run repair` provides fixture, scripted-repair, and
  independent verification modes; `npm run repair-bench:codex` records isolated
  live R1-R5 traces, controller evidence, exports, and verification reports.
- Bounded `.sb3` admission: raw central-directory preflight, a 4,096
  entry default, stable machine issue codes, validated/frozen limits, ZIP
  feature/type/path/duplicate rejection, local/central header agreement,
  output-bounded DEFLATE decoding, fatal `project.json` UTF-8, CRC verification,
  and shared admission across validation, IR, evaluation, CLI, and MCP
  consumers.
- Project readiness in `@scratch-agent/eval`: immutable inspection
  catalogs, expanded project metrics, exact raw JSON and asset-manifest
  preservation evidence, atomic partial reports, classified/bounded VM and
  browser logs, and a seven-stage full profile. `npm run project-check --
--input <project.sb3>` records structural, preservation, VM, browser, visual,
  performance, runtime, host, and explicit non-claim evidence under `runs/`.
- Four generic project MCP tools beside the registered repair tools:
  `project_open`, `project_inspect`, `project_run`, and `project_status`.
  Selected source bytes remain read-only; queries and evidence resources are
  paginated/bounded; cursors are signed and collection-bound; sessions/runs and
  artifact bytes are capped; failed run trees are rolled back; evidence reads
  reject links and changed/oversized files before loading bytes; network is
  always denied; and generated evidence uses opaque resource URIs without
  exposing private input/catalog artifacts.
- `npm run project-walkthrough:codex -- --input <project.sb3>` records one
  isolated read-only Codex/MCP acceptance task and independently verifies its
  tool sequence, complete target pagination, response budgets, source identity,
  empty output root, both VM/browser snapshot lists and settled states,
  run-scoped artifacts, screenshots, and durable evidence. The local Sonic
  Fighters artifact is the explicit real-world scale gate, not a production/test
  dependency or a source of project-specific behavior.
- Multimodal bounded observation infrastructure in `@scratch-agent/runner`:
  admitted logical-tick media plans, exact PNG manifests, clone-count and
  renderer geometry traces, pinned runtime identities, shared offline scenario
  mechanics, and separate official Scratch and TurboWarp browser lanes.
- Multimodal evaluation contracts in `@scratch-agent/eval`: bounded visual
  criteria, tri-state aggregation, five finite behavioral lenses, explicit
  runtime capability classification, cheap and rendered differentials,
  selective state/screenshot/VLM escalation, strict evidence-bound judgments,
  bounded execution telemetry, and exact retained-record replay.
- Multimodal localization and repair integration: normalized visual symptoms map
  to real targets, scripts, declarations, costumes, and assets; repair can opt
  into a versioned retained Multimodal evidence facet without changing the
  R1-R5 acceptance or promotion boundary.
- Multimodal closeout infrastructure and deterministic evidence:
  `npm run multimodal-bench` records a 38-case deterministic corpus;
  the archived `scripts/archive/renderer-experiment.ts` retains a measured
  headless-gl rejection and keeps Playwright in production;
  `multimodal-agent:record` runs isolated, read-only
  Codex visual judgments through the user's ChatGPT session; and
  `multimodal-agent:replay` verifies the exact retained records with zero agent
  executions. `multimodal-project-check` composes generic project readiness,
  bounded temporal media, runtime classification, retained judgment replay, and
  exact source preservation. The workflow has no API-key or direct provider
  integration.

### Changed

- Unit tests moved from colocated `packages/**/*.test.ts` to root
  `tests/<package>/`; `npm test` discovers `tests/**/*.test.ts`.
- The browser lane replaced its wall-clock settle (fixed per-tick sleeps) with
  frame-exact manual stepping; `runVm`/`runBrowser` remain thin compatibility
  projections over the shared scenario driver.
