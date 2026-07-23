# agentic-scratch

An **IR-first, `.sb3`-backed** workbench for AI coding agents to create, edit,
test, visually inspect, debug, and iteratively repair
[Scratch](https://scratch.mit.edu) projects — a full
**write -> run -> observe -> debug** loop.

The agent never hand-edits raw `project.json`. It edits a typed Scratch **IR**
through semantic operations; a deterministic builder compiles the IR to a valid
`.sb3`; every artifact is validated, then run through layered oracles that
escalate only as far as a question needs. Core principle:
**state-first, vision-second, artifact-always.**

## How it works

```
request -> IR + patch engine -> deterministic .sb3 builder
  -> validation (schema + graph + static)
  -> VM state lane -> test lane (assertions + model)
  -> browser visual lane (Playwright + TurboWarp)
  -> observation (snapshots + traces + screenshots + video)
  -> evaluator -> failure localizer -> minimal repair patch -> repeat
```

Cheap oracles run first; the expensive ones (browser render, video/VLM) run only
when a cheaper lane cannot answer.

## What it does

- **Author & edit** — open an admitted `.sb3` (or a blank template) into an
  immutable, revisioned edit session; apply typed operations over sprites,
  variables/lists, broadcasts, scripts, blocks, custom procedures, comments,
  layout, costumes, and sounds; preview the complete diff; export a certified
  new `.sb3` without ever mutating the source.
- **Validate** — schema, block-graph, and referential-integrity checks plus
  advisory static analysis, before anything runs.
- **Test** — deterministic VM scenario tests, a native lockstep model runner,
  IR mutation testing, and a browser visual lane with screenshots and
  video-on-failure.
- **Repair** — a transactional, baseline-relative repair controller: candidate
  evaluation, deterministic failure localization, evidence escalation, and
  preservation-safe promotion, with JSON + Markdown reports.
- **Observe (multimodal)** — bounded temporal capture, finite behavioral lenses,
  selective screenshot/VLM evaluation, exact replay, and evidence-bound
  judgments.
- **Agent interface** — a local stdio **MCP** server exposing read-only project
  inspection, edit, and repair tools.

Every run pins and records each runtime's version/hash (VM, renderer,
scaffolding, browser, project hash, builder/IR version) so reports are
reproducible.

## Layout

```
packages/
  sb3/      # .sb3 build/import/export + packaging
  ir/       # typed Scratch IR + deterministic builder + semantic edit ops
  validate/ # graph / referential diagnostics
  static/   # advisory static checks + metrics
  runner/   # VM + browser execution lanes + per-tick observer + report writer
  model/    # native model-based testing (Whisker-compatible model JSON)
  mutate/   # IR-level mutation operators
  eval/     # scenario, project-check, multimodal, model & mutation evaluation
  localize/ # deterministic structural failure localization
  repair/   # repair policy, sessions, evidence, reports & benchmarks
  edit/     # revisioned semantic editing, evaluation, replay & export
  mcp/      # local stdio project-inspection, edit & repair tools
eslint-rules/ # repo comment-style lint rules
scripts/      # suite, repair, benchmark & build entry points
fixtures/     # test .sb3 artifacts
```

## Quickstart

```bash
npm install
npx playwright install chromium   # one-time, for the browser lane
npm run build                     # tsc -b + bundle the browser page

npm run spike                     # compatibility VM + browser run on the fixture
npm run validate -- fixtures/fixture.sb3
npm run project-check -- --input /absolute/path/project.sb3
```

Test & evaluation lanes:

```bash
npm test              # full node --test suite
npm run vmtest        # deterministic VM scenario suite
npm run vistest       # browser visual suite (screenshots + video on failure)
npm run modeltest     # model-based suite (a game state machine, in lockstep)
npm run mutate        # mutation run (scores which mutants the suite kills)
npm run repair-bench  # R1-R5 aggregate repair gate
npm run semantic-edit-bench   # semantic editing benchmark
npm run multimodal-bench      # deterministic multimodal acceptance
```

Requires **Node 22+**. ESM throughout; relative imports use explicit `.js`
extensions (NodeNext).

## Scope & trust boundary

Project, edit, and repair inputs are repository-generated or explicitly
selected, size-limited `.sb3` files. Read-only project tools cannot modify or
export the source. Edit tools keep a private baseline and can write only a new
certified artifact beneath an approved output root. The in-process Scratch VM is
**not** a hostile-code sandbox — running arbitrary untrusted projects needs a
separate OS-contained worker. Bounded observations do not claim complete gameplay
correctness or universal semantic equivalence.

## License

MIT — see [LICENSE](LICENSE).
