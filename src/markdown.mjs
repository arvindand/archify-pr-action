export const MARKER = '<!-- archify-pr-action -->';

const SYMBOLS = {
  added: '+', removed: '−', changed: '~',
  moved: '↔', rerouted: '↔', 'geometry-changed': '↔', 'evidence-changed': 'E',
};

const interesting = (list) => (list ?? []).filter((change) => change.status && change.status !== 'unchanged');

function totals(summary, changes) {
  const groups = ['components', 'connections', 'boundaries'];
  const count = (key) => groups.reduce((sum, group) => sum + (summary?.[group]?.[key] ?? 0), 0);
  const entities = groups.flatMap((group) => interesting(changes?.[group]));
  return {
    added: count('added'),
    removed: count('removed'),
    changed: count('changed'),
    evidence: entities.filter((change) => change.status === 'evidence-changed' || change.classifications?.includes('evidence')).length,
    movedOrRerouted: entities.filter((change) => ['moved', 'rerouted', 'geometry-changed'].includes(change.status)
      || change.classifications?.includes('geometry')).length,
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

function diagnostics(lines, map) {
  for (const diagnostic of (map.diagnostics ?? []).slice(0, 10)) {
    const rule = diagnostic.rule ?? diagnostic.code ?? 'error';
    const subject = diagnostic.subject ? ` at \`${JSON.stringify(diagnostic.subject)}\`` : '';
    lines.push(`- \`${rule}\`${subject} ${diagnostic.message ?? ''}`.trimEnd());
  }
}

function mapSection(map, archifyVersion) {
  const lines = [`### \`${map.path}\``, ''];
  if (map.status === 'changed') {
    const t = totals(map.summary, map.changes);
    lines.push(t.added || t.removed || t.changed
      ? `**${t.added} added · ${t.removed} removed · ${t.changed} changed**`
      : '**No structural changes.**', '');
    if (t.evidence) lines.push(`Evidence bindings: ${t.evidence} changed.`, '');
    if (t.movedOrRerouted) lines.push(`Layout: geometry changed on ${t.movedOrRerouted} ${t.movedOrRerouted === 1 ? 'element' : 'elements'}.`, '');
    if (map.summary?.presentationChanged) lines.push('Presentation: changed.', '');
    if (map.summary?.provenanceChanged) {
      lines.push('Repository provenance: changed.', '');
      const fields = (map.provenance?.changedFields ?? []).filter((field) => /^\/[a-z_]+$/i.test(field));
      if (fields.length) lines.push(`Changed provenance fields: ${fields.map((field) => `\`${field}\``).join(', ')}.`, '');
      const revision = (value) => /^[a-f0-9]{40}$/i.test(value ?? '') ? `\`${value}\`` : 'not declared';
      if (map.provenance?.base?.revision || map.provenance?.head?.revision) {
        lines.push(`Evidence revisions: ${revision(map.provenance?.base?.revision)} → ${revision(map.provenance?.head?.revision)}.`, '');
      }
    }
    if (map.base?.semanticSha256 && map.base.semanticSha256 === map.head?.semanticSha256) {
      lines.push('Canonical map content is unchanged (for example, formatting, element order, or `meta.output`).', '');
    }
    const table = changeTable(map.changes);
    if (table) lines.push(table, '');
    if (map.proofLevel === 'authored') lines.push('_Proof: authored snapshots._', '');
    if (map.proofLevel === 'revision-pinned') {
      lines.push('_Proof: revision-pinned source references; authored architecture. This does not verify runtime topology or merge safety._', '');
    }
  } else if (map.status === 'new') {
    lines.push('🆕 New architecture map added.', '');
    if (map.deltaHtml) lines.push('A full render was generated for upload to the workflow artifacts.', '');
  } else if (map.status === 'deleted') {
    lines.push('🗑️ Architecture map removed in this PR.', '');
  } else if (map.status === 'base-invalid') {
    lines.push(`⚠️ The base snapshot does not validate with archify ${archifyVersion}; comparison was skipped. The head snapshot validates.`, '');
    diagnostics(lines, map);
    lines.push('', '_An older map may need migration to this renderer version before it can be compared._', '');
  } else if (map.status === 'invalid' || map.status === 'render-failed' || map.status === 'compare-failed') {
    const message = map.status === 'compare-failed'
      ? '❌ archify could not compare these snapshots. Each validates on its own, but no complete comparison was produced:'
      : map.status === 'render-failed'
        ? '❌ This map validates, but rendering failed. No viewer was produced:'
        : '❌ This map fails archify validation:';
    lines.push(message, '');
    diagnostics(lines, map);
    const comparisonCodes = (map.diagnostics ?? []).map((diagnostic) => diagnostic.code ?? diagnostic.rule ?? '');
    const comparisonFix = comparisonCodes.some((code) => code === 'delta/relationship-id-required')
      ? '_Fix: add a stable `id` to every connection in both snapshots; compare requires IDs even when validate accepts their omission._'
      : comparisonCodes.some((code) => code.startsWith('output/'))
        ? '_Fix: inspect the output diagnostics, check the output paths, and retry when other processes stop changing them._'
        : comparisonCodes.some((code) => code.startsWith('delta/'))
          ? '_Fix: inspect the comparison diagnostics and repair the named fields in the snapshots._'
          : '_Fix: inspect the comparison diagnostics or receipt and the pinned renderer installation; a complete receipt is required._';
    const fix = map.status === 'compare-failed'
      ? comparisonFix
      : map.status === 'render-failed'
        ? '_Fix: inspect the delivery diagnostics and rerun `archify deliver architecture <map> <output.html> --json` using the same quality profile as the action._'
        : '_Fix: ask your agent to run `archify validate architecture <map> --json` and repair the named fields._';
    lines.push('', fix, '');
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
    for (const map of changedMaps) lines.push(...mapSection(map, results.archifyVersion));
  }
  const hasViewer = results.maps.some((map) => map.deltaHtml);
  if (results.baseSha && results.headSha) {
    lines.push(`Compared Git revisions: \`${results.baseSha}\` → \`${results.headSha}\` (checked-out HEAD).`, '');
  }
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
