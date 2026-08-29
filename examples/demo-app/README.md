# Demo: order management

A small order-management platform for trying archify-pr-action locally, without
setting up the action in a repository first.

`docs/architecture/orders.architecture.json` is the committed architecture map:
a storefront behind Spring Cloud Gateway, an Order Service that checks stock
against the Inventory Service and a Redis availability cache, Kafka carrying
`OrderPlaced` events to a fulfillment worker, and a nightly-ish stock sync to
an external warehouse system.

## Try it

From a clone of this repository:

```bash
bash examples/demo-app/try.sh
```

The script plays the role of the action on a pretend PR. The proposed change
lives in [`proposed/orders.architecture.json`](proposed/orders.architecture.json)
and is the kind of refactor most teams will recognize: stock reservation is
extracted into its own service, the Redis availability cache is dropped, the
Order Service adopts an outbox, and the inventory call migrates from REST to
gRPC. The warehouse sync moves from the Inventory Service to the new
reservation service, and both boundaries pick it up.

You get both halves of what the action produces:

- the sticky comment, printed to the terminal, with the exact added / removed /
  changed / moved / rerouted facts
- the interactive Before/Delta/After viewer at `examples/demo-app/out/delta.html`,
  which is worth opening in a browser: it highlights each change and lets you
  trace routes through both versions

Run it twice and diff the receipts if you want to check the determinism claim.

## The real thing

This repository runs the action on its own PRs. See
[PR #1](https://github.com/arvindand/archify-pr-action/pull/1) for an actual
comment posted by the action, and the [main README](../../README.md) for
setting it up in your own repository.

To evolve this demo's map, ask any agent with the
[archify skill](https://github.com/tt-a1i/archify) to update it, then commit
the JSON in the same PR as the architecture change.
