// Derives the standalone learning-event export schema (`@course-core/sdk/event-export-schema`)
// from src/course.schema.json: the `learningEventExport` definition and every definition it
// references, so the published export format and the record validator cannot drift apart.

/** @param {{ $schema: string, $defs: Record<string, unknown> }} course */
export function eventExportSchema(course) {
  const needed = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        if (!value.startsWith('#/$defs/')) throw new Error(`Unsupported reference ${value}`);
        const name = value.slice('#/$defs/'.length);
        if (!(name in course.$defs)) throw new Error(`Unknown definition ${name}`);
        if (!needed.has(name)) { needed.add(name); visit(course.$defs[name]); }
      } else visit(value);
    }
  };
  visit({ $ref: '#/$defs/learningEventExport' });
  return {
    $schema: course.$schema,
    $id: 'urn:course-core:schema:learning-event-export:1',
    title: 'Portable learning event export (exportFormat 1)',
    description: 'A host-produced export of one enrollment\'s learning events over a cursor range. Sequences are 64-bit-safe decimal strings. '
      + 'Semantic rules (strictly increasing sequences inside the cursor range, unique event IDs) are applied by validateRecord(\'learningEventExport\', ...).',
    $ref: '#/$defs/learningEventExport',
    $defs: Object.fromEntries([...needed].sort().map((name) => [name, course.$defs[name]])),
  };
}
