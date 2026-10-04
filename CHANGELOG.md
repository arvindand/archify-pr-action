# Changelog

## v0.3.0

- Upgrade the pinned Archify renderer from v2.15.0 to v3.0.1. **Migration:**
  add a portable relative `meta.output` HTML path to each architecture map
  before upgrading the action. Base maps rejected by the new renderer are
  reported with version-specific diagnostics; a valid repaired head still
  passes without claiming a comparison was made.
- Report architecture, evidence, layout, presentation, and repository provenance
  changes separately. Formatting and output-path edits no longer produce an
  all-zero change headline. Include the receipt's proof level in comparisons.
- Record the actual compared Git SHAs and read committed snapshots, so dirty
  working-tree edits cannot be attributed to the reported head commit.
- Disable advisory renderer update requests in CI. Split exact receipt/HTML
  determinism checks from the fixture's semantic regression contract.
- Reject incomplete comparison receipts without misreporting map validation.
  Add a demo spanning formatting, output-path, and title edits on one PR.
- Update GitHub Action dependencies to v7 and run the composite action on
  Node 24. Test local scripts on Node 20, 22, and 24; self-hosted runners need
  Actions Runner 2.327.1 or later. Node 24 remains on PATH for subsequent job
  steps, replacing the previous Node 20 setting.
- Show comparison failures separately from map validation failures, including
  actionable stable-ID and output-path diagnostics. Read exact Git blob bytes;
  read errors stop the review rather than make a map look deleted. Snapshot
  reads require Git 2.36 or later.
- Document the authored-map boundary: repository-backed source evidence is not
  supported yet, and revision pinning alone does not prove runtime topology.

## v0.2.0

- Update an existing architecture review when a later revision reverts all map
  changes. Quiet PRs without an existing review remain comment-free.
- Find existing reviews beyond the first 100 PR comments.
- Give equal map filenames in different directories independent output names.
- Fail the check and display diagnostics when a new map validates but fails to
  render. Only mention HTML artifacts when a viewer was actually generated.
- Always write the job summary, including quiet revisions and `comment: never`.
- Add six executable demo scenarios spanning nine review revisions, using real
  Git histories and the pinned renderer, with simulated GitHub comment calls.
