import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { describe, expect, it } from 'vitest';
import { validateRecord } from '../src/index.js';
import schemaJson from '../src/course.schema.json' with { type: 'json' };
import { eventExportSchema } from '../scripts/event-export-schema.mjs';

const digest = 'a'.repeat(64), at = '2026-10-15T10:00:00Z';
const sample = () => ({
  exportFormat: 1, course: { id: 'pendulum-lab', version: '1.0.0', digest }, enrollmentRef: '3f2b6c1e-8d4a-4c1b-9e7f-0a1b2c3d4e5f', exportedAt: '2026-10-20T10:00:00Z',
  cursor: { after: '0', through: '9223372036854775807' }, events: [
    { eventId: 'e1', sequence: '1', type: 'attempt.submitted', actorKind: 'learner', occurredAt: at, payload: { attemptId: 'att-1' }, traceId: null },
    { eventId: 'e2', sequence: '9007199254740993', type: 'gate.decided', actorKind: 'system', occurredAt: at, payload: { erased: true }, traceId: 'b'.repeat(32) },
  ],
});
const schema = eventExportSchema(schemaJson as never);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
ajv.addFormat('date-time', fullFormats['date-time']); ajv.addFormat('uri', fullFormats.uri);
const validate = ajv.compile(schema);

describe('standalone learning-event export schema (@course-core/sdk/event-export-schema)', () => {
  it('is self-contained: the export definition and exactly the definitions it reaches', () => {
    expect(schema.$ref).toBe('#/$defs/learningEventExport');
    expect(schema.$id).toBe('urn:course-core:schema:learning-event-export:1');
    expect(Object.keys(schema.$defs)).toEqual(['digest', 'eventSequence', 'exportedEvent', 'id', 'learningEventExport', 'opaqueId', 'state', 'version']);
    const refs = JSON.stringify(schema).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const ref of refs) expect(Object.keys(schema.$defs).map(n => `"$ref":"#/$defs/${n}"`)).toContain(ref);
    expect(() => eventExportSchema({ ...schemaJson, $defs: { learningEventExport: { $ref: 'https://example.invalid/x' } } } as never)).toThrow(/Unsupported reference/);
  });
  it('agrees with validateRecord on structure for valid and invalid exports', () => {
    const cases: [string, (v: any) => void][] = [
      ['valid', () => {}], ['numeric sequence', v => { v.events[0].sequence = 1; }], ['leading zero', v => { v.events[0].sequence = '01'; }],
      ['extra field', v => { v.learnerEmail = 'x'; }], ['format 2', v => { v.exportFormat = 2; }], ['missing cursor', v => { delete v.cursor; }],
      ['bad digest', v => { v.course.digest = 'xyz'; }], ['bad time', v => { v.exportedAt = 'yesterday'; }],
    ];
    for (const [name, mutate] of cases) {
      const value = sample(); mutate(value);
      const record = validateRecord('learningEventExport', value);
      expect([name, validate(value)]).toEqual([name, record.valid || record.issues.every(i => i.code !== 'SCHEMA')]);
    }
    expect(validate(sample())).toBe(true);
  });
  it('leaves ordering rules to validateRecord', () => {
    const value = sample(); value.events.reverse();
    expect(validate(value)).toBe(true);
    expect(validateRecord('learningEventExport', value).issues.map(i => i.code)).toEqual(['INVALID_CURSOR']);
  });
  it('is published as its own package export', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.exports['./event-export-schema']).toBe('./dist/learning-event-export.schema.json');
    expect(readFileSync(new URL('../scripts/copy-schema.mjs', import.meta.url), 'utf8')).toContain('learning-event-export.schema.json');
  });
});
