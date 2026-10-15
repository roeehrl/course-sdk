import { describe, expect, it } from 'vitest';
import {
  adminSettingDefaults, adminSettingsSchema, checkAdminSettingChange, courseRoadmap, lintCourse, PLATFORM_CONTRACT, platformContract,
  REQUIRED_ACTIVITY_FIELDS, validateContract, validateCourse,
} from '../src/index.js';
import type { AdminSection, ExtensionManifest } from '../src/index.js';
import { richCourse } from './contracts-fixture.js';

const codes = (result: { valid: boolean; issues: { code: string }[] }) => result.issues.map(i => i.code);

function plugin(): ExtensionManifest {
  return {
    id: 'lab-plugin', version: '2.0.0', platforms: ['web'], execution: 'sandboxed_web', capabilities: ['state.patch', 'observation.emit'],
    entrypoint: 'plugins/lab.js', integrity: `sha256-${'c'.repeat(64)}`, accessibility: { keyboard: true, reducedMotion: true, textAlternative: 'Steps as text.' },
    license: 'Apache-2.0', stateSchema: { type: 'object' }, observationSchema: { type: 'object' },
    resourceBudget: { timeoutMs: 1000, maxMemoryMb: 64, maxStateBytes: 4096, maxEventBytes: 1024, maxEventsPerMinute: 60 },
    stateMigration: { stateVersion: 2, strategy: 'migrate', migratesFrom: [1] },
    tests: [{ id: 'conformance', kind: 'conformance', fixtureRef: 'tests/conformance.json' }, { id: 'state-v1', kind: 'state_migration', fixtureRef: 'tests/state-v1.json' }],
  };
}

describe('extension manifest contract', () => {
  it('accepts state migration, tests and a full budget', () => {
    expect(validateContract('extension', plugin())).toMatchObject({ valid: true });
    const course = richCourse(); course.extensions.push(plugin());
    expect(validateCourse(course).issues).toEqual([]);
  });
  it.each([
    ['a versioned state without a migration', (e: ExtensionManifest) => { e.stateMigration = { stateVersion: 2, strategy: 'none', migratesFrom: [] }; e.tests = e.tests!.slice(0, 1); }, 'STATE_MIGRATION_REQUIRED'],
    ['a migration from a later version', (e: ExtensionManifest) => { e.stateMigration!.migratesFrom = [2]; }, 'STATE_MIGRATION_REQUIRED'],
    ['a migration without source versions', (e: ExtensionManifest) => { e.stateMigration!.migratesFrom = []; }, 'STATE_MIGRATION_REQUIRED'],
    ['versioned state without a state schema', (e: ExtensionManifest) => { delete e.stateSchema; }, 'STATE_MIGRATION_REQUIRED'],
    ['a state-migration test without a migration', (e: ExtensionManifest) => { delete e.stateMigration; }, 'STATE_MIGRATION_REQUIRED'],
    ['a traversing fixture path', (e: ExtensionManifest) => { e.tests![0]!.fixtureRef = '../secrets.json'; }, 'UNSAFE_FIXTURE_REF'],
    ['an absolute fixture path', (e: ExtensionManifest) => { e.tests![0]!.fixtureRef = '/etc/passwd'; }, 'UNSAFE_FIXTURE_REF'],
    ['duplicate test IDs', (e: ExtensionManifest) => { e.tests![1]!.id = 'conformance'; }, 'DUPLICATE_ID'],
    ['a state budget above the 64 KiB ceiling', (e: ExtensionManifest) => { e.resourceBudget!.maxStateBytes = 65537; }, 'SCHEMA'],
    ['an empty test list', (e: ExtensionManifest) => { e.tests = []; }, 'SCHEMA'],
  ] as const)('rejects %s, standalone and in a course', (_name, change, code) => {
    const extension = plugin(); change(extension);
    expect(codes(validateContract('extension', extension))).toContain(code);
    const course = richCourse(); course.extensions.push(extension);
    expect(codes(validateCourse(course))).toContain(code);
  });
  it('keeps the 0.5 minimal budget shape valid', () => {
    const extension = plugin(); extension.resourceBudget = { timeoutMs: 1000, maxMemoryMb: 64 };
    expect(validateContract('extension', extension).valid).toBe(true);
  });
  it('lints observation schemas without the capability and observations without an evaluator', () => {
    const course = richCourse(); const extension = plugin(); extension.capabilities = ['state.patch']; course.extensions.push(extension);
    expect(lintCourse(course).map(f => f.code)).toContain('OBSERVATION_CAPABILITY_UNDECLARED');
    const second = richCourse(); second.extensions.push(plugin());
    expect(lintCourse(second).filter(f => f.path === `/extensions/${second.extensions.length - 1}`).map(f => f.code)).toEqual(['OBSERVATIONS_WITHOUT_EVALUATOR']);
  });
});

describe('platform contract', () => {
  it('names the nine required activity fields from the approved design', () => {
    expect(REQUIRED_ACTIVITY_FIELDS).toEqual(['supportedTargets', 'rendererRefs', 'executionAdapter', 'capabilityRequirements', 'equivalentFallbacks',
      'offlineBehavior', 'resourceBudget', 'accessibleSemantics', 'stateMigration']);
    expect(PLATFORM_CONTRACT.targets).toHaveLength(6);
    expect(PLATFORM_CONTRACT.layoutClasses).toEqual(['compact', 'medium', 'expanded']);
    expect(Object.isFrozen(PLATFORM_CONTRACT) && Object.isFrozen(REQUIRED_ACTIVITY_FIELDS)).toBe(true);
  });
  it('extracts a detached platform contract from an activity', () => {
    const activity = richCourse().activities![0]!;
    const contract = platformContract(activity);
    expect(Object.keys(contract)).toEqual([...REQUIRED_ACTIVITY_FIELDS]);
    expect(contract.equivalentFallbacks).toEqual(activity.equivalentFallbacks);
    contract.supportedTargets.push('android_phone');
    expect(activity.supportedTargets).not.toContain('android_phone');
  });
});

describe('schema-driven admin settings', () => {
  const section = (): AdminSection => structuredClone(richCourse().adminSections![0]!);
  const writer = ['course.read', 'course.settings.write'] as const;
  it('renders a JSON Schema with defaults, bounds and permissions', () => {
    expect(adminSettingsSchema(section())).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Lab settings', type: 'object', additionalProperties: false,
      properties: {
        'max-length': { title: 'Longest pendulum (m)', default: 4, 'x-scope': 'course', 'x-mutationPermission': 'course.settings.write', type: 'number', minimum: 1, maximum: 10 },
        units: { title: 'Units', default: 'metric', 'x-scope': 'course', 'x-mutationPermission': 'course.settings.write', type: 'string', enum: ['metric', 'imperial'] },
      },
    });
    expect(adminSettingDefaults(section())).toEqual({ 'max-length': 4, units: 'metric' });
  });
  it('accepts a permitted, in-range change', () => {
    expect(checkAdminSettingChange(section(), { settingId: 'max-length', value: 7.5, scope: 'course' }, writer)).toEqual([]);
    expect(checkAdminSettingChange(section(), { settingId: 'units', value: 'imperial', scope: 'course' }, writer)).toEqual([]);
  });
  it.each([
    ['an unknown setting', { settingId: 'grading-mode', value: 1, scope: 'course' }, writer, ['UNKNOWN_SETTING']],
    ['a reader without the write permission', { settingId: 'units', value: 'metric', scope: 'course' }, ['course.read'], ['ADMIN_PERMISSION_DENIED']],
    ['a writer without the section read permission', { settingId: 'units', value: 'metric', scope: 'course' }, ['course.settings.write'], ['ADMIN_PERMISSION_DENIED']],
    ['another scope', { settingId: 'units', value: 'metric', scope: 'enrollment' }, writer, ['SETTING_SCOPE_MISMATCH']],
    ['an out-of-range number', { settingId: 'max-length', value: 11, scope: 'course' }, writer, ['INVALID_SETTING_VALUE']],
    ['a non-finite number', { settingId: 'max-length', value: Number.NaN, scope: 'course' }, writer, ['INVALID_SETTING_VALUE']],
    ['a numeric string', { settingId: 'max-length', value: '5', scope: 'course' }, writer, ['INVALID_SETTING_VALUE']],
    ['an undeclared option', { settingId: 'units', value: 'nautical', scope: 'course' }, writer, ['INVALID_SETTING_VALUE']],
  ] as const)('rejects %s', (_name, change, granted, expected) => {
    expect(checkAdminSettingChange(section(), change, granted).map(i => i.code)).toEqual(expected);
  });
  it('checks integer, string and boolean settings', () => {
    const s = section();
    s.settings.push({ id: 'trials', label: 'Trials', scope: 'course', mutationPermission: 'course.settings.write', type: 'integer', default: 3, minimum: 1, maximum: 9 },
      { id: 'note', label: 'Note', scope: 'course', mutationPermission: 'course.settings.write', type: 'string', default: '', maxLength: 5 },
      { id: 'sound', label: 'Sound', scope: 'course', mutationPermission: 'course.settings.write', type: 'boolean', default: true });
    expect(validateContract('adminSection', s).valid).toBe(true);
    const check = (settingId: string, value: unknown) => checkAdminSettingChange(s, { settingId, value, scope: 'course' }, writer).map(i => i.code);
    expect([check('trials', 4), check('trials', 4.5), check('note', 'short'), check('note', 'too long'), check('sound', false), check('sound', 'false')])
      .toEqual([[], ['INVALID_SETTING_VALUE'], [], ['INVALID_SETTING_VALUE'], [], ['INVALID_SETTING_VALUE']]);
  });
});

describe('roadmap stages', () => {
  function staged() {
    const course = richCourse();
    course.stages = [{ id: 'foundations', title: 'Foundations', subtitle: 'Start here', iconAsset: 'asset:icons/start.svg' }, { id: 'practice', title: 'Practice' }];
    const swing = course.chapters[0]!;
    course.chapters.push({ ...structuredClone(swing), id: 'swing-2', title: 'Swing again', stageId: 'practice',
      episodes: swing.episodes.map(e => ({ ...structuredClone(e), id: `${e.id}-2`, gateId: undefined as never, blocks: e.blocks.filter(b => b.type === 'text').map(b => ({ ...b, id: `${b.id}-2` })) })) });
    for (const e of course.chapters[1]!.episodes) delete (e as { gateId?: string }).gateId;
    return course;
  }
  it('accepts stage subtitles and icon assets but not unsafe icon URLs', () => {
    expect(validateContract('stage', { id: 'a', title: 'A', subtitle: 'Sub', iconAsset: 'https://example.com/a.svg' }).valid).toBe(true);
    expect(codes(validateContract('stage', { id: 'a', title: 'A', iconAsset: 'javascript:alert(1)' }))).toEqual(['SCHEMA']);
  });
  it('groups consecutive chapters by stage with author labels', () => {
    const course = staged();
    expect(validateCourse(course).issues).toEqual([]);
    const roadmap = courseRoadmap(course);
    expect(roadmap.chapterLabel).toBe('Unit');
    expect(roadmap.groups.map(g => [g.stage?.id ?? null, g.chapters.map(c => c.id)])).toEqual([['foundations', ['swing']], ['practice', ['swing-2']]]);
    expect(roadmap.groups[0]!.stage).toEqual({ id: 'foundations', title: 'Foundations', subtitle: 'Start here', iconAsset: 'asset:icons/start.svg' });
    expect(roadmap.groups[0]!.chapters[0]).toMatchObject({ subtitle: 'Timing a swing', iconAsset: 'asset:icons/swing.svg', episodeIds: ['timing', 'length'] });
  });
  it('keeps unstaged chapters ungrouped and reports split or unused stages', () => {
    const course = staged();
    course.chapters.push({ ...structuredClone(course.chapters[1]!), id: 'swing-3', stageId: 'foundations',
      episodes: course.chapters[1]!.episodes.map(e => ({ ...structuredClone(e), id: `${e.id}-3`, blocks: e.blocks.map(b => ({ ...b, id: `${b.id}-3` })) })) });
    delete course.chapters[1]!.stageId;
    expect(validateCourse(course).issues).toEqual([]);
    expect(courseRoadmap(course).groups.map(g => g.stage?.id ?? null)).toEqual(['foundations', null, 'foundations']);
    const findings = lintCourse(course).map(f => f.code);
    expect(findings).toEqual(expect.arrayContaining(['STAGE_NOT_CONTIGUOUS', 'UNUSED_STAGE']));
    expect(courseRoadmap({ chapters: course.chapters }).chapterLabel).toBeNull();
  });
});
