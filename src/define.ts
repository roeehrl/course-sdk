import type { ValidateFunction } from 'ajv';
import validators from './generated/contracts-validator.js';
import { shapeIssues } from './adaptation-shape.js';
import { standaloneChecks, unlabeledEquationLayers } from './contracts-validate.js';
import { learningPolicyIssues, validateCourse } from './validate.js';
import { jsonIssue } from './json.js';
import { canonicalLocale, isSupportedLocale } from './locale.js';
import {
  bindingSites, extensionSites, forEachTextSite, interactionSites, isLocalizedText, localizedTextSites, paneSites, sceneSites, visualSites,
  type CourseDraft, type DataBindingInput, type ExtensionManifestInput, type InteractionInput, type SceneInput, type TextInput, type TextSite,
  type VisualExperienceInput, type VisualPaneInput,
} from './localization.js';
import type {
  Assessment, CourseManifest, Episode, ExtensionManifest, Json, LearningPolicy, LocaleBundle, MediaResource, PlacementPolicy, ValidationIssue, VisualExperience,
} from './types.js';
import type {
  ActivityDefinition, AdaptationPolicy, AdminSection, AgentStrategy, Concept, CourseStage, DebugInspector, DiagnosticProbe, EvaluatorDefinition,
  LearningStep, PlatformAdapter, RendererAdapter, RendererDefinition, ResearchTask, Rubric, Scene, Storyboard, TeachingHypothesisTemplate,
  Timeline, ToolDefinition, VersionedProgressionGate, Interaction, DataBinding, VisualLayouts, VisualPane, StudyInstruments, ConceptMappingDraft,
  VisualChecks,
} from './contracts-types.js';

export interface ContractKinds {
  concept: Concept;
  episode: Episode;
  assessment: Assessment;
  activity: ActivityDefinition;
  rubric: Rubric;
  tool: ToolDefinition;
  adaptationPolicy: AdaptationPolicy;
  learningPolicy: LearningPolicy;
  adminSection: AdminSection;
  learningStep: LearningStep;
  progressionGate: VersionedProgressionGate;
  mediaResource: MediaResource;
  storyboard: Storyboard;
  researchTask: ResearchTask;
  placementPolicy: PlacementPolicy;
  extension: ExtensionManifest;
  renderer: RendererDefinition;
  evaluator: EvaluatorDefinition;
  agentStrategy: AgentStrategy;
  platformAdapter: PlatformAdapter;
  debugInspector: DebugInspector;
  visualExperience: VisualExperience;
  scene: Scene;
  timeline: Timeline;
  rendererAdapter: RendererAdapter;
  interaction: Interaction;
  dataBinding: DataBinding;
  visualLayouts: VisualLayouts;
  visualPane: VisualPane;
  visualChecks: VisualChecks;
  studyInstruments: StudyInstruments;
  conceptMappingDraft: ConceptMappingDraft;
  teachingHypothesis: TeachingHypothesisTemplate;
  diagnosticProbe: DiagnosticProbe;
  stage: CourseStage;
  /** 0.6: one locale's bundle in `translations`. */
  localeBundle: LocaleBundle;
}
export type ContractKind = keyof ContractKinds;
export const CONTRACT_KINDS = Object.freeze(['concept', 'episode', 'assessment', 'activity', 'rubric', 'tool', 'adaptationPolicy', 'learningPolicy',
  'adminSection', 'learningStep', 'progressionGate', 'mediaResource', 'storyboard', 'researchTask', 'placementPolicy', 'extension', 'renderer',
  'evaluator', 'agentStrategy', 'platformAdapter', 'debugInspector', 'visualExperience', 'scene', 'timeline', 'rendererAdapter',
  'teachingHypothesis', 'diagnosticProbe', 'stage', 'interaction', 'dataBinding', 'visualLayouts', 'visualPane', 'studyInstruments',
  'conceptMappingDraft', 'visualChecks', 'localeBundle'] as const satisfies readonly ContractKind[]);

export class ContractValidationError extends Error {
  constructor(public readonly contract: string, public readonly issues: ValidationIssue[]) {
    super(`${contract} contract failed validation with ${issues.length} issue(s).`);
    this.name = 'ContractValidationError';
  }
}

type Check = (value: never, path: string, report: (code: string, path: string, message: string) => void) => void;
const semantic: Partial<Record<ContractKind, Check>> = {
  assessment: standaloneChecks.assessment, activity: standaloneChecks.activity, rubric: standaloneChecks.rubric, tool: standaloneChecks.tool,
  adminSection: standaloneChecks.adminSection, learningStep: standaloneChecks.learningStep, progressionGate: standaloneChecks.gate,
  storyboard: standaloneChecks.storyboard, evaluator: standaloneChecks.evaluator, agentStrategy: standaloneChecks.agentStrategy,
  platformAdapter: standaloneChecks.platformAdapter, debugInspector: standaloneChecks.debugInspector, scene: standaloneChecks.scene,
  timeline: standaloneChecks.timeline, rendererAdapter: standaloneChecks.rendererAdapter, teachingHypothesis: standaloneChecks.hypothesis,
  diagnosticProbe: standaloneChecks.probe, extension: standaloneChecks.extension,
  visualExperience: standaloneChecks.visual, interaction: standaloneChecks.interaction, dataBinding: standaloneChecks.dataBinding,
  visualLayouts: standaloneChecks.visualLayouts, visualPane: standaloneChecks.visualPane, studyInstruments: standaloneChecks.studyInstruments,
  conceptMappingDraft: standaloneChecks.conceptMappingDraft, visualChecks: standaloneChecks.visualChecks,
  mediaResource: ((value: MediaResource, path, report) => standaloneChecks.mediaSegment(value.segment, `${path}/segment`, report)) as Check,
  localeBundle: ((value: LocaleBundle, path, report) => {
    for (const [key, text] of Object.entries(value.texts))
      if (text.trim() === '') report('BLANK_TRANSLATION', `${path}/texts/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, `The text for ${key} is blank; translate it or list the key in fallback.`);
  }) as Check,
  learningPolicy: ((value: LearningPolicy, path, report) => { for (const i of learningPolicyIssues(value, path)) report(i.code, i.path, i.message); }) as Check,
};

/**
 * Context-free validation of one contract: JSON data, schema shape and rules that need
 * no other course data. References between contracts are checked by validateCourse.
 */
export function validateContract<K extends ContractKind>(kind: K, value: unknown): { valid: true; value: ContractKinds[K]; issues: [] } | { valid: false; issues: ValidationIssue[] } {
  const validate = (validators as Record<string, ValidateFunction | undefined>)[`contract_${kind}`];
  if (!validate || !(CONTRACT_KINDS as readonly string[]).includes(kind)) return { valid: false, issues: [{ code: 'UNKNOWN_CONTRACT', path: '', message: `Unknown contract kind ${String(kind)}.` }] };
  const issues = shapeIssues(validate, value);
  if (!issues.length) semantic[kind]?.(value as never, '', (code, path, message) => issues.push({ code, path, message }));
  return issues.length ? { valid: false, issues } : { valid: true, value: structuredClone(value) as ContractKinds[K], issues: [] };
}

/**
 * Authoring rules the define* helpers add to validateContract. They are publication rules
 * (see publicationIssues) that need no other course data; data validity is unchanged.
 */
const authoring: Partial<Record<ContractKind, (value: never) => ValidationIssue[]>> = {
  scene: ((value: Scene) => unlabeledEquationLayers(value, '')) as (value: never) => ValidationIssue[],
};

function define<K extends ContractKind>(kind: K, value: ContractKinds[K]): ContractKinds[K] {
  const result = validateContract(kind, value);
  if (!result.valid) throw new ContractValidationError(kind, result.issues);
  const issues = authoring[kind]?.(result.value as never) ?? [];
  if (issues.length) throw new ContractValidationError(kind, issues);
  return result.value;
}

/* Validating authoring helpers. Each throws ContractValidationError and returns a detached copy. */
/**
 * Validates a whole course (schema, references and semantic rules, as validateCourse) and returns a
 * detached copy. 0.6: throws ContractValidationError (contract "course") instead of copying unchecked.
 */
export function defineCourse(course: CourseManifest): CourseManifest {
  const inline: ValidationIssue[] = [];
  // Only plain JSON data is scanned (validateCourse reports anything else without reading it).
  if (jsonIssue(course) === undefined) forEachTextSite(course, site => {
    if (isLocalizedText((site.holder as Record<string | number, unknown>)[site.field]))
      inline.push({ code: 'UNASSEMBLED_LOCALIZED_TEXT', path: site.path, message: `${site.key} holds per-locale text; build the course with assembleCourse, which moves it into translations.` });
  });
  if (inline.length) throw new ContractValidationError('course', inline);
  const result = validateCourse(course);
  if (!result.valid) throw new ContractValidationError('course', result.issues);
  return result.course;
}

/**
 * 0.6: validates a contract whose text fields may hold LocalizedText. Every LocalizedText in one
 * value names the same supported locales; the value is validated once per locale, with each text
 * in that locale, and returned as a detached copy that keeps the LocalizedText for assembleCourse.
 */
function defineLocalizable<K extends ContractKind>(kind: K, value: unknown, sites: (value: unknown, visit: (site: TextSite) => void) => void): unknown {
  const localized = localizedTextSites(value, sites);
  if (!localized.length) return define(kind, value as ContractKinds[K]);
  const issue = jsonIssue(value);
  if (issue) throw new ContractValidationError(kind, [issue]);
  const tags = [...new Set(localized.flatMap(site => Object.keys(site.text)))].sort();
  const issues: ValidationIssue[] = [];
  for (const tag of tags) if (!isSupportedLocale(tag)) issues.push({ code: 'UNSUPPORTED_LOCALE', path: '', message: `"${tag}" is not a supported locale.` });
  for (const site of localized) if (Object.keys(site.text).sort().join(',') !== tags.join(','))
    issues.push({ code: 'INCONSISTENT_LOCALIZED_TEXT', path: site.path, message: `Every localized text in one ${kind} names the same locales (${tags.join(', ')}).` });
  if (issues.length) throw new ContractValidationError(kind, issues);
  for (const tag of tags) {
    const projection = structuredClone(value);
    sites(projection, site => {
      const holder = site.holder as Record<string | number, unknown>;
      if (isLocalizedText(holder[site.field])) holder[site.field] = (holder[site.field] as Record<string, string>)[tag];
    });
    try { define(kind, projection as ContractKinds[K]); }
    catch (error) {
      if (!(error instanceof ContractValidationError)) throw error;
      issues.push(...error.issues.map(i => ({ ...i, message: `[${tag}] ${i.message}` })));
    }
  }
  if (issues.length) throw new ContractValidationError(kind, issues);
  return structuredClone(value);
}

/**
 * 0.6: validates like validateContract('visualExperience', …) instead of copying unchecked. Its
 * description and interaction and pane text may be LocalizedText (`{ en: '…', he: '…' }`).
 */
export function defineVisualExperience(value: VisualExperience): VisualExperience;
export function defineVisualExperience(value: VisualExperienceInput): VisualExperienceInput;
export function defineVisualExperience(value: VisualExperienceInput): VisualExperienceInput {
  return defineLocalizable('visualExperience', value, (v, visit) => visualSites(v, 'visual', '', visit)) as VisualExperienceInput;
}
/** 0.6: validates like validateContract('extension', …); the text alternative may be LocalizedText. */
export function defineExtension(value: ExtensionManifest): ExtensionManifest;
export function defineExtension(value: ExtensionManifestInput): ExtensionManifestInput;
export function defineExtension(value: ExtensionManifestInput): ExtensionManifestInput {
  return defineLocalizable('extension', value, (v, visit) => extensionSites(v, 'extension', '', visit)) as ExtensionManifestInput;
}
export const defineConcept = (value: Concept) => define('concept', value);
export const defineEpisode = (value: Episode) => define('episode', value);
export const defineAssessment = (value: Assessment) => define('assessment', value);
export const defineActivity = (value: ActivityDefinition) => define('activity', value);
export const defineRubric = (value: Rubric) => define('rubric', value);
export const defineTool = (value: ToolDefinition) => define('tool', value);
export const defineAdaptationPolicy = (value: AdaptationPolicy) => define('adaptationPolicy', value);
export const defineLearningPolicy = (value: LearningPolicy) => define('learningPolicy', value);
export const defineAdminSection = (value: AdminSection) => define('adminSection', value);
export const defineLearningStep = (value: LearningStep) => define('learningStep', value);
export const defineProgressionGate = (value: VersionedProgressionGate) => define('progressionGate', value);
export const defineMediaResource = (value: MediaResource) => define('mediaResource', value);
export const defineStoryboard = (value: Storyboard) => define('storyboard', value);
export const defineResearchTask = (value: ResearchTask) => define('researchTask', value);
export const definePlacementPolicy = (value: PlacementPolicy) => define('placementPolicy', value);
export const defineRenderer = (value: RendererDefinition) => define('renderer', value);
export const defineEvaluator = (value: EvaluatorDefinition) => define('evaluator', value);
export const defineAgentStrategy = (value: AgentStrategy) => define('agentStrategy', value);
export const definePlatformAdapter = (value: PlatformAdapter) => define('platformAdapter', value);
export const defineDebugInspector = (value: DebugInspector) => define('debugInspector', value);
/** Node and layer labels may be LocalizedText (0.6). */
export function defineScene(value: Scene): Scene;
export function defineScene(value: SceneInput): SceneInput;
export function defineScene(value: SceneInput): SceneInput {
  return defineLocalizable('scene', value, (v, visit) => sceneSites(v, 'scene', '', visit)) as SceneInput;
}
export const defineTimeline = (value: Timeline) => define('timeline', value);
export const defineRendererAdapter = (value: RendererAdapter) => define('rendererAdapter', value);
export const defineTeachingHypothesis = (value: TeachingHypothesisTemplate) => define('teachingHypothesis', value);
export const defineDiagnosticProbe = (value: DiagnosticProbe) => define('diagnosticProbe', value);
export const defineStage = (value: CourseStage) => define('stage', value);
/** The label and the binding's value labels may be LocalizedText (0.6). */
export function defineInteraction(value: Interaction): Interaction;
export function defineInteraction(value: InteractionInput): InteractionInput;
export function defineInteraction(value: InteractionInput): InteractionInput {
  return defineLocalizable('interaction', value, (v, visit) => interactionSites(v, 'interaction', '', visit)) as InteractionInput;
}
/** The title, table column labels and formula label may be LocalizedText (0.6). */
export function defineVisualPane(value: VisualPane): VisualPane;
export function defineVisualPane(value: VisualPaneInput): VisualPaneInput;
export function defineVisualPane(value: VisualPaneInput): VisualPaneInput {
  return defineLocalizable('visualPane', value, (v, visit) => paneSites(v, 'pane', '', visit)) as VisualPaneInput;
}
/** 0.6: validates one locale bundle (schema and non-blank texts). Keys are checked against a course by validateCourse. */
export const defineLocaleBundle = (value: LocaleBundle) => define('localeBundle', value);
/**
 * A visual's publish-time checks (invariants and golden frame digests), validated on their own.
 * Spread the result into a VisualExperience; validateCourse then checks it against the visual's
 * state, panes, timeline and layouts and the VISUAL_CHECK_LIMITS frame budget.
 */
export const defineVisualChecks = (value: VisualChecks) => define('visualChecks', value);
export const defineStudyInstruments = (value: StudyInstruments) => define('studyInstruments', value);
export const defineConceptMappingDraft = (value: ConceptMappingDraft) => define('conceptMappingDraft', value);

/**
 * Binds a learner input to one key of a visual's `state`: a numeric `range` (with an optional
 * `step`) or a list of discrete `values`. Validated like validateContract('dataBinding', …).
 */
export function bindData(state: string, options?: { range?: DataBinding['range']; values?: Json[]; labels?: string[] }): DataBinding;
/** 0.6: `labels` name each of `values` for learners, in the same order; they may be LocalizedText. */
export function bindData(state: string, options: { range?: DataBinding['range']; values?: Json[]; labels?: TextInput[] }): DataBindingInput;
export function bindData(state: string, options: { range?: DataBinding['range']; values?: Json[]; labels?: TextInput[] } = {}): DataBindingInput {
  const binding: DataBindingInput = { state };
  if (options.range !== undefined) binding.range = options.range;
  if (options.values !== undefined) binding.values = options.values;
  if (options.labels !== undefined) binding.labels = options.labels;
  return defineLocalizable('dataBinding', binding, (v, visit) => bindingSites(v, 'binding', '', visit)) as DataBindingInput;
}

/**
 * 0.6: builds a course from a draft whose text fields may hold LocalizedText (`{ en: '…', he: '…' }`)
 * and from separate locale bundles (for example `locales/he.json` files). The source-locale text
 * stays in the field; every other locale's text moves into `translations` under the field's text key.
 * The result is validated like defineCourse. Throws ContractValidationError (contract "course") with
 * MISSING_SOURCE_TEXT, UNDECLARED_LOCALE or DUPLICATE_TRANSLATION, or with the validation issues.
 */
export function assembleCourse(draft: CourseDraft | CourseManifest, options: { translations?: Record<string, LocaleBundle> } = {}): CourseManifest {
  const { course, issues } = assembleDraft(draft, options);
  if (issues.length) throw new ContractValidationError('course', issues);
  return defineCourse(course as CourseManifest);
}

/**
 * The data step of assembleCourse, without validating the result: moves LocalizedText into
 * `translations` and merges separate bundles. Used by the CLI for course directories.
 */
export function assembleDraft(draft: unknown, options: { translations?: Record<string, LocaleBundle> } = {}): { course: unknown; issues: ValidationIssue[] } {
  const issue = jsonIssue(draft) ?? (options.translations === undefined ? undefined : jsonIssue(options.translations));
  if (issue) return { course: draft, issues: [issue] };
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) return { course: draft, issues: [] };
  const course = structuredClone(draft) as Record<string, unknown>;
  const source = typeof course.locale === 'string' ? course.locale : '';
  const declared = Array.isArray(course.locales) ? course.locales.filter((tag): tag is string => typeof tag === 'string') : [];
  const isObject = course.translations !== null && typeof course.translations === 'object' && !Array.isArray(course.translations);
  // Malformed translations are left for validation to report.
  if (course.translations !== undefined && !isObject) return { course, issues: [] };
  const existing = isObject ? course.translations as Record<string, LocaleBundle> : {};
  const translations: Record<string, LocaleBundle> = { ...existing };
  const issues: ValidationIssue[] = [];
  for (const [tag, bundle] of Object.entries(options.translations ?? {})) {
    if (canonicalLocale(tag) !== tag) issues.push({ code: 'UNSUPPORTED_LOCALE', path: `/translations/${tag}`, message: `Bundles are named by canonical locale tags; ${JSON.stringify(tag)} is not one.` });
    else if (Object.hasOwn(translations, tag)) issues.push({ code: 'DUPLICATE_TRANSLATION', path: `/translations/${tag}`, message: `Both the course and the given bundles define ${tag}.` });
    else translations[tag] = structuredClone(bundle);
  }
  forEachTextSite(course, site => {
    const holder = site.holder as Record<string | number, unknown>;
    const value = holder[site.field];
    if (!isLocalizedText(value)) return;
    if (!Object.hasOwn(value, source)) { issues.push({ code: 'MISSING_SOURCE_TEXT', path: site.path, message: `${site.key} has no text in the source locale ${source}.` }); return; }
    holder[site.field] = value[source];
    for (const [tag, text] of Object.entries(value)) {
      if (tag === source) continue;
      if (!declared.includes(tag)) { issues.push({ code: 'UNDECLARED_LOCALE', path: site.path, message: `${site.key} has ${tag} text, but ${tag} is not listed in locales.` }); continue; }
      const bundle = translations[tag] ??= { texts: {} };
      if (bundle.texts === null || typeof bundle.texts !== 'object') continue; // malformed: validation reports it
      if (Object.hasOwn(bundle.texts, site.key))
        issues.push({ code: 'DUPLICATE_TRANSLATION', path: site.path, message: `${site.key} has ${tag} text both inline and in the ${tag} bundle.` });
      else bundle.texts[site.key] = text;
    }
  });
  if (issues.length) return { course, issues };
  if (Object.keys(translations).length) {
    // Deterministic member order: bundles in `locales` order (others after), keys sorted.
    const order = [...declared, ...Object.keys(translations).filter(tag => !declared.includes(tag)).sort()];
    course.translations = Object.fromEntries(order.filter(tag => Object.hasOwn(translations, tag)).map(tag => {
      const bundle = translations[tag]!;
      // A malformed bundle is left as is for validation to report.
      if (bundle.texts === null || typeof bundle.texts !== 'object') return [tag, bundle];
      return [tag, { ...bundle, texts: Object.fromEntries(Object.entries(bundle.texts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) }];
    }));
  }
  return { course, issues: [] };
}

/** True when any text field of `value` holds LocalizedText (it needs assembly). */
export function hasLocalizedText(value: unknown): boolean {
  let found = false;
  forEachTextSite(value, site => { found ||= isLocalizedText((site.holder as Record<string | number, unknown>)[site.field]); });
  return found;
}

/**
 * Builds a visual's four-layout set. `expanded`, the fallback for renderers without the
 * `layout_set` feature, defaults to a copy of `wide`. Validated like validateContract('visualLayouts', …).
 */
export function responsiveVariant(layouts: Omit<VisualLayouts, 'expanded' | 'tabletPortrait' | 'tabletLandscape' | 'wide'>
  & Required<Pick<VisualLayouts, 'tabletPortrait' | 'tabletLandscape' | 'wide'>> & { expanded?: VisualLayouts['expanded'] }): VisualLayouts {
  const { compact, tabletPortrait, tabletLandscape, wide, expanded } = layouts;
  return define('visualLayouts', { compact, expanded: expanded ?? structuredClone(wide), tabletPortrait, tabletLandscape, wide });
}
