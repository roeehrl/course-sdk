import { createHash } from 'node:crypto';
import { canonicalJson } from './json.js';
import { compileCourse, verifyCompiledCourse, SERVER_ONLY_SECTIONS, type CompiledCourse } from './compiler.js';
import { validateCourse } from './validate.js';
import { lintCourse, type LintFinding } from './lint.js';
import { isVersionedGate } from './contracts-validate.js';
import { DETERMINISTIC_TYPES, PRACTICAL_TYPES, targetsForPlatforms } from './contract-constants.js';
import { SDK_VERSION } from './version.js';
import type { CourseManifest, ValidationIssue } from './types.js';
import type { AdaptationPolicy, ReadinessCriterion, VersionedProgressionGate } from './contracts-types.js';

const SDK_NAME = '@course-core/sdk';
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

// ------------------------------------------------------------------ licence and capability inventories

export interface LicenseInventory {
  inventoryFormat: 1;
  sources: { id: string; title: string; url: string; license: string | null; reviewedAt: string }[];
  media: { id: string; type: string; url: string; sourceRef: string; license: string | null; generated: boolean; review: string }[];
  extensions: { id: string; version: string; integrity: string; license: string | null }[];
  sceneAssets: { sceneId: string; assetId: string; url: string; license: string | null; sourceRef: string | null }[];
  undeclared: string[];
}
export function licenseInventory(course: CourseManifest): LicenseInventory {
  const sources = new Map(course.sources.map(s => [s.id, s]));
  const inventory: LicenseInventory = {
    inventoryFormat: 1,
    sources: byId(course.sources).map(s => ({ id: s.id, title: s.title, url: s.url, license: s.license ?? null, reviewedAt: s.reviewedAt })),
    media: byId(course.media).map(m => ({ id: m.id, type: m.type, url: m.url, sourceRef: m.sourceRef, license: sources.get(m.sourceRef)?.license ?? null, generated: m.generated, review: m.review })),
    extensions: byId(course.extensions).map(e => ({ id: e.id, version: e.version, integrity: e.integrity, license: e.license ?? null })),
    sceneAssets: byId(course.scenes ?? []).flatMap(scene => byId(scene.assets).map(a => ({
      sceneId: scene.id, assetId: a.id, url: a.url, license: a.license ?? (a.sourceRef ? sources.get(a.sourceRef)?.license ?? null : null), sourceRef: a.sourceRef ?? null }))),
    undeclared: [],
  };
  inventory.undeclared = [
    ...inventory.sources.filter(s => !s.license).map(s => `source:${s.id}`),
    ...inventory.media.filter(m => !m.license).map(m => `media:${m.id}`),
    ...inventory.extensions.filter(e => !e.license).map(e => `extension:${e.id}`),
    ...inventory.sceneAssets.filter(a => !a.license).map(a => `scene-asset:${a.sceneId}/${a.assetId}`),
  ].sort();
  return inventory;
}

export interface CapabilityReport {
  capabilitiesFormat: 1;
  platforms: string[];
  targets: string[];
  capabilities: { capability: string; required: boolean; requestedBy: string[] }[];
  executionAdapters: string[];
  nativeModules: string[];
  evaluators: string[];
}
export function requiredCapabilities(course: CourseManifest): CapabilityReport {
  const caps = new Map<string, { required: boolean; requestedBy: Set<string> }>();
  const add = (capability: string, required: boolean, by: string) => {
    const entry = caps.get(capability) ?? { required: false, requestedBy: new Set<string>() };
    entry.required ||= required; entry.requestedBy.add(by); caps.set(capability, entry);
  };
  for (const e of course.extensions) for (const c of e.capabilities) add(c, true, `extension:${e.id}`);
  for (const a of course.activities ?? []) for (const c of a.capabilityRequirements) add(c.capability, c.required, `activity:${a.id}`);
  for (const t of course.tools ?? []) for (const c of t.capabilities) add(c, true, `tool:${t.id}`);
  const adapters = new Set<string>([...course.extensions.map(e => e.execution), ...(course.activities ?? []).map(a => a.executionAdapter)]);
  return {
    capabilitiesFormat: 1,
    platforms: [...course.platforms].sort(),
    targets: targetsForPlatforms(course.platforms).sort(),
    capabilities: [...caps].sort(([a], [b]) => a.localeCompare(b)).map(([capability, v]) => ({ capability, required: v.required, requestedBy: [...v.requestedBy].sort() })),
    executionAdapters: [...adapters].sort(),
    nativeModules: (course.platformAdapters ?? []).filter(a => a.kind === 'native_module').map(a => a.id).sort(),
    evaluators: [...(course.evaluators ?? []).map(e => `${e.id}@${e.version}`), ...course.extensions.filter(e => e.capabilities.includes('assessment.evaluate')).map(e => `extension:${e.id}@${e.version}`)].sort(),
  };
}

// ------------------------------------------------------------------ conformance

export type CheckStatus = 'passed' | 'warning' | 'failed';
export interface ConformanceReport {
  conformanceFormat: 1;
  sdkVersion: string;
  course: { id: string; version: string } | null;
  compiledDigest: string | null;
  status: 'passed' | 'passed_with_warnings' | 'failed';
  checks: { id: string; status: CheckStatus; detail: string }[];
  findings: LintFinding[];
}
const LEAK_MARKERS = ['"grading"', '"correctOptionId"', '"absoluteTolerance"', '"rubricId"', '"evaluatorRef"', '"interactiveCheckRefs"', '"practicalTaskRefs"', '"conversationalRubricRef"'];

/** Deterministic, offline conformance suite used by `course test` and embedded in bundles. */
export function conformanceReport(input: unknown): ConformanceReport {
  const checks: ConformanceReport['checks'] = [];
  const add = (id: string, status: CheckStatus, detail: string) => checks.push({ id, status, detail });
  const validation = validateCourse(input);
  const findings = lintCourse(input);
  if (!validation.valid) {
    add('schema-and-references', 'failed', `${validation.issues.length} validation issue(s).`);
    return { conformanceFormat: 1, sdkVersion: SDK_VERSION, course: null, compiledDigest: null, status: 'failed', checks, findings };
  }
  const course = validation.course;
  add('schema-and-references', 'passed', 'Schema, references, cycles and contract rules hold.');
  const compiled = compileCourse(course);
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(course).reverse())));
  const again = compileCourse(reordered);
  add('deterministic-compile', compiled.digest === again.digest && canonicalJson(compiled) === canonicalJson(again) ? 'passed' : 'failed', 'Compilation is independent of key order and repeatable.');
  add('compiled-verifies', verifyCompiledCourse(compiled) ? 'passed' : 'failed', 'The compiled artifact verifies.');
  const learner = JSON.stringify(compiled.learner);
  const leaks = [...LEAK_MARKERS.filter(m => learner.includes(m)), ...SERVER_ONLY_SECTIONS.filter(s => s in compiled.learner),
    ...course.assessments.filter(a => learner.includes(JSON.stringify(a.prompt))).map(a => `prompt:${a.id}`),
    ...(course.retention?.assessmentIds ?? []).filter(id => compiled.learner.assessments.some(a => a.id === id)).map(id => `held-out:${id}`)];
  add('learner-projection-private', leaks.length ? 'failed' : 'passed', leaks.length ? `Learner projection exposes ${leaks.join(', ')}.` : 'No keys, prompts, rubrics or server sections reach learners.');
  const legacy = course.gates.filter(g => !isVersionedGate(g)).map(g => g.id);
  add('gates-require-transfer', legacy.length ? 'warning' : 'passed', legacy.length ? `Unversioned gates cannot require transfer: ${legacy.join(', ')}.` : 'Every gate requires independent transfer evidence.');
  const legacyBlocks = findings.filter(f => f.code === 'LEGACY_ACTIVITY_BLOCK').length;
  add('activity-platform-contracts', legacyBlocks ? 'warning' : 'passed', legacyBlocks ? `${legacyBlocks} activity block(s) lack platform contracts.` : 'Activities declare targets, fallbacks and budgets.');
  const undeclared = licenseInventory(course).undeclared;
  add('license-inventory', undeclared.length ? 'warning' : 'passed', undeclared.length ? `Undeclared licences: ${undeclared.join(', ')}.` : 'Every source, extension and asset declares a licence.');
  const warnings = findings.filter(f => f.severity === 'warning').length;
  add('lint', warnings ? 'warning' : 'passed', `${warnings} warning(s), ${findings.length - warnings} note(s).`);
  const status = checks.some(c => c.status === 'failed') ? 'failed' : checks.some(c => c.status === 'warning') ? 'passed_with_warnings' : 'passed';
  return { conformanceFormat: 1, sdkVersion: SDK_VERSION, course: { id: course.id, version: course.version }, compiledDigest: compiled.digest, status, checks, findings };
}

// ------------------------------------------------------------------ bundle

export const BUNDLE_FILES = Object.freeze(['capabilities.json', 'conformance.json', 'course.compiled.json', 'integrity.json', 'licenses.json', 'manifest.json']);
export interface BundleManifest {
  bundleFormat: 1;
  sdk: { name: string; version: string };
  course: { id: string; version: string; schemaVersion: 1; title: string; locale: string; platforms: string[] };
  compiledDigest: string;
  contents: string[];
}
export class CourseBundleError extends Error {
  constructor(public readonly issues: ValidationIssue[]) { super(`Course bundle failed with ${issues.length} issue(s).`); this.name = 'CourseBundleError'; }
}

/**
 * Build a deterministic bundle: manifest, compiled course (identical to `compile`), licence
 * inventory, required capabilities, conformance report and a SHA-256 integrity map. The
 * map proves integrity of the files, not authorship or trust.
 */
export function packCourse(input: unknown): Record<string, string> {
  const report = conformanceReport(input);
  if (report.status === 'failed') {
    const validation = validateCourse(input);
    throw new CourseBundleError(validation.valid ? report.checks.filter(c => c.status === 'failed').map(c => ({ code: 'CONFORMANCE', path: '', message: `${c.id}: ${c.detail}` })) : validation.issues);
  }
  const compiled = compileCourse(input);
  return bundleFiles(compiled, report);
}
function bundleFiles(compiled: CompiledCourse, report: ConformanceReport): Record<string, string> {
  const course = compiled.server;
  const files: Record<string, string> = {
    'capabilities.json': text(requiredCapabilities(course)),
    'conformance.json': text(report),
    'course.compiled.json': text(compiled),
    'licenses.json': text(licenseInventory(course)),
  };
  const manifest: BundleManifest = {
    bundleFormat: 1, sdk: { name: SDK_NAME, version: SDK_VERSION },
    course: { id: course.id, version: course.version, schemaVersion: course.schemaVersion, title: course.title, locale: course.locale, platforms: [...course.platforms] },
    compiledDigest: compiled.digest, contents: Object.keys(files).sort(),
  };
  files['manifest.json'] = text(manifest);
  const integrity = { algorithm: 'sha256', files: Object.fromEntries(Object.keys(files).sort().map(name => [name, sha256(files[name]!)])) };
  files['integrity.json'] = text(integrity);
  return Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]!]));
}

export interface BundleVerification { valid: boolean; issues: ValidationIssue[]; warnings: ValidationIssue[]; compiled?: CompiledCourse }
/** Verify a bundle's file set, integrity map, compiled course and derived files. */
export function verifyCourseBundle(files: Record<string, string>): BundleVerification {
  const issues: ValidationIssue[] = [], warnings: ValidationIssue[] = [];
  const names = Object.keys(files).sort();
  for (const name of names) if (!BUNDLE_FILES.includes(name)) issues.push({ code: 'UNEXPECTED_FILE', path: `/${name}`, message: 'Bundles contain only the declared files.' });
  for (const name of BUNDLE_FILES) if (!(name in files)) issues.push({ code: 'MISSING_FILE', path: `/${name}`, message: 'Required bundle file is missing.' });
  if (issues.length) return { valid: false, issues, warnings };
  let integrity: { algorithm?: unknown; files?: Record<string, unknown> }, compiled: CompiledCourse, manifest: BundleManifest;
  try {
    integrity = JSON.parse(files['integrity.json']!); compiled = JSON.parse(files['course.compiled.json']!); manifest = JSON.parse(files['manifest.json']!);
  } catch { return { valid: false, issues: [{ code: 'NOT_JSON', path: '', message: 'Bundle files must be JSON.' }], warnings }; }
  const listed = Object.keys(integrity.files ?? {}).sort();
  const expected = BUNDLE_FILES.filter(n => n !== 'integrity.json');
  if (integrity.algorithm !== 'sha256' || listed.join(',') !== expected.join(',')) issues.push({ code: 'INTEGRITY_MAP', path: '/integrity.json', message: 'The integrity map must list every other file with SHA-256.' });
  for (const name of expected) if (integrity.files?.[name] !== sha256(files[name]!)) issues.push({ code: 'INTEGRITY_MISMATCH', path: `/${name}`, message: 'File bytes do not match the integrity map.' });
  if (!verifyCompiledCourse(compiled)) issues.push({ code: 'COMPILED_COURSE_INVALID', path: '/course.compiled.json', message: 'The compiled course does not verify.' });
  if (issues.length) return { valid: false, issues, warnings };
  if (manifest.sdk?.version !== SDK_VERSION) {
    warnings.push({ code: 'DIFFERENT_SDK_VERSION', path: '/manifest.json', message: `Packed by SDK ${String(manifest.sdk?.version)}; derived reports were not re-derived.` });
    if (manifest.compiledDigest !== compiled.digest) issues.push({ code: 'DERIVED_FILE_MISMATCH', path: '/manifest.json', message: 'Manifest digest differs from the compiled course.' });
  } else {
    const rebuilt = bundleFiles(compileCourse(compiled.server), conformanceReport(compiled.server));
    for (const name of BUNDLE_FILES) if (rebuilt[name] !== files[name]) issues.push({ code: 'DERIVED_FILE_MISMATCH', path: `/${name}`, message: 'File differs from the deterministic re-pack of the compiled course.' });
  }
  return issues.length ? { valid: false, issues, warnings } : { valid: true, issues: [], warnings, compiled };
}

/** Recover the authored manifest from a verified compiled course or bundle. */
export function importCourse(source: unknown): CourseManifest {
  if (source && typeof source === 'object' && 'manifest.json' in source) {
    const result = verifyCourseBundle(source as Record<string, string>);
    if (!result.valid) throw new CourseBundleError(result.issues);
    return structuredClone(result.compiled!.server);
  }
  if (!verifyCompiledCourse(source)) throw new CourseBundleError([{ code: 'COMPILED_COURSE_INVALID', path: '', message: 'Import accepts a verified compiled course or bundle.' }]);
  return structuredClone(source.server);
}

// ------------------------------------------------------------------ inspect and diff

export function inspectCourse(input: unknown): Record<string, unknown> {
  const course = verifyCompiledCourse(input) ? input.server : input;
  const validation = validateCourse(course);
  if (!validation.valid) return { valid: false, issues: validation.issues };
  const c = validation.course, compiled = compileCourse(c);
  const sections = Object.fromEntries(Object.entries(c).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return {
    valid: true, id: c.id, version: c.version, digest: compiled.digest, platforms: c.platforms, targets: targetsForPlatforms(c.platforms),
    sections, episodes: c.chapters.reduce((n, ch) => n + ch.episodes.length, 0),
    gates: c.gates.map(g => isVersionedGate(g) ? { id: g.id, versioned: true, version: g.version, evidence: g.eligibleEvidenceKinds } : { id: g.id, versioned: false }),
    serverOnlySections: SERVER_ONLY_SECTIONS.filter(s => s in c), learnerSections: Object.keys(compiled.learner).sort(),
    capabilities: requiredCapabilities(c).capabilities.map(x => x.capability),
  };
}

export interface CourseDiff {
  from: { id: string; version: string; digest: string };
  to: { id: string; version: string; digest: string };
  changes: { section: string; id: string; change: 'added' | 'removed' | 'changed' }[];
  breaking: { section: string; id: string; reason: string }[];
}
const VERSIONED_SECTIONS = new Set(['gates', 'activities', 'rubrics', 'tools', 'evaluators', 'agentStrategies', 'adminSections', 'storyboards', 'scenes', 'timelines', 'renderers', 'rendererAdapters', 'platformAdapters', 'debugInspectors', 'adaptationPolicies', 'extensions']);
/** Structural diff by stable ID with semver/evidence-affecting change detection. */
export function diffCourses(fromInput: unknown, toInput: unknown): CourseDiff {
  const a = validateCourse(fromInput), b = validateCourse(toInput);
  if (!a.valid || !b.valid) throw new CourseBundleError([...(a.valid ? [] : a.issues.map(i => ({ ...i, path: `/from${i.path}` }))), ...(b.valid ? [] : b.issues.map(i => ({ ...i, path: `/to${i.path}` })))]);
  const from = a.course, to = b.course;
  const collections = (c: CourseManifest): Map<string, Map<string, unknown>> => {
    const map = new Map<string, Map<string, unknown>>();
    for (const [key, value] of Object.entries(c)) if (Array.isArray(value) && value.every(v => v && typeof v === 'object' && 'id' in v))
      map.set(key, new Map(value.map(v => [(v as { id: string }).id, v])));
    map.set('episodes', new Map(c.chapters.flatMap(ch => ch.episodes).map(e => [e.id, e])));
    const singles = new Map<string, unknown>();
    for (const key of ['policy', 'placement', 'retention', 'adaptation', 'research', 'title', 'summary', 'locale', 'platforms', 'chapterLabel'] as const)
      if (c[key] !== undefined) singles.set(key, c[key]);
    map.set('course', singles);
    return map;
  };
  const left = collections(from), right = collections(to);
  const changes: CourseDiff['changes'] = [], breaking: CourseDiff['breaking'] = [];
  for (const section of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const l = left.get(section) ?? new Map(), r = right.get(section) ?? new Map();
    for (const id of [...new Set([...l.keys(), ...r.keys()])].sort()) {
      const before = l.get(id), after = r.get(id);
      if (before === undefined) changes.push({ section, id, change: 'added' });
      else if (after === undefined) {
        changes.push({ section, id, change: 'removed' });
        if (['objectives', 'episodes', 'assessments', 'gates', 'activities'].includes(section)) breaking.push({ section, id, reason: 'Removing it can strand learners or orphan evidence.' });
      } else if (canonicalJson(before) !== canonicalJson(after)) {
        changes.push({ section, id, change: 'changed' });
        const versioned = before as { version?: string }, next = after as { version?: string };
        if (VERSIONED_SECTIONS.has(section) && versioned.version !== undefined && versioned.version === next.version)
          breaking.push({ section, id, reason: 'Changed without a version bump; attempts and decisions bind versions.' });
        if (section === 'assessments' && canonicalJson((before as { grading?: unknown }).grading ?? null) !== canonicalJson((after as { grading?: unknown }).grading ?? null))
          breaking.push({ section, id, reason: 'Grading changed; affected evidence needs explicit invalidation and a replacement check.' });
      }
    }
  }
  if (changes.length && from.version === to.version) breaking.push({ section: 'course', id: 'version', reason: 'The course changed without a version change.' });
  return { from: { id: from.id, version: from.version, digest: compileCourse(from).digest }, to: { id: to.id, version: to.version, digest: compileCourse(to).digest }, changes, breaking };
}

// ------------------------------------------------------------------ migrate and scaffold

export interface MigrationResult { course: CourseManifest; changes: string[]; manualSteps: string[]; issues: ValidationIssue[] }
/**
 * Upgrade 0.4 gates to versioned gates. Migration never invents pedagogy: it does not
 * mark items as transfer tasks or write rubrics, so the result usually lists manual steps.
 */
export function migrateCourse(input: unknown): MigrationResult {
  const checked = validateCourse(input);
  if (!checked.valid) throw new CourseBundleError(checked.issues);
  const course = checked.course, changes: string[] = [], manualSteps: string[] = [];
  const legacy = course.gates.filter(g => !isVersionedGate(g));
  if (!legacy.length) return { course, changes, manualSteps, issues: [] };
  const episodes = course.chapters.flatMap(c => c.episodes.map(e => ({ chapter: c, episode: e })));
  let remediationId = 'default-remediation';
  for (let n = 2; (course.adaptationPolicies ?? []).some(p => p.id === remediationId); n++) remediationId = `default-remediation-${n}`;
  const policy: AdaptationPolicy = {
    id: remediationId, version: '1.0.0', maxCyclesPerConcept: Math.min(course.policy.work?.remediationCyclesPerConcept ?? 2, 20),
    strategies: ['change_representation', 'visit_prerequisite', 'practice'], onExhausted: course.policy.extensions?.enabled ? 'offer_extension' : 'close_with_gaps',
    autoApply: 'verified_only', learnerUndo: true,
  };
  course.adaptationPolicies = [...(course.adaptationPolicies ?? []), policy];
  changes.push(`Added adaptation policy ${remediationId} for gate remediation.`);
  const assessments = new Map(course.assessments.map(a => [a.id, a]));
  course.gates = course.gates.map(gate => {
    if (isVersionedGate(gate)) return gate;
    const users = episodes.filter(x => x.episode.gateId === gate.id);
    const scope: VersionedProgressionGate['scope'] = users.length === 1 ? { kind: 'episode', episodeId: users[0]!.episode.id }
      : users.length > 0 && users.every(u => u.chapter.id === users[0]!.chapter.id) ? { kind: 'chapter', chapterId: users[0]!.chapter.id } : { kind: 'course' };
    const capPolicyRef = scope.kind === 'episode' && users[0]!.episode.policy ? `episode:${users[0]!.episode.id}`
      : scope.kind !== 'course' && users[0]!.chapter.policy ? `chapter:${users[0]!.chapter.id}` : 'course';
    const lastIndex = Math.max(-1, ...users.map(u => episodes.indexOf(u)));
    const interactive = gate.assessmentIds.filter(id => DETERMINISTIC_TYPES.has(assessments.get(id)!.type));
    const practical = gate.assessmentIds.filter(id => PRACTICAL_TYPES.has(assessments.get(id)!.type));
    const criteria: ReadinessCriterion[] = [
      { id: 'independent', kind: 'independent_success', description: 'Independent success in the required item families.', objectiveIds: [] },
      { id: 'transfer', kind: 'transfer_success', description: 'Independent success on a new transfer task.', objectiveIds: [] },
    ];
    if ((course.hypotheses ?? []).some(h => h.critical && h.objectiveIds.some(o => gate.objectiveIds.includes(o))))
      criteria.push({ id: 'misconceptions', kind: 'no_critical_misconception', description: 'No unresolved critical misconception.', objectiveIds: [] });
    const migrated: VersionedProgressionGate = {
      id: gate.id, version: '1.0.0', scope, requiredObjectives: [...gate.objectiveIds], readinessCriteria: criteria,
      eligibleEvidenceKinds: [...(interactive.length ? ['deterministic_interactive_check' as const] : []), ...(practical.length ? ['verified_practical_task' as const] : [])],
      minimumIndependentEvidence: { families: gate.minimumIndependentFamilies, transferItems: 1 },
      assistancePolicy: { assistedEvidence: 'recorded_not_counted', revealRequiresFreshEvidence: true, agentAuthoredAnswers: 'rejected', reattemptsOfSameItem: 'not_independent' },
      nextActivityId: episodes[lastIndex + 1]?.episode.id ?? null, remediationPolicyRef: remediationId, capPolicyRef,
      appealPolicy: { allowed: true, windowDays: 14, reviewer: 'staff' },
    };
    if (interactive.length) migrated.interactiveCheckRefs = interactive;
    if (practical.length) migrated.practicalTaskRefs = practical;
    if (migrated.eligibleEvidenceKinds.length > 1) migrated.eligibleEvidenceKinds.push('configured_combination');
    changes.push(`Converted gate ${gate.id} to a versioned gate (scope ${scope.kind}, cap ${capPolicyRef}).`);
    if (gate.conversationalEvaluatorId) manualSteps.push(`Gate ${gate.id}: replace conversationalEvaluatorId with a cited-evidence rubric (defineRubric) and conversationalRubricRef.`);
    if (!gate.assessmentIds.some(id => assessments.get(id)?.role === 'transfer'))
      manualSteps.push(`Gate ${gate.id}: mark at least one production item role "transfer" (migration cannot judge which task is novel).`);
    return migrated;
  });
  manualSteps.push('Review every converted gate and bump the course version before publishing.');
  const result = validateCourse(course);
  return { course, changes, manualSteps, issues: result.valid ? [] : result.issues };
}

/** A small, valid, domain-neutral 0.5 course for `course init`. */
export function scaffoldCourse(options: { id?: string; title?: string } = {}): CourseManifest {
  const id = options.id ?? 'example-course';
  return {
    schemaVersion: 1, id, version: '0.1.0', title: options.title ?? 'Example course', summary: 'A starter course created by course init.',
    locale: 'en', platforms: ['web'],
    objectives: [{ id: 'estimate-mean', description: 'Estimate the mean of a short list of numbers.', prerequisites: [] }],
    chapters: [{ id: 'basics', title: 'Basics', episodes: [{
      id: 'mean', title: 'The mean', objectiveIds: ['estimate-mean'], gateId: 'mean-ready',
      blocks: [
        { id: 'explain', type: 'text', markdown: 'The mean adds the values and divides by how many there are.' },
        { id: 'check-sum', type: 'assessment', assessmentId: 'mean-choice' },
        { id: 'check-transfer', type: 'assessment', assessmentId: 'mean-transfer' },
      ],
    }] }],
    assessments: [
      { id: 'mean-choice', type: 'choice', objectiveIds: ['estimate-mean'], familyId: 'mean-recognize', role: 'recognition', prompt: 'What is the mean of 2, 4 and 6?',
        options: [{ id: 'four', text: '4' }, { id: 'twelve', text: '12', misconceptionId: 'mean-is-sum' }], grading: { correctOptionId: 'four', explanation: '12 divided by 3 is 4.' } },
      { id: 'mean-transfer', type: 'numeric', objectiveIds: ['estimate-mean'], familyId: 'mean-apply', role: 'transfer', misconceptionIds: ['mean-is-sum'],
        prompt: 'Three readings are 10, 20 and 60. What reading would make the mean of four readings equal 30?', grading: { expected: 30, absoluteTolerance: 0, explanation: 'Four readings totalling 120 need 30 more.' } },
      { id: 'mean-probe', type: 'choice', objectiveIds: ['estimate-mean'], familyId: 'mean-probe', role: 'diagnostic_probe', prompt: 'Is the mean of 5 and 5 equal to 10?',
        options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }], grading: { correctOptionId: 'no', explanation: 'The mean of 5 and 5 is 5.' } },
    ],
    gates: [{
      id: 'mean-ready', version: '1.0.0', scope: { kind: 'episode', episodeId: 'mean' }, requiredObjectives: ['estimate-mean'],
      readinessCriteria: [
        { id: 'independent', kind: 'independent_success', description: 'Two independent item families.', objectiveIds: [] },
        { id: 'transfer', kind: 'transfer_success', description: 'Solve a new transfer task.', objectiveIds: [] },
        { id: 'misconceptions', kind: 'no_critical_misconception', description: 'The mean is not confused with the sum.', objectiveIds: [] },
      ],
      eligibleEvidenceKinds: ['deterministic_interactive_check'], minimumIndependentEvidence: { families: 2, transferItems: 1 },
      interactiveCheckRefs: ['mean-choice', 'mean-transfer'],
      assistancePolicy: { assistedEvidence: 'recorded_not_counted', revealRequiresFreshEvidence: true, agentAuthoredAnswers: 'rejected', reattemptsOfSameItem: 'not_independent' },
      nextActivityId: null, remediationPolicyRef: 'remediation', capPolicyRef: 'course', appealPolicy: { allowed: true, windowDays: 14, reviewer: 'staff' },
    }],
    hypotheses: [
      { id: 'mean-is-sum', kind: 'misconception', statement: 'The mean is the total rather than the total divided by the count.', objectiveIds: ['estimate-mean'], critical: true },
      { id: 'arithmetic-slip', kind: 'slip', statement: 'A one-off arithmetic slip.', objectiveIds: ['estimate-mean'] },
    ],
    probes: [{ id: 'sum-or-slip', objectiveId: 'estimate-mean', assessmentId: 'mean-probe', distinguishes: ['mean-is-sum', 'arithmetic-slip'],
      signals: [{ hypothesisId: 'mean-is-sum', optionIds: ['yes'] }, { hypothesisId: 'arithmetic-slip', outcome: 'correct' }] }],
    adaptationPolicies: [{ id: 'remediation', version: '1.0.0', maxCyclesPerConcept: 2, strategies: ['contrast_case', 'worked_example'], onExhausted: 'close_with_gaps', autoApply: 'verified_only', learnerUndo: true }],
    extensions: [], visuals: [], media: [], sources: [],
    policy: { mode: 'bounded', work: { additionalEpisodes: 3, remediationCyclesPerConcept: 2 }, existingMaterialAccess: 'read_only' },
  };
}
