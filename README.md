# archify-pr-action

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/arvindand/archify-pr-action)](https://github.com/arvindand/archify-pr-action/releases)

A GitHub Action that reviews architecture changes on pull requests, built on
[archify](https://github.com/tt-a1i/archify).

Your repository keeps its architecture as archify's typed JSON, committed like
any other file. On every PR, the action validates that file, compares it against
the base branch, and posts a comment listing exactly what changed: components
and connections added, removed, changed, moved, or rerouted. An interactive
Before/Delta/After HTML viewer is attached as a workflow artifact.

Everything that runs in CI is plain Node. There are no LLM calls and no API
keys. The comparison is deterministic: archify canonicalizes both snapshots
before diffing, and this repository's CI verifies that the same inputs produce
byte-identical receipts across runs.

## The PR comment

```markdown
## Architecture review

### `docs/architecture/self.architecture.json`

**2 added · 0 removed · 0 changed · 0 moved/rerouted**

| | kind | element | change |
|---|---|---|---|
| + | component | `Vendored archify` | added |
| + | connection | `runner → vendor-cache` (downloads) | added |
```

The comment is sticky. Pushing more commits updates it in place rather than
adding a new one.

## How it works

The architecture map is authored, not derived from code. An agent with the
archify skill (Claude Code, Cursor, Codex, OpenCode) writes and updates the
JSON as part of the same PR that changes the architecture, a human reviews it,
and CI does the mechanical part: validate, diff, render.

That division is deliberate. Nothing in CI guesses at your architecture, and
nothing in the comment is inferred. It renders only the facts from archify's
delta receipt.

## Quick start

1. Generate the map once. Ask your agent:

   > Use archify to map this repository's runtime architecture and save the
   > validated JSON to docs/architecture/runtime.architecture.json

2. Review the JSON and commit it.

3. Add the workflow:

   ```yaml
   name: architecture-review
   on:
     pull_request:
   permissions:
     contents: read
     pull-requests: write
   jobs:
     archify:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: arvindand/archify-pr-action@v0.1.0
   ```

From then on, a PR that changes the map gets the delta comment. A PR that
changes code under `src/**` without touching the map gets a short note asking
whether the architecture changed. A PR that touches neither gets no comment.

## Inputs

| Input | Default | Purpose |
|---|---|---|
| `map` | `docs/architecture/*.architecture.json` | Git pathspec glob for the map file(s); each match is compared independently |
| `quality` | `standard` | archify quality profile (`standard` or `showcase`) |
| `nudge-paths` | `src/**` | Globs that trigger the "did the architecture change?" note |
| `comment` | `on-change` | `on-change`, `always`, or `never` (the artifact is uploaded either way) |
| `token` | `${{ github.token }}` | Token used to post the comment |

## Behavior notes

- **Pinned archify.** The action vendors archify at an exact commit (currently
  v2.15.0). A schema mismatch fails loudly with archify's diagnostics instead of
  producing a wrong diff.
- **Validation failures fail the check.** If the map doesn't validate, the
  comment carries the diagnostics so the author can fix the named fields.
- **New and deleted maps are handled.** A new map gets a full render attached;
  a deleted map is reported as removed.
- **Artifact upload is best-effort.** The comment is the deliverable. If the
  artifact upload fails (storage quota, for example), the review still posts.
- **Architecture diagrams only.** archify's `compare` supports the
  `architecture` type today.
- **Pull requests from forks.** GitHub issues fork builds a read-only token, so
  the comment cannot be posted. The review is written to the job summary instead
  and the check still passes.

## Not covered or tested

- **Multiple maps in one repository.** The `map` input takes a glob and each
  match is compared on its own. Covered by tests, but not yet run against a real
  multi-map repository.

## Demo

You can try the whole flow locally from a clone, no GitHub setup needed:

```bash
bash examples/demo-app/try.sh
```

It compares an order-management platform's map against a proposed refactor
(stock reservation extracted into its own service, a Redis cache dropped, a
REST call migrated to gRPC), prints the comment the action would post, and
renders the interactive viewer.
See [`examples/demo-app`](examples/demo-app) for the scenario.

This repository also runs the action on its own PRs, using
[`docs/architecture/self.architecture.json`](docs/architecture/self.architecture.json).

## License

MIT
