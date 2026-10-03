# Complete authoring and development

The workbench has two additional MCP profiles and matching CLI commands.
`authoring-v1` provides whole-project source builds and the certified semantic
editor with `standard-v2` block construction. `development-v1` provides a live
runtime, retained inspection, marked reproduction, and a local comparison
viewer. The existing `repair`, `project-edit`, and `a0-v1` contracts remain
separate.

## Source and build layout

Keep editable sources, generated builds, and private evidence in separate
directories. A `scratch-workspace.json` has `schemaVersion: 2`; its baseline is
`{"kind":"greenfield"}` or an explicitly selected immutable baseline. It refers
to typed JSON script/procedure files, assets, clips, runtime targets, scenarios,
assertions, and an output recommendation. Targets, declarations, assets,
procedures, and scripts use stable logical identifiers. Sources never contain
Scratch block IDs, graph pointers, or raw mutations.

The maintained types in
[`workspace-types.ts`](../packages/ir/src/authoring/workspace-types.ts) describe
the source format. The generic
[`acceptance-fixture.ts`](../scripts/authoring/acceptance-fixture.ts) creates a
complete two-player workspace with eighteen costume references and an animation
clip. Run `npm run workbench-acceptance` to build two versions, evaluate and
export them, play both runtime profiles, reproduce a mark, and generate a
comparison viewer. Evidence remains under the printed `runs/` directory.

An operator-owned authoring configuration grants exact source, output, and
evidence roots. For example:

```json
{
  "schemaVersion": 1,
  "permissions": {
    "sourceRoots": ["/absolute/game/source"],
    "evidenceRoot": "/absolute/game/private-build-evidence",
    "outputRoots": ["/absolute/game/builds"]
  }
}
```

Configurations may lower resource limits. Project files cannot grant roots or
raise limits. A configured `ffmpeg.executablePath` enables MP3 and IMA-ADPCM WAV
decoding; no executable is installed automatically. Integer PCM WAV decoding
uses the native implementation.

Writable authoring requires the pinned optional native dependency `fs-ext@2.1.1`
on a lock-capable local macOS or Linux filesystem. Installation builds that
addon through the repository's approved install-script policy. Missing native
support refuses before authoring mutations; read-only inspection remains
available. A competing writer refuses as busy. Ownership rotation, retained
state and quota changes, and publication use the same nonblocking root lock.

```bash
npm run authoring:open -- --host-config /absolute/authoring-host.json \
  --manifest /absolute/game/source/scratch-workspace.json
npm run authoring:plan -- --host-config /absolute/authoring-host.json \
  --workspace <workspaceId>
npm run authoring:build -- --host-config /absolute/authoring-host.json \
  --workspace <workspaceId> --plan <planId>
npm run authoring:evaluate -- --host-config /absolute/authoring-host.json \
  --workspace <workspaceId> --build <buildId>
npm run authoring:export -- --host-config /absolute/authoring-host.json \
  --workspace <workspaceId> --build <buildId> \
  --output /absolute/game/builds/game-v1.sb3
```

Each command opens the same retained service state. The immutable plan records
source hashes, prepared asset identities, resolved references, operation order,
global costs, compiler/authority identities, and execution identities. Build
recompiles that exact plan privately. Evaluation applies every assertion to each
selected runtime target. Export requires the latest evaluation of that exact
candidate to be accepted and publishes a new destination. Changed inputs,
failed evaluation, identity drift, or a budget violation refuse promotion.

Exports retain an immutable intent and exact preparation evidence before
publishing. If a receipt or state update fails after publication, the verified
file survives and the result identifies a recovery-required `exportId`.
Ordinary workspace mutations remain blocked until that intent is reconciled:

```bash
npm run authoring:recover-export -- --host-config /absolute/authoring-host.json \
  --workspace <workspaceId> --export <exportId>
```

Recovery is idempotent. It completes a matching publication and receipt or
reports interference without replacing conflicting files. Existing output
directory permissions remain unchanged. The publications collection also
discovers retained intents and preparations whose workspace-pointer update
failed. Recover the returned export ID; an exact export retry follows the same
recovery path instead of creating a second publication.

New evaluation records retain the browser installation identity used by each
rendered lane. Receipt recovery verifies historical acceptance from retained
evidence. A matching file that was already published can complete its receipt
after the installed browser changes. Creating a new file still requires current
matching source, tool, and runtime identities. Older records remain readable;
recognized historical publications are reconciled before the workspace moves
to the current publication policy.

`authoring:inspect` paginates status, sources, assets, clips, plans, builds,
evaluations, exports, publications, artifacts, and complete diffs. Inspection
refreshes retained state and publication evidence, and rejects cursors from an
earlier state.
`authoring:replay` rebuilds
from retained source without writes or agents and compares exact bytes.
`authoring:close` closes further authoring. Accepted builds include a
`developmentClips` artifact for importing resolved animation metadata into the
development viewer.

## Blocks and media

`standard-v2` exposes all 121 public core opcodes, semantic custom procedures,
and public Pen, Music, and Video Sensing blocks. The builder generates necessary
shadows, menus, declaration references, procedure mutations, and block graphs.
Hidden, obsolete, and editor-only nodes are preserved, with their support status
shown explicitly in catalog documentation. Extension metadata follows authored
blocks; a referenced extension cannot be removed.

```bash
npm run authoring:inspect -- --collection catalog --limit 20
npm run authoring-catalog-check
```

The catalog includes fields, inputs, defaults, menus, placement rules, and
continuation constraints. Use its returned cursor for later pages. Procedure
parameters are scoped to their owning definition. Terminal `stop` options and
`sensing_of` property ownership are validated before promotion.

PNG preparation supports explicit-grid or rectangle slicing, crop, nearest
resize, horizontal/vertical flip, simultaneous exact RGB palette replacement,
and pivot updates. Alpha is preserved; output is canonical RGBA8 PNG. Transform
pivots with the image, or change only the pivot without rewriting asset bytes.
Named clips resolve to ordered costume names/indexes and millisecond duration
tables. Scratch scripts own playback. Preview tools provide frame navigation,
playback, contact sheets, origins, grids, and adjacent frames.

Audio preparation preserves supported sample rate and mono/stereo channels by
default and emits PCM16 WAV. Sources remain immutable, with source,
transformation, output, and configured decoder identities retained.

Whole builds enforce 4,096 costumes, 1,024 costumes per target, 100 MiB asset
payload, 50 MiB `.sb3`, and 256 MiB estimated decoded costume memory. Sequential
preparation also caps each frame at sixteen transforms, live decoded buffers at
128 MiB, and each job at 268,435,456 pixel visits. Shared payloads and repeated
costume references have distinct accounting; bulk builds use one global budget.

## Playtesting and inspection

A development configuration grants exported sources and private evidence:

```json
{
  "schemaVersion": 1,
  "permissions": {
    "sourceRoots": [
      "/absolute/game/builds",
      "/absolute/game/private-build-evidence"
    ],
    "evidenceRoot": "/absolute/game/private-development-evidence"
  }
}
```

The build-evidence source root is optional; include it only when importing clip
metadata from that directory. `RuntimeExecutionProfileV1` selects runtime
(`scratch-official` or `turbowarp`), scheduler (`deterministic` or `natural`), and
tick rate (`30` or `60`) independently. Omitting the profile preserves the
existing deterministic TurboWarp/manual-60 behavior. Human presets use native
scheduling: `official30` and `turboWarp60`.

```bash
npm run playtest -- --host-config /absolute/development-host.json \
  --input /absolute/game/builds/game-v1.sb3 --preset official30
npm run debug -- --host-config /absolute/development-host.json \
  --input /absolute/game/builds/game-v1.sb3 \
  --profile '{"schemaVersion":1,"runtime":"turbowarp","scheduler":"deterministic","tickRate":60}'
```

Both commands keep their runtime in one process. The browser has physical
start, pause, resume, restart, and close controls. Keyboard/mouse inputs are
recorded where they enter the VM, including application order and focus-loss
releases. Each session allows 4,096 ordinary inputs and 256 cleanup releases,
with cumulative ordinals through 4,352. Holding a new control reserves capacity
for its eventual release. Restart uses the exact remaining input budgets in a
fresh recorded segment. Retained inspection refreshes checkpoint/final history;
cursors refuse when that lifecycle identity changes. Marks select their exact
observation order, including inputs preceding that observation. Camera and
microphone requests require the human permission button and browser permission;
automated device access stays disabled.

Version-two recordings use a browser-owned sequence for inputs and observations.
Each observation retains its applied-input ordinal and green-flag boundary;
marks capture state and that boundary together. Raw keyboard payloads remain
available alongside the selected runtime's interpreted key identity. Ignored
keys have no held identity. Timestamps are diagnostic and do not determine
which inputs precede an observation.

Before opening a browser, retention reserves three terminal artifacts and
`2 * maxTraceBytes + 1 MiB` for the final checkpoint, trace, and session summary
(33 MiB with the default 16-MiB trace limit). Source storage and a separate
512-KiB initial-checkpoint allowance also need room. Optional evidence writers
honor the same persisted reservation. The three terminal records commit in one
catalog update; unsuccessful finalization retains the reservation and reports
incomplete status. An undersized configuration refuses before launch; raise
`maxRetainedBytes`/`maxRetainedArtifacts` or lower `maxTraceBytes`.

Send JSON lines to the command's stdin, for example:

```jsonl
{"kind":"input","input":{"device":"keyboard","key":"d","isDown":true}}
{"kind":"advance","ticks":30}
{"kind":"input","input":{"device":"keyboard","key":"d","isDown":false}}
{"kind":"mark","label":"unexpected shield result"}
{"tool":"inspect","collection":"state","limit":10}
{"tool":"reproduce","markId":"<returned-mark-id>"}
{"kind":"recordAudio","durationMs":3000}
{"kind":"view"}
{"tool":"close"}
```

`advance` is available with deterministic scheduling. Selected-state probes
sample properties, variables, list prefixes/lengths, timer, and clone counts
after runtime steps without adding gameplay ticks or renderer draws. Clone-local
association uses an opt-in game-owned instance-key variable. Missing and
duplicate keys are reported as unavailable or ambiguous.

Audio capture records the internal runtime output as a listenable WebM/Opus
clip, without accessing a hardware microphone. A suspended audio context reports
unavailable; a physical start/resume action activates browser audio. Audio
capture, bounded sound-event logs, and natural scheduling performance diagnostics
are separate from exact state equality and editing certificates.

Closed version-two sessions can be inspected, reproduced, and viewed from another
process:

```bash
npm run development:inspect -- --host-config /absolute/development-host.json \
  --session <sessionId> --collection marks
npm run reproduce -- --host-config /absolute/development-host.json \
  --session <sessionId> --mark <markId>
npm run development:view -- --host-config /absolute/development-host.json \
  --session <sessionId> --compare-session <other-sessionId> \
  --reproduction-artifact <returned-result-key>
```

The self-contained viewer displays saved ticks, applied inputs, selected state,
marks, replay frames, animation previews, and two-build comparison. Declared
rectangle/circle collision overlays are external annotations, visually distinct
from costume image bounds. Their values may use constants or numeric probes.
Reverse navigation reads history; it never restores arbitrary VM state.

Reproduction applies the marked input prefix from reset and reports a selected
state match, first divergence, or unavailable evidence. Deterministic replay
captures the final visual window with a default 120-frame/25-MiB budget and hard
240-frame/50-MiB ceilings. Natural recordings convert to deterministic scheduling
with the same runtime/tick rate; system timer differences remain diagnostics,
while selected game variables are compared. This does not claim exact natural
scheduling or gameplay equivalence beyond the retained selected evidence.
Legacy version-one recordings remain readable, but lack the chronology needed
to certify a new exact reproduction. Their retained catalogs are read-only.

## Scoped MCP connections

Start the server with `node packages/mcp/dist/transport/server.js`. Set
`SCRATCH_AGENT_MCP_PROFILE` to `authoring-v1` or `development-v1`,
`SCRATCH_AGENT_WORKBENCH_CONFIG` to the absolute operator configuration, and
`SCRATCH_AGENT_WORKBENCH_CONFIG_SHA256` to its exact SHA-256. Pin the configuration
in a task-specific MCP connection; no global Codex settings need to change.

`authoring-v1` advertises the standard-capable project/edit lifecycle plus
`authoring_open`, `authoring_plan`, `authoring_build`, `authoring_evaluate`,
`authoring_export`, `authoring_recover_export`, `authoring_inspect`, and
`authoring_close`. Its combined
certified editing lifecycle also requires the existing trusted host descriptor,
contract registry, protected roots, and secret-material pins. Use the existing
semantic-edit host preparer to produce those operator-owned inputs; a workspace
manifest does not grant editing authority. The bounded
[`native-acceptance.ts`](../scripts/authoring/native-acceptance.ts) demonstrates
an isolated connection and retained audit/replay.

`development-v1` advertises only `development_begin`, `development_command`,
`development_inspect`, `development_reproduce`, and `development_close`.
`development_command` also handles `view`, `importClip`, and `recordAudio`.
Large selections return catalog-bound artifact URIs; resource reads provide
hash-verified base64 chunks and a next URI. Full catalogs use pagination.

Each authoring/development artifact also provides an explicit `snapshotUri`
with `read=snapshot-v1`. This mode verifies the complete artifact once, then
pages private retained bytes. Responses identify the snapshot, verified hash,
verification time, and expiry; follow the opaque token in `nextUri`. Fresh
`uri` reads continue checking the current file on every request. A verified
snapshot keeps its original bytes if the retained file later changes.

Each MCP server admits two snapshots of at most 64 MiB each, with a 128 MiB
aggregate payload budget that includes verification in progress. Capacity is
reserved before reading payloads. Snapshots expire after 60 seconds idle or
ten minutes total, and server closure aborts verification and releases their
owned bytes. Expired, exhausted, or mismatched continuations refuse explicitly;
start a new snapshot read to verify current bytes again.

Whole authoring/development transport audits are local hash chains. They do not
replace the authenticated certified-edit journal or create an A0 certificate.
Historical exact replay requires matching recorded semantic/runtime identities
and refuses tool drift. No direct model-provider or API-key integration is
included; game mechanics and CPU behavior remain authored Scratch scripts.
