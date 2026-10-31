import { buildComment, shouldPost, MARKER } from './markdown.mjs';

export async function upsertComment({ token, repository, prNumber, mode, results, runUrl, isFork = false, expectedHeadSha, fetchImpl = fetch }) {
  // Quiet revisions still need to clear an earlier review. `never` performs no requests.
  if (mode === 'never') return { action: 'skipped' };
  if (isFork) return { action: 'skipped-readonly' };
  const body = buildComment(results, runUrl);
  const [owner, repo] = repository.split('/');
  const api = (route, init = {}) => fetchImpl(`https://api.github.com${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });

  let existing;
  for (let page = 1; ; page++) {
    const listResponse = await api(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    if (!listResponse.ok) {
      throw new Error(`Listing PR comments failed (${listResponse.status}): ${await listResponse.text()} — does the workflow grant "pull-requests: write" permission?`);
    }
    const comments = await listResponse.json();
    existing = comments.find(
      (comment) => typeof comment.body === 'string' && comment.body.startsWith(MARKER),
    );
    if (existing || comments.length < 100) break;
  }
  // Keep untouched PRs quiet, but replace a stale review after a revert or fix.
  if (!existing && !shouldPost(results, mode)) return { action: 'skipped' };

  // Check immediately before writing: an older run must not replace a newer
  // revision's review after spending time comparing or rendering maps.
  if (expectedHeadSha) {
    const pullResponse = await api(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    if (!pullResponse.ok) {
      throw new Error(`Checking current PR head failed (${pullResponse.status}): ${await pullResponse.text()}`);
    }
    const pull = await pullResponse.json();
    if (pull.head.sha !== expectedHeadSha) return { action: 'skipped-stale' };
  }

  const response = existing
    ? await api(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
    : await api(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  if (!response.ok) {
    throw new Error(`Comment ${existing ? 'update' : 'create'} failed (${response.status}): ${await response.text()} — does the workflow grant "pull-requests: write" permission?`);
  }
  return { action: existing ? 'updated' : 'created' };
}
