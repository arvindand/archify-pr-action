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
byte-identical receipts and HTML across runs. Semantic regression checks are
separate from renderer-specific HTML hashes.

## The PR comment

```markdown
## Architecture review

### `docs/architecture/self.architecture.json`

**2 added · 0 removed · 0 changed**

| | kind | element | change |
|---|---|---|---|
| + | component | `Vendored archify` | added |
| + | connection | `runner → vendor-cache` (downloads) | added |

_Proof: authored snapshots._

Compared Git revisions: `<base SHA>` → `<checked-out SHA>` (checked-out HEAD).
```

The comment is sticky. Pushing more commits updates it in place rather than
adding a new one. Reverting an architecture change updates the previous review
to say no architecture change is declared. A quiet PR with no previous review
does not get a new comment. `comment: never` disables PR comment API calls; the
job summary still contains the review.

Architecture changes, evidence bindings, layout, presentation, and repository
provenance are reported separately. A formatting or output-path edit reports no
structural change, instead of an all-zero change headline. Each
comparison shows its receipt's proof level and the actual Git commits compared.
Revision-pinned source references do not prove runtime topology or merge safety.

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
         - uses: actions/checkout@v7
         - uses: arvindand/archify-pr-action@v0.3.0
   ```

From then on, a PR that changes the map gets the delta comment. A PR that
changes code under `src/**` without touching the map gets a short note asking
whether the architecture changed. A PR that touches neither gets no comment.

Keep checkout's default PR merge ref. The action compares the event's base
commit with the checked-out commit: with the default checkout, this shows what
merging the PR changes. It reads committed JSON snapshots, so edits made to the
working tree by earlier steps are not attributed to those commits. Checking out
the topic head instead compares two branch tips and may include base-branch
differences; the comment records both SHAs explicitly.

## Upgrading from v0.2.0

The v0.3.0 release uses Archify v3.0.1. Every architecture map now needs a
portable POSIX-relative HTML output path, for example:

```json
"meta": {
  "title": "Runtime architecture",
  "output": "docs/architecture/runtime.html"
}
```

Add `meta.output` to your checked-in maps before upgrading the action. It must
end in `.html` and use `/` separators. Absolute paths, `.` or `..` segments,
backslashes, Windows-reserved names, and trailing dots or spaces are rejected;
see Archify's [portable output-path contract](https://github.com/tt-a1i/archify/blob/v3.0.1/archify/schemas/common.schema.json)
for the complete rules. The action still chooses its own artifact filenames;
the authored output path does not affect the semantic diff.
If only the old base map lacks the field, the check reports that the base does
not validate with the current renderer and skips comparison with diagnostics.
It does not fail a repaired head map or claim a diff was generated.

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
  v3.0.1). A schema mismatch fails loudly with archify's diagnostics instead of
  producing a wrong diff. Advisory update checks are disabled for this pinned
  CI dependency.
- **Runtime.** The action uses Node 24 and current v7 GitHub Actions. Self-hosted
  runners need Actions Runner 2.327.1 or later. Snapshot reads require Git
  2.36+ for [`ls-tree --format`](https://github.com/git/git/blob/v2.36.0/Documentation/RelNotes/2.36.0.txt).
  Local scripts remain compatible with Node 20+, with CI coverage on Node 20,
  22, and 24. Node 24 also remains on
  PATH for later steps in the job; add another setup-node step afterward if
  those steps need a different version.
- **Validation failures fail the check.** If the map doesn't validate, the
  comment carries the diagnostics so the author can fix the named fields.
- **New and deleted maps are handled.** A new map gets a full render attached;
  a deleted map is reported as removed.
- **Rendering failures fail the check.** If a new map validates but cannot be
  rendered, the review shows delivery diagnostics and does not claim a viewer
  exists.
- **Multiple maps.** Output names include a hash of the repository-relative map
  path, so maps with the same filename in different directories have independent
  viewers and receipts.
- **Artifact upload is best-effort.** The comment is the deliverable. If the
  artifact upload fails (storage quota, for example), the review still posts.
- **Architecture diagrams only.** archify's `compare` supports the
  `architecture` type today.
- **Source evidence.** Maps that declare `meta.repository` or component
  `sources` are not supported by this action yet. Repository evidence requires
  an explicit repository root and access to its pinned revisions; this action
  currently reviews authored maps without that evidence.
- **Pull requests from forks.** GitHub issues fork builds a read-only token, so
  the comment cannot be posted. The review is written to the job summary instead
  and the check still passes.

## Demo and regression scenarios

Run the same pipeline used by the action against simulated pull requests:

```bash
bash examples/demo-app/try.sh
```

Or, after downloading the pinned renderer:

```bash
bash scripts/vendor-archify.sh
npm run demo
```

The command prints the path to a browsable HTML report with comments, results,
API-call logs, and interactive architecture viewers. Each run gets a fresh
output directory under `examples/demo-app/out/`. Pass a fresh output directory
with `npm run demo -- /path/to/output` if needed.

Seven scenarios cover formatting/output/title edits, an order-management service
extraction, a reverted change, two maps with the same filename, a rendering
failure and recovery, code changes
without a map update, and an invalid map followed by a repair. Across twelve
review revisions, assertions verify check results, retained artifacts, and
updates to the same comment. These scenarios also run in `npm test` and CI.

The demos use real temporary Git repositories and the pinned Archify CLI.
GitHub comments are simulated in memory; the scenarios do not post anything.
The rendering-failure case deliberately replaces only the `deliver` subprocess
with a failure while using real validation, then retries with the real renderer.
See [`examples/demo-app`](examples/demo-app) for the scenario details.

This repository also runs the action on its own PRs, using
[`docs/architecture/self.architecture.json`](docs/architecture/self.architecture.json).
[PR #1](https://github.com/arvindand/archify-pr-action/pull/1) demonstrates the
original live integration. The new scenarios verify local pipeline and comment
behavior, not live GitHub permissions, artifact upload, or concurrent runs.

## License

MIT
