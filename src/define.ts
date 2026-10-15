import type { ValidateFunction } from 'ajv';
import validators from './generated/contracts-validator.js';
import { shapeIssues } from './adaptation-shape.js';
import { standaloneChecks } from './contracts-validate.js';
import { learningPolicyIssues } from './validate.js';
import type { Assessment, Episode, ExtensionManifest, LearningPolicy, MediaResource, PlacementPolicy, ValidationIssue, VisualExperience } from './types.js';
import type {
  ActivityDefinition, AdaptationPolicy, AdminSection, AgentStrategy, Concept, CourseStage, DebugInspector, DiagnosticProbe, EvaluatorDefinition,
  LearningStep, PlatformAdapter, RendererAdapter, RendererDefinition, ResearchTask, Rubric, Scene, Storyboard, TeachingHypothesisTemplate,
  Timeline, ToolDefinition, VersionedProgressionGate,
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
  teachingHypothesis: TeachingHypothesisTemplate;
  diagnosticProbe: DiagnosticProbe;
  stage: CourseStage;
}
export type ContractKind = keyof ContractKinds;
export const CONTRACT_KINDS = Object.freeze(['concept', 'episode', 'assessment', 'activity', 'rubric', 'tool', 'adaptationPolicy', 'learningPolicy',
  'adminSection', 'learningStep', 'progressionGate', 'mediaResource', 'storyboard', 'researchTask', 'placementPolicy', 'extension', 'renderer',
  'evaluator', 'agentStrategy', 'platformAdapter', 'debugInspector', 'visualExperience', 'scene', 'timeline', 'rendererAdapter',
  'teachingHypothesis', 'diagnosticProbe', 'stage'] as const satisfies readonly ContractKind[]);

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
  mediaResource: ((value: MediaResource, path, report) => standaloneChecks.mediaSegment(value.segment, `${path}/segment`, report)) as Check,
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

function define<K extends ContractKind>(kind: K, value: ContractKinds[K]): ContractKinds[K] {
  const result = validateContract(kind, value);
  if (!result.valid) throw new ContractValidationError(kind, result.issues);
  return result.value;
}

/* Validating authoring helpers. Each throws ContractValidationError and returns a detached copy. */
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
export const defineScene = (value: Scene) => define('scene', value);
export const defineTimeline = (value: Timeline) => define('timeline', value);
export const defineRendererAdapter = (value: RendererAdapter) => define('rendererAdapter', value);
export const defineTeachingHypothesis = (value: TeachingHypothesisTemplate) => define('teachingHypothesis', value);
export const defineDiagnosticProbe = (value: DiagnosticProbe) => define('diagnosticProbe', value);
export const defineStage = (value: CourseStage) => define('stage', value);
