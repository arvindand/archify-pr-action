export const MARKER = '<!-- archify-pr-action -->';

const SYMBOLS = {
  added: '+', removed: '−', changed: '~',
  moved: '↔', rerouted: '↔', geometryChanged: '↔', evidenceChanged: 'E',
};

const interesting = (list) => (list ?? []).filter((change) => change.status && change.status !== 'unchanged');

function totals(summary) {
  const groups = ['components', 'connections', 'boundaries'];
  const count = (key) => groups.reduce((sum, group) => sum + (summary?.[group]?.[key] ?? 0), 0);
  return {
    added: count('added'),
    removed: count('removed'),
    changed: count('changed') + count('evidenceChanged'),
    movedOrRerouted: count('moved') + count('rerouted') + count('geometryChanged'),
  };
}

function changeTable(changes) {
  const rows = [];
  for (const change of interesting(changes?.components)) {
    const detail = change.changedFields?.length
      ? `${change.status}: ${change.changedFields.join(', ')}`
      : change.status;
    rows.push(`| ${SYMBOLS[change.status] ?? '~'} | component | \`${change.headLabel ?? change.baseLabel ?? change.id}\` | ${detail} |`);
  }
  for (const change of interesting(changes?.connections)) {
    const endpoints = change.head ?? change.base ?? {};
    const label = endpoints.label ? ` (${endpoints.label})` : '';
    const route = `\`${endpoints.from} → ${endpoints.to}\``;
    // A rewired connection keeps its id, so show both routes or the change is invisible.
    const rewired = change.base && change.head
      && (change.base.from !== change.head.from || change.base.to !== change.head.to);
    const element = rewired
      ? `~~\`${change.base.from} → ${change.base.to}\`~~ → ${route}${label}`
      : `${route}${label}`;
    rows.push(`| ${SYMBOLS[change.status] ?? '~'} | connection | ${element} | ${change.status} |`);
  }
  for (const boundary of interesting(changes?.boundaries)) {
    rows.push(`| ${SYMBOLS[boundary.status] ?? '~'} | boundary | \`${boundary.label}\` (${boundary.kind}) | ${boundary.status} |`);
  }
  if (!rows.length) return '';
  return ['| | kind | element | change |', '|---|---|---|---|', ...rows].join('\n');
}

function mapSection(map) {
  const lines = [`### \`${map.path}\``, ''];
  if (map.status === 'changed') {
    const t = totals(map.summary);
    lines.push(`**${t.added} added · ${t.removed} removed · ${t.changed} changed · ${t.movedOrRerouted} moved/rerouted**`, '');
    const table = changeTable(map.changes);
    if (table) lines.push(table, '');
  } else if (map.status === 'new') {
    lines.push('🆕 New architecture map added.', '');
    if (map.deltaHtml) lines.push('A full render was generated for upload to the workflow artifacts.', '');
  } else if (map.status === 'deleted') {
    lines.push('🗑️ Architecture map removed in this PR.', '');
  } else if (map.status === 'base-invalid') {
    lines.push('⚠️ The base version of this map does not validate (pre-existing issue); comparison was skipped. The head version validates.', '');
  } else if (map.status === 'invalid' || map.status === 'render-failed') {
    lines.push(map.status === 'render-failed'
      ? '❌ This map validates, but rendering failed. No viewer was produced:'
      : '❌ This map fails archify validation:', '');
    for (const diagnostic of (map.diagnostics ?? []).slice(0, 10)) {
      const rule = diagnostic.rule ?? diagnostic.code ?? 'error';
      const subject = diagnostic.subject ? ` at \`${JSON.stringify(diagnostic.subject)}\`` : '';
      lines.push(`- \`${rule}\`${subject} ${diagnostic.message ?? ''}`.trimEnd());
    }
    lines.push('', map.status === 'render-failed'
      ? '_Fix: inspect the delivery diagnostics and rerun `archify deliver architecture <map> <output.html> --json` using the same quality profile as the action._'
      : '_Fix: ask your agent to run `archify validate architecture <map> --json` and repair the named fields._', '');
  }
  return lines;
}

export function buildComment(results, runUrl) {
  const lines = [MARKER, '## Architecture review', ''];
  const changedMaps = results.maps.filter((map) => map.status !== 'unchanged');
  if (!changedMaps.length) {
    lines.push('No architecture change declared in this PR.', '');
    if (results.nudge) {
      lines.push(`> ⚠️ This PR changes ${results.changedCodePaths.length} file(s) under watched code paths but no architecture map was updated. Does the architecture change? If so, update the map in this PR; if not, ignore this note.`, '');
    }
  } else {
    for (const map of changedMaps) lines.push(...mapSection(map));
  }
  const hasViewer = results.maps.some((map) => map.deltaHtml);
  lines.push('---', hasViewer
    ? `_archify ${results.archifyVersion} · generated HTML viewers: [workflow artifacts](${runUrl}) (if upload succeeded)_`
    : `_archify ${results.archifyVersion} · [workflow run](${runUrl})_`);
  return lines.join('\n');
}

export function shouldPost(results, mode) {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return results.nudge || results.maps.some((map) => map.status !== 'unchanged');
}
