import { validateCourse } from './validate.js';
import { requiredCapabilities } from './tooling.js';
import { DEFAULT_MINIMUM_CORE_VERSION } from './course-package.js';
import { SDK_VERSION } from './version.js';
import type { CourseManifest, ValidationIssue } from './types.js';
import type { PlatformTarget, RenderFeature } from './contracts-types.js';

/**
 * 0.6: one compatibility report across the SDK the course is built with, the Core version range it
 * needs, and the adapters a host (or the author's machine) has installed: renderers with their
 * render features, platform adapters, extensions and granted capabilities. It applies the same
 * rules as Course Core's package install preview, so an author sees the problems before packing.
 */

/** What a host has installed. Core's admin "export host inventory" and hand-written files both use this shape. */
export interface HostInventory {
  hostInventoryFormat: 1;
  coreVersion: string;
  /** The SDK the host validates with, and the SDK versions it accepts packages from. */
  sdk?: { version: string; supported?: { min: string; maxExclusive: string } };
  renderers?: { rendererId: string; version: string; features: RenderFeature[]; targets?: PlatformTarget[] }[];
  platformAdapters?: { id: string; version: string; target: PlatformTarget }[];
  extensions?: { id: string; version: string; integrity?: string }[];
  /** Capabilities the host can grant to extensions, activities and tools. */
  capabilities?: string[];
}
/** A renderer installed on the author's machine, such as the released @course-core/visuals package. */
export interface LocalRenderer { rendererId: string; version: string; features: string[]; source: string }

export type CompatibilityStatus = 'satisfied' | 'missing' | 'version_mismatch' | 'feature_missing' | 'unknown';
export interface CompatibilityItem {
  kind: 'renderer' | 'platform_adapter' | 'extension' | 'capability';
  id: string;
  requiredBy: string[];
  required: { version?: string; integrity?: string; features?: string[] };
  installed: { version?: string; features?: string[]; source: 'host' | 'local' } | null;
  status: CompatibilityStatus;
  detail: string;
}
export interface CompatibilityProblem { code: string; severity: 'blocking' | 'warning'; detail: string }
export interface CompatibilityReport {
  compatibilityFormat: 1;
  course: { id: string; version: string } | null;
  sdk: { version: string; requiresHostSdk: string; reasons: string[]; host: string | null; hostSupported: { min: string; maxExclusive: string } | null;
    status: 'supported' | 'older' | 'newer' | 'unsupported' | 'unknown' };
  core: { minimumVersion: string; hostVersion: string | null; status: 'satisfied' | 'too_old' | 'unknown' };
  adapters: CompatibilityItem[];
  local: LocalRenderer[];
  problems: CompatibilityProblem[];
  status: 'compatible' | 'incompatible' | 'unknown';
  issues: ValidationIssue[];
}

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
/** Semantic-version order (a pre-release sorts before its release). Throws on a non-semver value. */
export function compareSemver(a: string, b: string): number {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (!x || !y) throw new RangeError(`Not a semantic version: ${!x ? a : b}`);
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (x[4] === y[4]) return 0;
  if (x[4] === undefined) return 1;
  if (y[4] === undefined) return -1;
  const [p, q] = [x[4].split('.'), y[4].split('.')];
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const numeric = /^\d+$/.test(p[i]!) && /^\d+$/.test(q[i]!);
    const order = numeric ? Number(p[i]) - Number(q[i]) : p[i]! < q[i]! ? -1 : p[i]! > q[i]! ? 1 : 0;
    if (order) return order;
  }
  return 0;
}
const isSemver = (value: unknown): value is string => typeof value === 'string' && SEMVER.test(value);

const SDK_06_FEATURES: ReadonlySet<string> = new Set(['symbol', 'spring', 'stagger', 'layout_set', 'panes', 'invariants', 'goldens']);
/** Data that a host on SDK 0.5 rejects, so the course needs a host on SDK 0.6 or later. */
export function sdk06Reasons(course: CourseManifest): string[] {
  const reasons: string[] = [];
  if (course.translations || course.locales?.length) reasons.push('multi-locale text (locales, translations)');
  if (course.studyInstruments) reasons.push('studyInstruments');
  if (course.conceptMappingDrafts?.length) reasons.push('conceptMappingDrafts');
  if ((course.evaluators ?? []).some(e => (e.itemTypes as string[]).includes('conversation'))) reasons.push('conversation evaluators');
  const features = new Set([...(course.renderers ?? []).flatMap(r => r.features), ...(course.rendererAdapters ?? []).flatMap(a => a.supportedFeatures),
    ...course.visuals.flatMap(v => v.requiredFeatures ?? [])].filter(f => SDK_06_FEATURES.has(f)));
  if (features.size) reasons.push(`render features ${[...features].sort().join(', ')}`);
  if (course.visuals.some(v => v.interactions?.length || v.panes?.length || v.invariants?.length || v.goldens?.length)) reasons.push('visual interactions, panes or checks');
  if (course.extensions.some(e => e.stateMigration || e.tests?.length)) reasons.push('extension state migration or tests');
  return reasons;
}

function inventoryIssues(host: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string) => issues.push({ code: 'INVALID_HOST_INVENTORY', path: `/host${path}`, message });
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(host) || host.hostInventoryFormat !== 1) { report('', 'A host inventory is { "hostInventoryFormat": 1, "coreVersion": "x.y.z", ... }.'); return issues; }
  if (!isSemver(host.coreVersion)) report('/coreVersion', 'coreVersion must be a semantic version.');
  if (host.sdk !== undefined) {
    const sdk = host.sdk as Record<string, unknown>;
    if (!object(sdk) || !isSemver(sdk.version)) report('/sdk/version', 'sdk.version must be a semantic version.');
    else if (sdk.supported !== undefined) {
      const range = sdk.supported as Record<string, unknown>;
      if (!object(range) || !isSemver(range.min) || !isSemver(range.maxExclusive)) report('/sdk/supported', 'supported is { "min": "x.y.z", "maxExclusive": "x.y.z" }.');
    }
  }
  const list = (key: string, check: (item: Record<string, unknown>) => boolean, shape: string) => {
    const value = host[key];
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > 1000) { report(`/${key}`, `${key} is a list of at most 1000 entries.`); return; }
    for (const [i, item] of value.entries()) if (!object(item) || !check(item)) report(`/${key}/${i}`, `Each entry is ${shape}.`);
  };
  const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200;
  const texts = (value: unknown) => Array.isArray(value) && value.length <= 200 && value.every(text);
  list('renderers', r => text(r.rendererId) && text(r.version) && texts(r.features) && (r.targets === undefined || texts(r.targets)), '{ rendererId, version, features[] }');
  list('platformAdapters', a => text(a.id) && text(a.version) && text(a.target), '{ id, version, target }');
  list('extensions', e => text(e.id) && text(e.version) && (e.integrity === undefined || text(e.integrity)), '{ id, version, integrity? }');
  if (host.capabilities !== undefined && !texts(host.capabilities)) report('/capabilities', 'capabilities is a list of capability names.');
  return issues;
}

export interface CompatibilityOptions {
  host?: unknown;
  /** The Core version the package will declare (default: the SDK's DEFAULT_MINIMUM_CORE_VERSION). */
  minimumCoreVersion?: string;
  /** Renderers installed on the author's machine (the CLI finds @course-core/visuals). */
  localRenderers?: LocalRenderer[];
}

/** The compatibility of a course with this SDK, a Core version and installed adapters. Pure and offline. */
export function compatibilityReport(courseInput: unknown, options: CompatibilityOptions = {}): CompatibilityReport {
  const minimumCoreVersion = options.minimumCoreVersion ?? DEFAULT_MINIMUM_CORE_VERSION;
  const local = options.localRenderers ?? [];
  const checked = validateCourse(courseInput);
  const issues: ValidationIssue[] = checked.valid ? [] : checked.issues.map(issue => ({ ...issue, path: `/course${issue.path}` }));
  if (!isSemver(minimumCoreVersion)) issues.push({ code: 'INVALID_VERSION', path: '/minimumCoreVersion', message: 'Use a semantic version such as 0.1.46.' });
  if (options.host !== undefined) issues.push(...inventoryIssues(options.host));
  const base = { compatibilityFormat: 1 as const, local };
  if (!checked.valid || issues.length) return { ...base, course: null, status: 'incompatible', issues, problems: [], adapters: [],
    sdk: { version: SDK_VERSION, requiresHostSdk: '0.5.0', reasons: [], host: null, hostSupported: null, status: 'unknown' },
    core: { minimumVersion: minimumCoreVersion, hostVersion: null, status: 'unknown' } };
  const course = checked.course;
  const host = options.host as HostInventory | undefined;
  const problems: CompatibilityProblem[] = [];
  const reasons = sdk06Reasons(course);
  const requiresHostSdk = reasons.length ? '0.6.0' : '0.5.0';

  // SDK: the same classification as Core's package preview, plus the course's own needs.
  const range = host?.sdk?.supported ?? null;
  let sdkStatus: CompatibilityReport['sdk']['status'] = 'unknown';
  if (range) {
    sdkStatus = compareSemver(SDK_VERSION, range.min) < 0 ? 'older' : compareSemver(SDK_VERSION, range.maxExclusive) < 0 ? 'supported'
      : SDK_VERSION.split('.')[0] === host!.sdk!.version.split('.')[0] ? 'newer' : 'unsupported';
    if (sdkStatus === 'unsupported') problems.push({ code: 'SDK_UNSUPPORTED', severity: 'blocking', detail: `Built with SDK ${SDK_VERSION}; the host supports ${range.min} to below ${range.maxExclusive}.` });
    else if (sdkStatus !== 'supported') problems.push({ code: sdkStatus === 'newer' ? 'SDK_NEWER_THAN_CORE' : 'SDK_OLDER_THAN_CORE', severity: 'warning',
      detail: `Built with SDK ${SDK_VERSION}; the host validates with SDK ${host!.sdk!.version} and accepts ${range.min} to below ${range.maxExclusive}.` });
  }
  if (host?.sdk && compareSemver(host.sdk.version, requiresHostSdk) < 0)
    problems.push({ code: 'HOST_SDK_TOO_OLD', severity: 'blocking', detail: `The course uses ${reasons.join('; ')}, which hosts on SDK ${host.sdk.version} reject; they need SDK ${requiresHostSdk} or later.` });

  const coreStatus = !host ? 'unknown' : compareSemver(host.coreVersion, minimumCoreVersion) >= 0 ? 'satisfied' : 'too_old';
  if (coreStatus === 'too_old') problems.push({ code: 'CORE_VERSION_TOO_OLD', severity: 'blocking', detail: `Requires Core ${minimumCoreVersion}; the host is ${host!.coreVersion}.` });

  const adapters: CompatibilityItem[] = [];
  // Renderers: each visual names the renderer (declared as a course extension) that draws it, and the
  // render features it needs. The host's renderer must have them; a locally installed renderer is checked
  // the same way when there is no host inventory, and a local version that differs from the declared one
  // (or one lacking features) is only a warning: the preview may differ from what learners see.
  const declared = new Map(course.extensions.map(e => [e.id, e.version]));
  const byRenderer = new Map<string, { requiredBy: Set<string>; features: Set<string> }>();
  for (const visual of course.visuals) {
    const entry = byRenderer.get(visual.rendererId) ?? { requiredBy: new Set(), features: new Set() };
    entry.requiredBy.add(`visual:${visual.id}`);
    for (const feature of visual.requiredFeatures ?? []) entry.features.add(feature);
    byRenderer.set(visual.rendererId, entry);
  }
  for (const [rendererId, need] of [...byRenderer].sort(([a], [b]) => a.localeCompare(b))) {
    const features = [...need.features].sort();
    const version = declared.get(rendererId);
    const fromHost = host?.renderers?.find(r => r.rendererId === rendererId);
    const fromLocal = local.find(r => r.rendererId === rendererId);
    const installed = fromHost ? { version: fromHost.version, features: [...fromHost.features].sort(), source: 'host' as const }
      : !host && fromLocal ? { version: fromLocal.version, features: [...fromLocal.features].sort(), source: 'local' as const } : null;
    const lacking = installed ? features.filter(f => !(installed.features as string[]).includes(f)) : [];
    const status: CompatibilityStatus = !installed ? (host ? 'missing' : 'unknown') : lacking.length ? 'feature_missing'
      : version !== undefined && installed.version !== version ? 'version_mismatch' : 'satisfied';
    const where = installed?.source === 'local' ? 'Installed locally' : 'Installed on the host';
    adapters.push({ kind: 'renderer', id: rendererId, requiredBy: [...need.requiredBy].sort(), required: { ...(version !== undefined ? { version } : {}), features }, installed, status,
      detail: status === 'satisfied' ? `${where}: ${rendererId} ${installed!.version}.`
        : status === 'feature_missing' ? `${rendererId} ${installed!.version} lacks ${lacking.join(', ')}.`
          : status === 'version_mismatch' ? `${where}: ${rendererId} ${installed!.version}; the course declares ${version}.`
            : status === 'missing' ? `The host has no ${rendererId} renderer.` : 'No host inventory or local renderer to check against.' });
  }
  for (const extension of course.extensions) {
    const found = host?.extensions?.find(e => e.id === extension.id);
    const status: CompatibilityStatus = !host?.extensions ? 'unknown' : !found ? 'missing'
      : found.version !== extension.version || (found.integrity !== undefined && found.integrity !== extension.integrity) ? 'version_mismatch' : 'satisfied';
    adapters.push({ kind: 'extension', id: extension.id, requiredBy: ['course'], required: { version: extension.version, integrity: extension.integrity },
      installed: found ? { version: found.version, source: 'host' } : null, status,
      detail: status === 'version_mismatch' ? `The host has ${extension.id} ${found!.version}${found!.integrity !== undefined && found!.integrity !== extension.integrity ? ' with different code' : ''}; the course needs ${extension.version}.`
        : status === 'missing' ? `The host has not installed ${extension.id}.` : status === 'satisfied' ? `Installed: ${extension.id} ${found!.version}.` : 'The host inventory lists no extensions.' });
  }
  for (const adapter of course.platformAdapters ?? []) {
    const found = host?.platformAdapters?.find(a => a.id === adapter.id && a.target === adapter.target);
    const status: CompatibilityStatus = !host?.platformAdapters ? 'unknown' : !found ? 'missing' : found.version !== adapter.version ? 'version_mismatch' : 'satisfied';
    adapters.push({ kind: 'platform_adapter', id: adapter.id, requiredBy: [`target:${adapter.target}`], required: { version: adapter.version },
      installed: found ? { version: found.version, source: 'host' } : null, status,
      detail: status === 'missing' ? `The host has no ${adapter.id} for ${adapter.target}${adapter.requiresAppBuild ? '; it needs an app build that includes it' : ''}.`
        : status === 'version_mismatch' ? `The host has ${adapter.id} ${found!.version}; the course needs ${adapter.version}.`
          : status === 'satisfied' ? `Installed: ${adapter.id} ${found!.version} (${adapter.target}).` : 'The host inventory lists no platform adapters.' });
  }
  for (const capability of requiredCapabilities(course).capabilities.filter(c => c.required)) {
    const status: CompatibilityStatus = !host?.capabilities ? 'unknown' : host.capabilities.includes(capability.capability) ? 'satisfied' : 'missing';
    adapters.push({ kind: 'capability', id: capability.capability, requiredBy: capability.requestedBy, required: {}, installed: status === 'satisfied' ? { source: 'host' } : null, status,
      detail: status === 'missing' ? `The host cannot grant ${capability.capability}.` : status === 'satisfied' ? 'The host can grant it.' : 'The host inventory lists no capabilities.' });
  }
  for (const item of adapters) {
    if (item.status === 'missing' || item.status === 'version_mismatch' || item.status === 'feature_missing')
      problems.push({ code: `${item.kind.toUpperCase()}_${item.status.toUpperCase()}`, severity: item.installed?.source === 'local' ? 'warning' : 'blocking', detail: item.detail });
  }
  const blocking = problems.some(p => p.severity === 'blocking');
  const unknown = !host || adapters.some(item => item.status === 'unknown');
  return {
    ...base, course: { id: course.id, version: course.version },
    sdk: { version: SDK_VERSION, requiresHostSdk, reasons, host: host?.sdk?.version ?? null, hostSupported: range, status: sdkStatus },
    core: { minimumVersion: minimumCoreVersion, hostVersion: host?.coreVersion ?? null, status: coreStatus },
    adapters, problems, status: blocking ? 'incompatible' : unknown ? 'unknown' : 'compatible', issues: [],
  };
}
