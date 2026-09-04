import { buildComment, shouldPost, MARKER } from './markdown.mjs';

export async function upsertComment({ token, repository, prNumber, mode, results, runUrl, isFork = false, fetchImpl = fetch }) {
  // Quiet revisions still need to clear an earlier review. `never` performs no requests.
  if (mode === 'never') return { action: 'skipped' };
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
      if (listResponse.status === 403 && isFork) return { action: 'skipped-readonly' };
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

  const response = existing
    ? await api(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
    : await api(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  if (!response.ok) {
    if (response.status === 403 && isFork) return { action: 'skipped-readonly' };
    throw new Error(`Comment ${existing ? 'update' : 'create'} failed (${response.status}): ${await response.text()} — does the workflow grant "pull-requests: write" permission?`);
  }
  return { action: existing ? 'updated' : 'created' };
}
