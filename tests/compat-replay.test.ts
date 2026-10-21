import { describe, expect, it } from 'vitest';
import { compareSemver, compatibilityReport, renderPreviewPage, replayGateDecisions, DEFAULT_MINIMUM_CORE_VERSION } from '../src/compiler.js';
import type { DevBuild, HostInventory, VisualsRenderer } from '../src/compiler.js';
import { conformanceReport } from '../src/compiler.js';
import { compileCourse } from '../src/compiler.js';
import { courseTextKeys, decideGate, lintCourse, SDK_VERSION } from '../src/index.js';
import type { CourseManifest, Evidence, VisualExperience } from '../src/index.js';
import { richCourse } from './contracts-fixture.js';

/** A host that has everything richCourse needs. */
function host(): HostInventory {
  return {
    hostInventoryFormat: 1, coreVersion: '0.1.50', sdk: { version: '0.6.0', supported: { min: '0.5.0', maxExclusive: '0.7.0' } },
    renderers: [{ rendererId: 'sim-plugin', version: '1.0.0', features: ['gradient', 'path_draw'] }],
    platformAdapters: (richCourse().platformAdapters ?? []).map(a => ({ id: a.id, version: a.version, target: a.target })),
    extensions: richCourse().extensions.map(e => ({ id: e.id, version: e.version, integrity: e.integrity })),
    capabilities: ['state.patch', 'observation.emit', 'teaching.generate', 'teaching.verify', 'assessment.evaluate', 'state.read', 'media.play', 'artifact.read', 'artifact.write', 'research.search'],
  };
}

describe('compatibility report', () => {
  it('orders semantic versions, including pre-releases', () => {
    expect(['0.10.0', '0.2.0', '0.2.0-rc.2', '0.2.0-rc.10', '1.0.0'].sort(compareSemver)).toEqual(['0.2.0-rc.2', '0.2.0-rc.10', '0.2.0', '0.10.0', '1.0.0']);
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(RangeError);
  });

  it('is compatible with a host that has every renderer, extension, adapter and capability', () => {
    const report = compatibilityReport(richCourse(), { host: host() });
    expect(report.problems).toEqual([]);
    expect(report).toMatchObject({ status: 'compatible', sdk: { version: SDK_VERSION, status: 'supported' }, core: { minimumVersion: DEFAULT_MINIMUM_CORE_VERSION, status: 'satisfied' } });
    expect(new Set(report.adapters.map(a => a.kind))).toEqual(new Set(['renderer', 'extension', 'platform_adapter', 'capability']));
    expect(report.adapters.every(a => a.status === 'satisfied')).toBe(true);
  });

  it('is unknown without a host inventory, but still lists what the course needs', () => {
    const report = compatibilityReport(richCourse());
    expect(report.status).toBe('unknown');
    expect(report.adapters.every(a => a.status === 'unknown')).toBe(true);
    expect(report.adapters.find(a => a.kind === 'renderer')).toMatchObject({ id: 'sim-plugin', requiredBy: ['visual:swing-visual'], required: { version: '1.0.0' } });
  });

  it.each([
    ['an old Core', (h: HostInventory) => { h.coreVersion = '0.1.0'; }, 'CORE_VERSION_TOO_OLD', 'blocking'],
    ['a host on another SDK major whose range ends below this SDK', (h: HostInventory) => { h.sdk = { version: '1.2.0', supported: { min: '0.1.0', maxExclusive: '0.5.0' } }; }, 'SDK_UNSUPPORTED', 'blocking'],
    ['a host that accepts only newer SDKs', (h: HostInventory) => { h.sdk = { version: '1.2.0', supported: { min: '1.0.0', maxExclusive: '1.3.0' } }; }, 'SDK_OLDER_THAN_CORE', 'warning'],
    ['a host one SDK minor behind', (h: HostInventory) => { h.sdk = { version: '0.6.0', supported: { min: '0.5.0', maxExclusive: '0.6.0' } }; }, 'SDK_NEWER_THAN_CORE', 'warning'],
    ['a missing extension', (h: HostInventory) => { h.extensions!.pop(); }, 'EXTENSION_MISSING', 'blocking'],
    ['an extension with different code', (h: HostInventory) => { h.extensions![0]!.integrity = `sha256-${'b'.repeat(64)}`; }, 'EXTENSION_VERSION_MISMATCH', 'blocking'],
    ['a missing platform adapter', (h: HostInventory) => { h.platformAdapters = []; }, 'PLATFORM_ADAPTER_MISSING', 'blocking'],
    ['a capability the host cannot grant', (h: HostInventory) => { h.capabilities = h.capabilities!.filter(c => c !== 'state.patch'); }, 'CAPABILITY_MISSING', 'blocking'],
    ['no renderer for a visual', (h: HostInventory) => { h.renderers = []; }, 'RENDERER_MISSING', 'blocking'],
    ['an older renderer version', (h: HostInventory) => { h.renderers![0]!.version = '0.9.0'; }, 'RENDERER_VERSION_MISMATCH', 'blocking'],
  ])('reports %s', (_name, change, code, severity) => {
    const h = host(); change(h);
    const report = compatibilityReport(richCourse(), { host: h });
    expect(report.problems).toContainEqual(expect.objectContaining({ code, severity }));
    expect(report.status).toBe(severity === 'blocking' ? 'incompatible' : 'compatible');
  });

  it('checks render features and the host SDK a 0.6 course needs', () => {
    const course = richCourse();
    course.visuals[0]!.requiredFeatures = ['gradient', 'layout_set'];
    const old = host(); old.sdk = { version: '0.5.0', supported: { min: '0.5.0', maxExclusive: '0.7.0' } };
    const report = compatibilityReport(course, { host: old });
    expect(report.sdk).toMatchObject({ requiresHostSdk: '0.6.0', reasons: ['render features layout_set'] });
    expect(report.problems.map(p => p.code)).toEqual(expect.arrayContaining(['HOST_SDK_TOO_OLD', 'RENDERER_FEATURE_MISSING']));
  });

  it('checks a locally installed renderer when there is no host, as warnings only', () => {
    const local = [{ rendererId: 'sim-plugin', version: '0.9.0', features: ['gradient'], source: 'test' }];
    const report = compatibilityReport(richCourse(), { localRenderers: local });
    expect(report.adapters.find(a => a.kind === 'renderer')).toMatchObject({ status: 'version_mismatch', installed: { source: 'local', version: '0.9.0' } });
    expect(report.problems).toEqual([expect.objectContaining({ code: 'RENDERER_VERSION_MISMATCH', severity: 'warning' })]);
    expect(report.status).toBe('unknown');
  });

  it.each([
    ['a missing format', { coreVersion: '0.1.0' }, '/host'],
    ['a non-semver Core version', { hostInventoryFormat: 1, coreVersion: 'latest' }, '/host/coreVersion'],
    ['a malformed renderer', { hostInventoryFormat: 1, coreVersion: '0.1.0', renderers: [{ rendererId: 'x' }] }, '/host/renderers/0'],
    ['a malformed SDK range', { hostInventoryFormat: 1, coreVersion: '0.1.0', sdk: { version: '0.6.0', supported: { min: 'x' } } }, '/host/sdk/supported'],
  ])('rejects a host inventory with %s', (_name, inventory, path) => {
    const report = compatibilityReport(richCourse(), { host: inventory });
    expect(report.status).toBe('incompatible');
    expect(report.issues.map(i => i.path)).toContain(path);
  });

  it('reports an invalid course and minimum Core version as issues', () => {
    expect(compatibilityReport({}).issues[0]!.path).toMatch(/^\/course/);
    expect(compatibilityReport(richCourse(), { minimumCoreVersion: 'soon' }).issues.map(i => i.code)).toContain('INVALID_VERSION');
  });
});

describe('gate decision replay', () => {
  const digest = 'a'.repeat(64);
  const context = { decisionId: 'd-1', enrollmentId: 'enr-1', courseDigest: digest, policyRevision: 1, decidedAt: '2026-10-15T12:00:00Z' };
  const ev = (n: number, assessmentId: string, familyId: string): Evidence => ({ id: `ev-${n}`, attemptId: `att-${n}`, enrollmentId: 'enr-1', courseDigest: digest, assessmentId, familyId,
    objectiveIds: ['predict-period'], mode: 'deterministic_check', outcome: 'correct', independence: 'independent', author: 'learner',
    assistance: { hintsUsed: 0, answerRevealed: false, tutorAuthoredContent: false }, reattemptOf: null, misconceptionIds: [], confidence: null,
    evaluator: { id: 'deterministic', version: '1.0.0' }, issuedAt: `2026-10-15T10:0${n}:00Z` });
  const recorded = () => {
    const evidence = [ev(1, 'length-choice', 'length-recognize'), ev(2, 'length-prediction', 'length-predict')];
    const result = decideGate(richCourse(), 'length-ready', evidence, context);
    if (!result.valid) throw new Error('fixture');
    return { gateReplayFormat: 1, decisions: [{ gateId: 'length-ready', evidence, context, decision: result.decision }] };
  };

  it('reproduces recorded decisions exactly against the same course', () => {
    const report = replayGateDecisions(richCourse(), recorded());
    expect(report).toMatchObject({ status: 'reproduced', summary: { decisions: 1, reproduced: 1 } });
    expect(report.decisions[0]).toMatchObject({ decisionId: 'd-1', recorded: { status: 'ready' }, replayed: { status: 'ready' }, changedFields: [] });
  });

  it('shows which fields change after the course is edited', () => {
    const edited = richCourse();
    const gate = edited.gates.find(g => g.id === 'length-ready') as { minimumIndependentEvidence: { families: number } };
    gate.minimumIndependentEvidence.families = 3;
    const report = replayGateDecisions(edited, recorded());
    expect(report.status).toBe('changed');
    expect(report.decisions[0]!.replayed!.status).not.toBe('ready');
    expect(report.decisions[0]!.changedFields).toEqual(expect.arrayContaining(['status', 'criterionResults']));
  });

  it('reports a tampered recording as changed and malformed entries as invalid', () => {
    const tampered = recorded(); tampered.decisions[0]!.decision.status = 'needs_evidence';
    expect(replayGateDecisions(richCourse(), tampered).decisions[0]!.changedFields).toContain('status');
    expect(replayGateDecisions(richCourse(), { decisions: [] }).issues[0]!.code).toBe('INVALID_REPLAY');
    expect(replayGateDecisions(richCourse(), { gateReplayFormat: 1, decisions: [] }).status).toBe('invalid');
    const unknownGate = recorded(); unknownGate.decisions[0]!.gateId = 'nope';
    expect(replayGateDecisions(richCourse(), unknownGate).decisions[0]).toMatchObject({ status: 'invalid', issues: [{ code: 'MISSING_REFERENCE' }] });
    const wrongEnrollment = recorded(); wrongEnrollment.decisions[0]!.evidence[0]!.enrollmentId = 'enr-2';
    expect(replayGateDecisions(richCourse(), wrongEnrollment).decisions[0]!.issues.map(i => i.code)).toContain('EVIDENCE_BINDING');
  });
});

describe('preview page', () => {
  const withVisualBlock = (course: CourseManifest) => {
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'swing-diagram', type: 'visual', visualId: 'swing-visual' });
    return course;
  };
  const build = (course: CourseManifest): DevBuild => ({ revision: 3, ok: true, loadError: null, logs: '', course, issues: [], findings: lintCourse(course),
    conformance: conformanceReport(course), compatibility: compatibilityReport(course), compiled: compileCourse(course) });
  const renderer: VisualsRenderer = { rendererId: 'sim-plugin', version: '1.0.0', features: [], source: 'fake-visuals@1.0.0', directory: '/', stylesheet: null,
    render: (visual: VisualExperience, prefix: string) => visual.id === 'swing-visual' ? { svg: `<svg id="${prefix}-ok" role="img"></svg>` } : { error: 'no' } };

  it('escapes course text and embeds only renderer SVG', () => {
    const course = withVisualBlock(richCourse());
    course.title = '<script>alert(1)</script>';
    course.chapters[0]!.episodes[0]!.blocks[0] = { id: 'timing-text', type: 'text', markdown: '<img src=x onerror=alert(1)>' };
    const page = renderPreviewPage(build(course), { renderer });
    expect(page).not.toContain('<script>alert');
    expect(page).not.toContain('<img');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).toContain('<script src="/reload.js" defer></script>');
    expect(page).toContain('<svg id="v0-ok" role="img"></svg>');
    expect(page).toContain('data-revision="3"');
  });

  it('shows the text alternative when no renderer is installed, and problems when the course does not build', () => {
    expect(renderPreviewPage(build(withVisualBlock(richCourse())), { rendererNote: 'install it' })).toContain('sim-plugin is not available in this preview (install it)');
    const failed: DevBuild = { revision: 1, ok: false, loadError: 'Unexpected token } in JSON', logs: 'module said hi', course: null,
      issues: [{ code: 'MISSING_REFERENCE', path: '/chapters/0', message: 'Unknown <objective>.' }], findings: [], conformance: null, compatibility: null, compiled: null };
    const page = renderPreviewPage(failed);
    expect(page).toContain('The course does not build yet.');
    expect(page).toContain('Unexpected token } in JSON');
    expect(page).toContain('Unknown &lt;objective&gt;.');
    expect(page).toContain('module said hi');
  });

  it('switches locale and direction for multi-locale courses', () => {
    const course = richCourse();
    course.locales = ['he'];
    course.translations = { he: { texts: { 'course#title': 'מטוטלת' }, fallback: [...courseTextKeys(course).keys()].filter(key => key !== 'course#title') } };
    const page = renderPreviewPage(build(course), { locale: 'he' });
    expect(page).toContain('<div lang="he" dir="rtl">');
    expect(page).toContain('<h1>מטוטלת</h1>');
    expect(page).toContain('<a href="/?locale=en">en</a>');
    expect(page).toMatch(/text\(s\) are shown in en because he has no translation/);
  });
});
