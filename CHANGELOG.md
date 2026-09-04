# Changelog

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
