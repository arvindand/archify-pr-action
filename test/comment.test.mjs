import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertComment } from '../src/comment.mjs';
import { MARKER } from '../src/markdown.mjs';

const quietMap = { path: 'docs/architecture/app.architecture.json', status: 'unchanged', summary: null, changes: null, deltaHtml: null, diagnostics: [] };
const nudgeResults = { archifyVersion: 'v2.15.0', nudge: true, changedCodePaths: ['src/a.js'], maps: [quietMap] };
const quietResults = { archifyVersion: 'v2.15.0', nudge: false, changedCodePaths: [], maps: [quietMap] };

function fakeFetch(existingComments) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (!init.method) return { ok: true, json: async () => existingComments, text: async () => '' };
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
  return { calls, fetchImpl };
}

test('creates a comment when no marker comment exists', async () => {
  const { calls, fetchImpl } = fakeFetch([{ id: 1, body: 'unrelated comment' }]);
  const outcome = await upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'on-change', results: nudgeResults, runUrl: 'https://example.test/run', fetchImpl });
  assert.equal(outcome.action, 'created');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].url, /\/repos\/o\/r\/issues\/5\/comments$/);
  assert.ok(JSON.parse(calls[1].body).body.startsWith(MARKER));
});

test('updates the existing marker comment', async () => {
  const { calls, fetchImpl } = fakeFetch([{ id: 9, body: `${MARKER}\nold body` }]);
  const outcome = await upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'on-change', results: nudgeResults, runUrl: 'https://example.test/run', fetchImpl });
  assert.equal(outcome.action, 'updated');
  assert.equal(calls[1].method, 'PATCH');
  assert.match(calls[1].url, /\/repos\/o\/r\/issues\/comments\/9$/);
});

test('skips when shouldPost says no', async () => {
  const { calls, fetchImpl } = fakeFetch([]);
  const outcome = await upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'on-change', results: quietResults, runUrl: 'https://example.test/run', fetchImpl });
  assert.equal(outcome.action, 'skipped');
  assert.equal(calls.length, 0);
});

test('fork PR: 403 skips quietly instead of failing the check', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'Resource not accessible by integration' });
  const outcome = await upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'always', results: nudgeResults, runUrl: 'u', isFork: true, fetchImpl });
  assert.equal(outcome.action, 'skipped-readonly');
});

test('fork PR: 403 on the write call also skips quietly', async () => {
  const fetchImpl = async (url, init = {}) => (init.method
    ? { ok: false, status: 403, json: async () => ({}), text: async () => 'Resource not accessible by integration' }
    : { ok: true, json: async () => [], text: async () => '' });
  const outcome = await upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'always', results: nudgeResults, runUrl: 'u', isFork: true, fetchImpl });
  assert.equal(outcome.action, 'skipped-readonly');
});

test('non-fork 403 still throws: that is a real misconfiguration', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'Resource not accessible' });
  await assert.rejects(
    upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'always', results: nudgeResults, runUrl: 'u', isFork: false, fetchImpl }),
    /pull-requests: write/,
  );
});

test('throws an actionable error on list failure (missing permission)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'Resource not accessible' });
  await assert.rejects(
    upsertComment({ token: 't', repository: 'o/r', prNumber: 5, mode: 'always', results: quietResults, runUrl: 'u', fetchImpl }),
    /pull-requests: write/,
  );
});
