# Demo: architecture review across PR revisions

This is a simulated order-management platform, not a running application. Its
maps describe a storefront, gateway, order and inventory services, Redis, Kafka,
fulfillment, and an external warehouse. The proposed refactor extracts stock
reservation, removes the cache, adds an outbox, and changes the inventory call
to gRPC.

## Run

```bash
bash examples/demo-app/try.sh
```

The script downloads the action's pinned Archify dependency if necessary, then
prints the path to an HTML report. Open that file to see each revision's comment,
check result, JSON output, simulated GitHub calls, and architecture viewers.
Each run uses a fresh directory under `examples/demo-app/out/`.

With the dependency already available, `npm run demo` runs the same scenarios.
`npm run demo -- /path/to/fresh-output` chooses the output directory. Node 20+ and
Git are required; curl and tar are needed for the initial dependency download.

## What is exercised

| Scenario | Revisions and expected behavior |
|---|---|
| Service extraction | Real comparison of baseline and proposed maps; a passing check, change comment, and interactive viewer |
| Reverted change | Refactor, then revert; one comment is created and subsequently updated to show no declared change |
| Same filename | Two nested `runtime.architecture.json` maps change independently; both viewers and receipts survive |
| Rendering failure | Real validation succeeds, injected delivery failure fails the check and displays diagnostics; retry with the real renderer passes and updates the comment |
| Code only | A simulated source file changes while its map stays unchanged; the action asks whether architecture changed |
| Invalid, then repaired | Invalid JSON structure fails validation; a corrected revision passes and updates the same comment |

These six scenarios exercise nine review revisions and are also regression tests
run by `npm test`. A scenario passes only when its assertions succeed; an expected
failing check is part of the rendering and invalid-map scenarios.

The runner creates temporary Git histories, invokes `src/compare.mjs`, and
passes the actual results to `upsertComment`. GitHub GET/POST/PATCH calls go to
an in-memory simulation, preserving comment state across revisions. It cleans
up the temporary repositories and retains the report artifacts.

The rendering-failure case is controlled fault injection, not a claim that the
provided valid map breaks upstream Archify. Validation and the recovery run use
the pinned renderer unchanged.

## Verification boundary

This validates the local comparison pipeline, rendering, diagnostics, artifact
naming, and sequential comment updates. It does not validate live GitHub API
permissions, uploads, or races between concurrent workflow runs. The source
file is only a watched-path fixture; no service is executed or inferred from it.

For the original live GitHub integration, see
[PR #1](https://github.com/arvindand/archify-pr-action/pull/1).
