# Examples

Local, real-world Scratch projects for exercising the pipeline end-to-end
(load -> validate -> VM + browser lanes -> report).

Everything here except this README is git-ignored: real `.sb3` projects are
large (tens of MB w/ assets), so they stay local. Drop projects you want to
test against into this folder.

Tiny, deterministic test artifacts live in `fixtures/` (committed) instead.

Run the complete generic readiness workflow against a selected project:

```bash
npm run project-check -- --input "/absolute/path/to/examples/project.sb3"
```

To verify a real Codex agent used only the bounded read-only MCP workflow and
left the source unchanged:

```bash
npm run project-walkthrough:codex -- \
  --input "/absolute/path/to/examples/project.sb3"
```

See the root README Develop/Trust sections for interpretation, limits, and
trust caveats.
