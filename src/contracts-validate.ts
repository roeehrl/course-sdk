import type { Assessment, CourseManifest, Episode, ExtensionManifest, LearningPolicy, ProgressionGate, ValidationIssue } from './types.js';
import type {
  ActivityDefinition, AdaptationPolicy, AdminSection, AgentStrategy, DebugInspector, DiagnosticProbe, EvaluatorDefinition,
  PlatformAdapter, RendererAdapter, RendererDefinition, Rubric, Scene, Storyboard, TeachingHypothesisTemplate, Timeline, ToolDefinition,
  VersionedProgressionGate, LearningStep, StateMigration,
} from './contracts-types.js';
import {
  ADMIN_WRITE_PERMISSIONS, DECLARATIVE_CAPABILITIES, DETERMINISTIC_TYPES, FORBIDDEN_CAPABILITIES, KNOWN_CAPABILITIES, NATIVE_TARGETS,
  PHONE_TARGETS, PRACTICAL_TYPES, RECOGNITION_TYPES, RESERVED_AUTHORITY_WORDS, RUBRIC_PRODUCTION_TYPES, platformOfTarget, targetsForPlatforms,
} from './contract-constants.js';

type Report = (code: string, path: string, message: string) => void;

export function isVersionedGate(gate: ProgressionGate): gate is VersionedProgressionGate {
  return 'version' in gate;
}
/** Objectives a gate covers, for either gate shape. */
export function gateObjectiveIds(gate: ProgressionGate): string[] {
  return isVersionedGate(gate) ? gate.requiredObjectives : gate.objectiveIds;
}
/** Assessment items that can contribute evidence to a gate, for either gate shape. */
export function gateAssessmentIds(gate: ProgressionGate): string[] {
  return isVersionedGate(gate) ? [...new Set([...(gate.interactiveCheckRefs ?? []), ...(gate.practicalTaskRefs ?? [])])] : gate.assessmentIds;
}

function duplicates(ids: string[], path: string, report: Report, label = 'ID'): void {
  const seen = new Set<string>();
  for (const [i, id] of ids.entries()) {
    if (seen.has(id)) report('DUPLICATE_ID', `${path}/${i}`, `Duplicate ${label} ${id}.`);
    seen.add(id);
  }
}
function capabilities(values: string[], path: string, report: Report): void {
  for (const [i, value] of values.entries()) {
    if (FORBIDDEN_CAPABILITIES.has(value)) report('FORBIDDEN_CAPABILITY', `${path}/${i}`, `${value} is host authority and cannot be requested by a contract.`);
    else if (!KNOWN_CAPABILITIES.has(value)) report('UNKNOWN_CAPABILITY', `${path}/${i}`, `${value} is not a declared SDK capability.`);
  }
}
function ordered(times: number[], duration: number, path: string, report: Report, what: string): void {
  let previous = -1;
  for (const [i, at] of times.entries()) {
    if (at < previous || at > duration) report('INVALID_TIMELINE', `${path}/${i}`, `${what} must be ordered and lie within the duration.`);
    previous = at;
  }
}
function reservedWords(id: string): boolean {
  return id.split(/[._:-]/).some(part => RESERVED_AUTHORITY_WORDS.has(part));
}

function stateMigrationChecks(migration: StateMigration, path: string, report: Report): void {
  if (migration.stateVersion > 1 && migration.strategy === 'none') report('STATE_MIGRATION_REQUIRED', path, 'A state version above 1 must migrate or reset with notice.');
  if (migration.migratesFrom.some(v => v >= migration.stateVersion)) report('STATE_MIGRATION_REQUIRED', `${path}/migratesFrom`, 'Migrations come from earlier state versions.');
  if (migration.strategy === 'migrate' && migration.migratesFrom.length === 0) report('STATE_MIGRATION_REQUIRED', `${path}/migratesFrom`, 'Declare the versions a migration accepts.');
}
/** Portable relative file path without traversal, as for extension entrypoints. */
export function isPortableRelativePath(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

// ------------------------------------------------------------------ standalone (context-free) checks

export const standaloneChecks = {
  rubric(rubric: Rubric, path: string, report: Report) {
    duplicates(rubric.criteria.map(c => c.id), `${path}/criteria`, report, 'criterion');
    if (!rubric.criteria.some(c => c.required)) report('RUBRIC_WITHOUT_REQUIRED_CRITERION', `${path}/criteria`, 'A rubric needs at least one required criterion.');
    if (rubric.requiresCitedEvidence && rubric.criteria.some(c => c.evidence !== 'cited_learner_span'))
      report('UNCITED_CONVERSATIONAL_RUBRIC', `${path}/criteria`, 'A rubric that requires cited evidence must cite learner spans for every criterion.');
  },
  evaluator(evaluator: EvaluatorDefinition, path: string, report: Report) {
    if (evaluator.method === 'rubric_model_assisted' && evaluator.humanConfirmation === 'none')
      report('UNCONFIRMED_MODEL_JUDGMENT', `${path}/humanConfirmation`, 'Model-assisted rubric judgments need human confirmation at least when uncertain.');
    if (evaluator.method === 'deterministic' && evaluator.itemTypes.some(t => !DETERMINISTIC_TYPES.has(t as Assessment['type'])))
      report('INVALID_EVALUATOR', `${path}/itemTypes`, 'Deterministic evaluators can only score item types with declared keys.');
  },
  tool(tool: ToolDefinition, path: string, report: Report) {
    capabilities(tool.capabilities, `${path}/capabilities`, report);
    if (tool.sideEffects === 'artifact_write' && tool.idempotency === 'non_idempotent')
      report('NON_IDEMPOTENT_SIDE_EFFECT', `${path}/idempotency`, 'Tools that write artifacts must be idempotent or take an idempotency key.');
  },
  activity(activity: ActivityDefinition, path: string, report: Report) {
    const supported = new Set(activity.supportedTargets);
    duplicates(activity.rendererRefs.map(r => r.target), `${path}/rendererRefs`, report, 'renderer target');
    for (const target of activity.supportedTargets)
      if (!activity.rendererRefs.some(r => r.target === target)) report('MISSING_RENDERER_REF', `${path}/rendererRefs`, `Supported target ${target} has no renderer.`);
    for (const [i, r] of activity.rendererRefs.entries())
      if (!supported.has(r.target)) report('UNSUPPORTED_TARGET', `${path}/rendererRefs/${i}`, 'A renderer is declared for an unsupported target.');
    for (const [i, f] of activity.equivalentFallbacks.entries()) {
      if (supported.has(f.target)) report('REDUNDANT_FALLBACK', `${path}/equivalentFallbacks/${i}`, 'Fallbacks are for targets the activity does not support.');
      if (activity.objectiveIds.some(o => !f.objectiveIds.includes(o))) report('NON_EQUIVALENT_FALLBACK', `${path}/equivalentFallbacks/${i}`, 'A fallback must support every activity objective.');
      if (f.kind === 'activity' && f.ref === activity.id) report('NON_EQUIVALENT_FALLBACK', `${path}/equivalentFallbacks/${i}`, 'An activity cannot be its own fallback.');
    }
    const caps = activity.capabilityRequirements.map(c => c.capability);
    duplicates(caps, `${path}/capabilityRequirements`, report, 'capability');
    capabilities(caps, `${path}/capabilityRequirements`, report);
    if (activity.executionAdapter === 'declarative')
      for (const [i, cap] of caps.entries()) if (!DECLARATIVE_CAPABILITIES.has(cap) && KNOWN_CAPABILITIES.has(cap))
        report('DECLARATIVE_CAPABILITY', `${path}/capabilityRequirements/${i}`, 'Declarative activities run no custom code and cannot request this capability.');
    if (activity.executionAdapter === 'bundled_native' && activity.supportedTargets.some(t => !NATIVE_TARGETS.has(t)))
      report('UNSUPPORTED_EXECUTION', `${path}/executionAdapter`, 'Bundled native execution only applies to native targets; declare web separately.');
    if (activity.executionAdapter === 'server' && activity.capabilityRequirements.some(c => c.capability === 'state.patch' && c.required))
      report('UNSUPPORTED_EXECUTION', `${path}/executionAdapter`, 'Server activities cannot patch client state directly; emit observations.');
    if (!activity.accessibleSemantics.nonPointerPath) report('INACCESSIBLE_ACTIVITY', `${path}/accessibleSemantics/nonPointerPath`, 'Dragging, colour, sound or watching cannot be the only way to complete an activity.');
    if (activity.supportedTargets.some(t => t.startsWith('web')) && !activity.accessibleSemantics.keyboard)
      report('INACCESSIBLE_ACTIVITY', `${path}/accessibleSemantics/keyboard`, 'Web targets need a keyboard path.');
    stateMigrationChecks(activity.stateMigration, `${path}/stateMigration`, report);
    if (activity.supportedTargets.some(t => PHONE_TARGETS.has(t)) && !activity.layouts.compact) report('MISSING_LAYOUT', `${path}/layouts`, 'Phone targets need a compact layout.');
    if (activity.supportedTargets.some(t => !PHONE_TARGETS.has(t)) && !activity.layouts.expanded && !activity.layouts.medium) report('MISSING_LAYOUT', `${path}/layouts`, 'Tablet and desktop targets need a medium or expanded layout.');
    for (const input of ['effective_window_bounds', 'font_scale'] as const)
      if (!activity.layoutInputs.includes(input)) report('MISSING_LAYOUT_INPUT', `${path}/layoutInputs`, `Responsive activities must respond to ${input}.`);
  },
  extension(extension: ExtensionManifest, path: string, report: Report) {
    if (extension.stateMigration) stateMigrationChecks(extension.stateMigration, `${path}/stateMigration`, report);
    if (extension.stateMigration && extension.stateMigration.stateVersion > 1 && !extension.stateSchema)
      report('STATE_MIGRATION_REQUIRED', `${path}/stateSchema`, 'Versioned extension state needs a declared state schema.');
    duplicates((extension.tests ?? []).map(t => t.id), `${path}/tests`, report, 'test');
    for (const [i, test] of (extension.tests ?? []).entries())
      if (!isPortableRelativePath(test.fixtureRef)) report('UNSAFE_FIXTURE_REF', `${path}/tests/${i}/fixtureRef`, 'Test fixtures must be portable relative paths without traversal.');
    if (extension.tests?.some(t => t.kind === 'state_migration') && !extension.stateMigration)
      report('STATE_MIGRATION_REQUIRED', `${path}/tests`, 'A state-migration test needs a declared state migration.');
  },
  adminSection(section: AdminSection, path: string, report: Report) {
    duplicates(section.settings.map(s => s.id), `${path}/settings`, report, 'setting');
    if (section.learnerDataAccess === 'scoped_with_consent' && !section.requiredPermissions.includes('learners.read_evidence'))
      report('ADMIN_PERMISSION_UNDECLARED', `${path}/requiredPermissions`, 'Learner data access requires learners.read_evidence.');
    for (const [i, setting] of section.settings.entries()) {
      const sp = `${path}/settings/${i}`;
      if (reservedWords(setting.id)) report('ADMIN_SETTING_AUTHORITY', `${sp}/id`, 'Admin settings cannot target evidence, grading, caps or policy authority.');
      if (!section.requiredPermissions.includes(setting.mutationPermission)) report('ADMIN_PERMISSION_UNDECLARED', `${sp}/mutationPermission`, 'The mutation permission must be declared by the section.');
      if (!ADMIN_WRITE_PERMISSIONS.has(setting.mutationPermission)) report('ADMIN_PERMISSION_READ_ONLY', `${sp}/mutationPermission`, 'Mutations require a write permission.');
      if ((setting.type === 'integer' || setting.type === 'number')) {
        if (setting.minimum > setting.maximum || setting.default < setting.minimum || setting.default > setting.maximum || (setting.type === 'integer' && ![setting.default, setting.minimum, setting.maximum].every(Number.isInteger)))
          report('INVALID_SETTING_DEFAULT', sp, 'Numeric settings need ordered bounds containing the default.');
      }
      if (setting.type === 'string' && setting.default.length > setting.maxLength) report('INVALID_SETTING_DEFAULT', sp, 'The default exceeds maxLength.');
      if (setting.type === 'enum' && !setting.options.includes(setting.default)) report('INVALID_SETTING_DEFAULT', sp, 'The default must be one of the options.');
    }
  },
  learningStep(step: LearningStep, path: string, report: Report) {
    if (!step.blockIds.includes(step.primaryAction.blockId)) report('INVALID_STEP', `${path}/primaryAction/blockId`, 'The primary action must target one of the step blocks.');
    if ((step.kind === 'gate') !== (step.gateId !== undefined)) report('INVALID_STEP', path, 'Gate steps, and only gate steps, reference a gate.');
    if ((step.kind === 'optional_help') !== (step.requirement === 'optional_help')) report('INVALID_STEP', path, 'Optional help steps are exactly the steps labelled optional_help.');
    if (step.nextStepId === step.id) report('STEP_CYCLE', `${path}/nextStepId`, 'A step cannot follow itself.');
  },
  storyboard(board: Storyboard, path: string, report: Report) {
    duplicates(board.frames.map(f => f.id), `${path}/frames`, report, 'frame');
    duplicates(board.script.map(s => s.id), `${path}/script`, report, 'script line');
    ordered(board.frames.map(f => f.atMs), board.durationMs, `${path}/frames`, report, 'Frames');
    ordered(board.script.map(s => s.atMs), board.durationMs, `${path}/script`, report, 'Script lines');
    if (board.kind === 'verified_vector_animation' && !board.referenceVisualId) report('MISSING_REFERENCE_COMPUTATION', path, 'Verified animations need a reference visual model.');
    if ((board.kind === 'generated_short_video' || board.kind === 'verified_vector_animation') && board.script.length === 0) report('MISSING_SCRIPT', `${path}/script`, 'Narrated media needs a script for captions and review.');
  },
  agentStrategy(strategy: AgentStrategy, path: string, report: Report) {
    const autonomy = strategy.autonomy;
    if (autonomy.level === 'propose_only' && (autonomy.mayApply.length > 0 || autonomy.maxAppliedChangesPerDay > 0))
      report('INVALID_AUTONOMY', `${path}/autonomy`, 'Propose-only strategies cannot apply changes.');
    if (autonomy.level === 'apply_verified_personal' && (autonomy.mayApply.length === 0 || autonomy.maxAppliedChangesPerDay === 0))
      report('INVALID_AUTONOMY', `${path}/autonomy`, 'Applying strategies must name operations and a positive daily limit.');
    if (autonomy.level !== 'propose_only' && strategy.roles.some(r => r === 'evaluator' || r === 'verifier'))
      report('AUTONOMY_EXCEEDS_ROLE', `${path}/autonomy/level`, 'Evaluators and verifiers propose judgments; they never apply changes.');
    if (strategy.toolRefs.length > 0 && strategy.budget.maxToolCalls === 0) report('EMPTY_BUDGET', `${path}/budget/maxToolCalls`, 'A strategy with tools needs a positive tool-call budget.');
    duplicates(strategy.toolRefs, `${path}/toolRefs`, report, 'tool');
  },
  platformAdapter(adapter: PlatformAdapter, path: string, report: Report) {
    capabilities(adapter.providesCapabilities, `${path}/providesCapabilities`, report);
    if (adapter.kind === 'native_module' && (!adapter.requiresAppBuild || !NATIVE_TARGETS.has(adapter.target)))
      report('NATIVE_REQUIRES_BUILD', path, 'Native modules target native apps and require a reviewed app build; content cannot load them dynamically.');
    if (adapter.kind === 'web_island' && !adapter.target.startsWith('web')) report('UNSUPPORTED_EXECUTION', `${path}/target`, 'Web islands only run on web targets.');
  },
  debugInspector(inspector: DebugInspector, path: string, report: Report) {
    if (!inspector.requiredPermissions.includes('debug.read')) report('DEBUG_PERMISSION_REQUIRED', `${path}/requiredPermissions`, 'Inspectors require debug.read.');
    if (inspector.payloadAccess === 'payload_with_audit' && !inspector.requiredPermissions.includes('debug.payload'))
      report('DEBUG_PERMISSION_REQUIRED', `${path}/requiredPermissions`, 'Payload access requires debug.payload and an audited reveal.');
    if (inspector.replay.allowed !== inspector.views.includes('safe_replay')) report('INVALID_REPLAY', `${path}/replay`, 'Declare safe_replay exactly when replay is allowed.');
  },
  rendererAdapter(adapter: RendererAdapter, path: string, report: Report) {
    duplicates(adapter.fallbacks.map(f => f.feature), `${path}/fallbacks`, report, 'fallback feature');
    for (const [i, f] of adapter.fallbacks.entries())
      if (adapter.supportedFeatures.includes(f.feature)) report('REDUNDANT_FALLBACK', `${path}/fallbacks/${i}`, 'A supported feature needs no fallback.');
  },
  scene(scene: Scene, path: string, report: Report) {
    duplicates(scene.layers.map(l => l.id), `${path}/layers`, report, 'layer');
    duplicates(scene.semanticNodes.map(n => n.id), `${path}/semanticNodes`, report, 'semantic node');
    duplicates(scene.assets.map(a => a.id), `${path}/assets`, report, 'asset');
    const nodes = new Set(scene.semanticNodes.map(n => n.id)), assets = new Set(scene.assets.map(a => a.id));
    for (const [i, layer] of scene.layers.entries()) {
      for (const node of layer.semanticNodeIds) if (!nodes.has(node)) report('MISSING_REFERENCE', `${path}/layers/${i}/semanticNodeIds`, `Unknown semantic node ${node}.`);
      if (layer.assetRef !== undefined && !assets.has(layer.assetRef)) report('MISSING_REFERENCE', `${path}/layers/${i}/assetRef`, `Unknown asset ${layer.assetRef}.`);
      if (!layer.decorative && layer.semanticNodeIds.length === 0) report('INACCESSIBLE_SCENE', `${path}/layers/${i}`, 'Meaningful layers need semantic nodes for the accessible tree.');
    }
  },
  timeline(timeline: Timeline, path: string, report: Report) {
    duplicates(timeline.tracks.map(t => t.id), `${path}/tracks`, report, 'track');
    for (const [i, track] of timeline.tracks.entries()) ordered(track.keyframes.map(k => k.atMs), timeline.durationMs, `${path}/tracks/${i}/keyframes`, report, 'Keyframes');
    ordered(timeline.cues.map(c => c.atMs), timeline.durationMs, `${path}/cues`, report, 'Cues');
  },
  hypothesis(hypothesis: TeachingHypothesisTemplate, path: string, report: Report) {
    if ((hypothesis.kind === 'missing_prerequisite') !== (hypothesis.prerequisiteObjectiveId !== undefined))
      report('INVALID_HYPOTHESIS', path, 'Missing-prerequisite hypotheses, and only those, name the prerequisite objective.');
    if (hypothesis.critical && hypothesis.kind !== 'misconception') report('INVALID_HYPOTHESIS', `${path}/critical`, 'Only misconceptions can be critical.');
  },
  probe(probe: DiagnosticProbe, path: string, report: Report) {
    for (const [i, signal] of probe.signals.entries())
      if (!probe.distinguishes.includes(signal.hypothesisId)) report('INVALID_PROBE', `${path}/signals/${i}`, 'A signal must point at a hypothesis the probe distinguishes.');
  },
  gate(gate: VersionedProgressionGate, path: string, report: Report) {
    duplicates(gate.readinessCriteria.map(c => c.id), `${path}/readinessCriteria`, report, 'criterion');
    for (const [i, c] of gate.readinessCriteria.entries())
      if (c.objectiveIds.some(o => !gate.requiredObjectives.includes(o))) report('GATE_SCOPE_MISMATCH', `${path}/readinessCriteria/${i}`, 'Criteria may only reference the gate objectives.');
    const kinds = new Set(gate.readinessCriteria.map(c => c.kind));
    if (!kinds.has('transfer_success')) report('MISSING_TRANSFER_CRITERION', `${path}/readinessCriteria`, 'Readiness needs an independent transfer success; recognition alone cannot pass.');
    if (!kinds.has('independent_success')) report('MISSING_INDEPENDENT_CRITERION', `${path}/readinessCriteria`, 'Readiness needs independent success in the declared families.');
    const modes = new Set(gate.eligibleEvidenceKinds);
    const has = { conversation: gate.conversationalRubricRef !== undefined, interactive: (gate.interactiveCheckRefs?.length ?? 0) > 0, practical: (gate.practicalTaskRefs?.length ?? 0) > 0 };
    const pairs = [['rubric_backed_conversation', has.conversation, 'conversationalRubricRef'], ['deterministic_interactive_check', has.interactive, 'interactiveCheckRefs'],
      ['verified_practical_task', has.practical, 'practicalTaskRefs']] as const;
    for (const [mode, present, field] of pairs) {
      if (modes.has(mode) && !present) report('INVALID_EVIDENCE_MODE', `${path}/${field}`, `${mode} requires ${field}.`);
      if (!modes.has(mode) && present && !modes.has('configured_combination')) report('INVALID_EVIDENCE_MODE', `${path}/${field}`, `${field} is only eligible when ${mode} is declared.`);
    }
    if (modes.has('configured_combination') && [has.conversation, has.interactive, has.practical].filter(Boolean).length < 2)
      report('INVALID_EVIDENCE_MODE', `${path}/eligibleEvidenceKinds`, 'A configured combination needs at least two evidence paths.');
    if (kinds.has('rubric_criteria') && !has.conversation) report('INVALID_EVIDENCE_MODE', `${path}/readinessCriteria`, 'Rubric criteria need a conversational rubric.');
    if (kinds.has('practical_task') && !has.practical) report('INVALID_EVIDENCE_MODE', `${path}/readinessCriteria`, 'A practical-task criterion needs practical task references.');
    if (gate.appealPolicy.allowed && gate.appealPolicy.windowDays === undefined) report('INVALID_APPEAL_POLICY', `${path}/appealPolicy`, 'Allowed appeals need a window.');
  },
  mediaSegment(segment: { startSeconds: number; endSeconds: number } | undefined, path: string, report: Report) {
    if (segment && segment.startSeconds >= segment.endSeconds) report('INVALID_SEGMENT', path, 'A segment must end after it starts.');
  },
  assessment(item: Assessment, path: string, report: Report) {
    if (item.role === 'transfer' && RECOGNITION_TYPES.has(item.type)) report('TRANSFER_REQUIRES_PRODUCTION', `${path}/role`, 'A recognition item cannot establish transfer.');
    if (item.type === 'choice') {
      const correct = item.options.find(o => o.id === item.grading.correctOptionId);
      if (correct?.misconceptionId !== undefined) report('INVALID_ANSWER_KEY', `${path}/grading`, 'The correct option cannot signal a misconception.');
    }
    if (item.type === 'trace') {
      duplicates(item.steps.map(s => s.id), `${path}/steps`, report, 'step');
      const expected = item.grading.expected.map(e => e.stepId);
      duplicates(expected, `${path}/grading/expected`, report, 'step key');
      if (expected.length !== item.steps.length || item.steps.some(s => !expected.includes(s.id))) report('INVALID_ANSWER_KEY', `${path}/grading/expected`, 'Every trace step needs exactly one key.');
    }
  },
};

export type StandaloneKind = keyof typeof standaloneChecks;

// ------------------------------------------------------------------ course-level references

/** Cross-reference checks for every 0.5 section and versioned gate. Legacy data is untouched. */
export function contractIssues(course: CourseManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report: Report = (code, path, message) => issues.push({ code, path, message });
  const byId = <T extends { id: string }>(items: T[] | undefined, path: string): Map<string, T> => {
    const result = new Map<string, T>();
    for (const [i, item] of (items ?? []).entries()) {
      if (result.has(item.id)) report('DUPLICATE_ID', `${path}/${i}/id`, `Duplicate ID ${item.id}.`);
      result.set(item.id, item);
    }
    return result;
  };
  const refs = (ids: string[], target: Map<string, unknown> | Set<string>, path: string) => {
    for (const [i, id] of ids.entries()) if (!target.has(id)) report('MISSING_REFERENCE', `${path}/${i}`, `Unknown reference ${id}.`);
  };
  const ref = (id: string | undefined, target: Map<string, unknown> | Set<string>, path: string) => {
    if (id !== undefined && !target.has(id)) report('MISSING_REFERENCE', path, `Unknown reference ${id}.`);
  };
  const objectives = new Map(course.objectives.map(o => [o.id, o]));
  const chapters = new Map(course.chapters.map(c => [c.id, c]));
  const episodes = new Map<string, Episode>(), chapterOf = new Map<string, string>();
  for (const c of course.chapters) for (const e of c.episodes) { episodes.set(e.id, e); chapterOf.set(e.id, c.id); }
  const textBlocks = new Set(course.chapters.flatMap(c => c.episodes.flatMap(e => e.blocks.filter(b => b.type === 'text').map(b => b.id))));
  const assessments = new Map(course.assessments.map(a => [a.id, a]));
  const extensions = new Map(course.extensions.map(e => [e.id, e]));
  const visuals = new Map(course.visuals.map(v => [v.id, v]));
  const sources = new Map(course.sources.map(s => [s.id, s]));
  const gates = new Map(course.gates.map(g => [g.id, g]));
  const stages = byId(course.stages, '/stages');
  const concepts = byId(course.concepts, '/concepts');
  const hypotheses = byId(course.hypotheses, '/hypotheses');
  const probes = byId(course.probes, '/probes');
  const rubrics = byId(course.rubrics, '/rubrics');
  const evaluators = byId(course.evaluators, '/evaluators');
  const tools = byId(course.tools, '/tools');
  const adaptationPolicies = byId(course.adaptationPolicies, '/adaptationPolicies');
  const activities = byId(course.activities, '/activities');
  byId(course.adminSections, '/adminSections');
  const steps = byId(course.learningSteps, '/learningSteps');
  byId(course.researchTasks, '/researchTasks');
  byId(course.storyboards, '/storyboards');
  const strategies = byId(course.agentStrategies, '/agentStrategies');
  const platformAdapters = byId(course.platformAdapters, '/platformAdapters');
  byId(course.debugInspectors, '/debugInspectors');
  const renderers = byId(course.renderers, '/renderers');
  byId(course.rendererAdapters, '/rendererAdapters');
  const scenes = byId(course.scenes, '/scenes');
  byId(course.timelines, '/timelines');
  for (const [i, e] of (course.evaluators ?? []).entries())
    if (extensions.has(e.id)) report('DUPLICATE_ID', `/evaluators/${i}/id`, 'Evaluator IDs share a namespace with extensions.');

  const courseTargets = targetsForPlatforms(course.platforms);
  const ancestorsOf = (objectiveId: string): Set<string> => {
    const seen = new Set<string>(); const stack = [...(objectives.get(objectiveId)?.prerequisites ?? [])];
    while (stack.length) { const next = stack.pop()!; if (seen.has(next)) continue; seen.add(next); stack.push(...(objectives.get(next)?.prerequisites ?? [])); }
    return seen;
  };
  const serverEvaluatorExtension = (extensionId: string) => {
    const ext = extensions.get(extensionId);
    return ext !== undefined && ext.execution === 'server' && ext.capabilities.includes('assessment.evaluate');
  };
  /** Evaluator IDs resolve to a 0.5 evaluator definition or, for compatibility, a server extension. */
  const evaluatorRef = (id: string, path: string, itemType?: string, requireDefinition = false) => {
    const definition = evaluators.get(id);
    if (definition) {
      if (itemType && !definition.itemTypes.includes(itemType)) report('INVALID_EVALUATOR', path, `Evaluator ${id} does not declare ${itemType} items.`);
    } else if (requireDefinition) report('MISSING_REFERENCE', path, `Unknown evaluator definition ${id}.`);
    else if (!extensions.has(id)) report('MISSING_REFERENCE', path, `Unknown evaluator ${id}.`);
    else if (!serverEvaluatorExtension(id)) report('INVALID_EVALUATOR', path, 'Evaluators need a declared server extension with assessment.evaluate capability.');
  };

  // chapters, stages, media
  for (const [i, chapter] of course.chapters.entries()) ref(chapter.stageId, stages, `/chapters/${i}/stageId`);
  for (const [i, media] of course.media.entries()) {
    standaloneChecks.mediaSegment(media.segment, `/media/${i}/segment`, report);
    if (media.segment && media.review !== 'reviewed') report('UNREVIEWED_SEGMENT', `/media/${i}/segment`, 'Only reviewed media can declare an inspected segment.');
  }
  for (const [i, ext] of course.extensions.entries()) {
    standaloneChecks.extension(ext, `/extensions/${i}`, report);
    if (ext.evaluatorRef !== undefined) evaluatorRef(ext.evaluatorRef, `/extensions/${i}/evaluatorRef`);
  }

  // concepts
  for (const [i, concept] of (course.concepts ?? []).entries()) {
    refs(concept.objectiveIds, objectives, `/concepts/${i}/objectiveIds`);
    refs(concept.prerequisiteConceptIds, concepts, `/concepts/${i}/prerequisiteConceptIds`);
  }
  if (course.concepts) {
    const state = new Map<string, 1 | 2>(); let cyclic = false;
    const visit = (id: string): void => {
      if (state.get(id) === 2 || cyclic) return;
      if (state.get(id) === 1) { cyclic = true; return; }
      state.set(id, 1);
      for (const next of concepts.get(id)?.prerequisiteConceptIds ?? []) if (concepts.has(next)) visit(next);
      state.set(id, 2);
    };
    for (const id of concepts.keys()) visit(id);
    if (cyclic) report('CONCEPT_CYCLE', '/concepts', 'Concept prerequisites must form an acyclic graph.');
  }

  // hypotheses and probes
  const probeItems = new Set((course.probes ?? []).map(p => p.assessmentId));
  for (const [i, h] of (course.hypotheses ?? []).entries()) {
    const path = `/hypotheses/${i}`;
    standaloneChecks.hypothesis(h, path, report);
    refs(h.objectiveIds, objectives, `${path}/objectiveIds`);
    if (h.prerequisiteObjectiveId !== undefined) {
      ref(h.prerequisiteObjectiveId, objectives, `${path}/prerequisiteObjectiveId`);
      if (objectives.has(h.prerequisiteObjectiveId) && !h.objectiveIds.some(o => ancestorsOf(o).has(h.prerequisiteObjectiveId!)))
        report('INVALID_HYPOTHESIS', `${path}/prerequisiteObjectiveId`, 'The missing prerequisite must be a declared prerequisite of the objective.');
    }
    if (h.kind !== 'useful_analogy' && !(course.probes ?? []).some(p => p.distinguishes.includes(h.id)))
      report('UNPROBED_HYPOTHESIS', path, 'Each competing hypothesis needs a diagnostic probe that can distinguish it.');
  }
  for (const objectiveId of new Set((course.hypotheses ?? []).filter(h => h.kind !== 'useful_analogy').flatMap(h => h.objectiveIds)))
    if (objectives.has(objectiveId) && !(course.probes ?? []).some(p => p.objectiveId === objectiveId))
      report('MISSING_DIAGNOSTIC_PROBE', '/probes', `Objective ${objectiveId} has hypotheses but no diagnostic probe.`);
  for (const [i, probe] of (course.probes ?? []).entries()) {
    const path = `/probes/${i}`;
    standaloneChecks.probe(probe, path, report);
    ref(probe.objectiveId, objectives, `${path}/objectiveId`);
    ref(probe.assessmentId, assessments, `${path}/assessmentId`);
    refs(probe.distinguishes, hypotheses, `${path}/distinguishes`);
    const item = assessments.get(probe.assessmentId);
    if (item && !item.objectiveIds.includes(probe.objectiveId)) report('PROBE_SCOPE_MISMATCH', `${path}/assessmentId`, 'The probe item must cover the probe objective.');
    if (item && item.role !== undefined && item.role !== 'diagnostic_probe') report('PROBE_SCOPE_MISMATCH', `${path}/assessmentId`, 'Probe items are diagnostic, not credited items.');
    for (const id of probe.distinguishes) {
      const h = hypotheses.get(id);
      if (h && !h.objectiveIds.includes(probe.objectiveId)) report('PROBE_SCOPE_MISMATCH', `${path}/distinguishes`, `Hypothesis ${id} does not concern ${probe.objectiveId}.`);
    }
    for (const [j, signal] of probe.signals.entries()) if ('optionIds' in signal) {
      if (item?.type !== 'choice') report('INVALID_PROBE', `${path}/signals/${j}`, 'Option signals require a choice probe item.');
      else for (const option of signal.optionIds) if (!item.options.some(o => o.id === option)) report('MISSING_REFERENCE', `${path}/signals/${j}/optionIds`, `Unknown option ${option}.`);
    }
  }

  // rubrics, evaluators, assessments
  for (const [i, rubric] of (course.rubrics ?? []).entries()) standaloneChecks.rubric(rubric, `/rubrics/${i}`, report);
  for (const [i, e] of (course.evaluators ?? []).entries()) {
    const path = `/evaluators/${i}`;
    standaloneChecks.evaluator(e, path, report);
    if (!extensions.has(e.extensionId)) report('MISSING_REFERENCE', `${path}/extensionId`, `Unknown extension ${e.extensionId}.`);
    else if (!serverEvaluatorExtension(e.extensionId)) report('INVALID_EVALUATOR', `${path}/extensionId`, 'Evaluators need a server extension with assessment.evaluate.');
    refs(e.rubricIds ?? [], rubrics, `${path}/rubricIds`);
  }
  for (const [i, item] of course.assessments.entries()) {
    const path = `/assessments/${i}`;
    standaloneChecks.assessment(item, path, report);
    refs(item.misconceptionIds ?? [], hypotheses, `${path}/misconceptionIds`);
    if (item.type === 'choice') for (const [j, option] of item.options.entries()) ref(option.misconceptionId, hypotheses, `${path}/options/${j}/misconceptionId`);
    if (item.type === 'code_repair') evaluatorRef(item.grading.evaluatorId, `${path}/grading/evaluatorId`, item.type);
    if (item.type === 'prediction' && item.observationRef !== undefined && !activities.has(item.observationRef) && !visuals.has(item.observationRef))
      report('MISSING_REFERENCE', `${path}/observationRef`, 'A prediction observes a declared activity or visual.');
    if (item.type === 'counterexample' || item.type === 'experiment_design' || item.type === 'teach_back') {
      evaluatorRef(item.grading.evaluatorId, `${path}/grading/evaluatorId`, item.type, true);
      ref(item.grading.rubricId, rubrics, `${path}/grading/rubricId`);
      const declared = evaluators.get(item.grading.evaluatorId)?.rubricIds;
      if (declared && !declared.includes(item.grading.rubricId)) report('INVALID_EVALUATOR', `${path}/grading/rubricId`, 'The evaluator does not declare this rubric.');
    }
  }
  for (const [i, gate] of course.gates.entries()) {
    const items = gateAssessmentIds(gate);
    for (const id of items) if (probeItems.has(id) || assessments.get(id)?.role === 'diagnostic_probe')
      report('PROBE_AS_GATE_EVIDENCE', `/gates/${i}`, `${id} is a diagnostic probe; probes never grant mastery.`);
  }

  // tools, policies, strategies
  for (const [i, tool] of (course.tools ?? []).entries()) {
    standaloneChecks.tool(tool, `/tools/${i}`, report);
    if (tool.extensionId !== undefined) {
      const ext = extensions.get(tool.extensionId);
      if (!ext) report('MISSING_REFERENCE', `/tools/${i}/extensionId`, `Unknown extension ${tool.extensionId}.`);
      else if (ext.execution !== 'server') report('INVALID_TOOL', `/tools/${i}/extensionId`, 'Tools run in a server extension or sandbox, never in learner clients.');
    }
  }
  const coursePolicy = course.policy;
  for (const [i, policy] of (course.adaptationPolicies ?? []).entries()) {
    const cap = coursePolicy.work?.remediationCyclesPerConcept;
    if (coursePolicy.mode === 'bounded' && cap !== undefined && policy.maxCyclesPerConcept > cap)
      report('CAP_EXCEEDED', `/adaptationPolicies/${i}/maxCyclesPerConcept`, 'A remediation policy cannot exceed the course remediation cap.');
    if (policy.onExhausted === 'offer_extension' && !coursePolicy.extensions?.enabled)
      report('EXTENSIONS_DISABLED', `/adaptationPolicies/${i}/onExhausted`, 'Extension offers require enabled course extensions.');
  }
  const permittedOperations = new Set<string>(course.adaptation ? ['suggest_profile_correction', ...course.adaptation.targets.flatMap(t => t.allowedOperations)] : []);
  for (const [i, strategy] of (course.agentStrategies ?? []).entries()) {
    const path = `/agentStrategies/${i}`;
    standaloneChecks.agentStrategy(strategy, path, report);
    refs(strategy.toolRefs, tools, `${path}/toolRefs`);
    for (const [j, op] of strategy.autonomy.mayApply.entries())
      if (!permittedOperations.has(op)) report('ADAPTATION_DISABLED', `${path}/autonomy/mayApply/${j}`, `${op} is not permitted by the course adaptation rules.`);
    if (strategy.roles.includes('researcher')) for (const toolId of strategy.toolRefs)
      if (tools.get(toolId)?.sideEffects === 'artifact_write') report('AUTONOMY_EXCEEDS_ROLE', `${path}/toolRefs`, 'Research strategies propose sources; they cannot write artifacts.');
  }

  // renderers, platform adapters, activities
  for (const [i, renderer] of (course.renderers ?? []).entries()) {
    const ext = extensions.get(renderer.extensionId);
    if (!ext) report('MISSING_REFERENCE', `/renderers/${i}/extensionId`, `Unknown extension ${renderer.extensionId}.`);
    else {
      if (ext.execution === 'server') report('INVALID_RENDERER', `/renderers/${i}/extensionId`, 'Renderers run on clients, not in server extensions.');
      if (renderer.targets.some(t => !ext.platforms.includes(platformOfTarget(t)))) report('UNSUPPORTED_PLATFORM', `/renderers/${i}/targets`, 'The renderer extension lacks a declared platform.');
    }
  }
  for (const [i, adapter] of (course.rendererAdapters ?? []).entries()) {
    const path = `/rendererAdapters/${i}`;
    standaloneChecks.rendererAdapter(adapter, path, report);
    const renderer = renderers.get(adapter.rendererId);
    if (!renderer) { report('MISSING_REFERENCE', `${path}/rendererId`, `Unknown renderer ${adapter.rendererId}.`); continue; }
    if (!renderer.targets.includes(adapter.target)) report('UNSUPPORTED_PLATFORM', `${path}/target`, 'The renderer does not declare this target.');
    for (const feature of renderer.features)
      if (!adapter.supportedFeatures.includes(feature) && !adapter.fallbacks.some(f => f.feature === feature))
        report('UNSUPPORTED_FEATURE_WITHOUT_FALLBACK', `${path}/supportedFeatures`, `${feature} needs support or a tested equivalent.`);
  }
  for (const [i, adapter] of (course.platformAdapters ?? []).entries()) standaloneChecks.platformAdapter(adapter, `/platformAdapters/${i}`, report);
  const rendererFor = (rendererId: string, target: string, surface: RendererDefinition['surface']): string | undefined => {
    const renderer = renderers.get(rendererId);
    if (renderer) return renderer.surface !== surface ? 'INVALID_RENDERER_SURFACE' : renderer.targets.includes(target as never) ? undefined : 'UNSUPPORTED_PLATFORM';
    const ext = extensions.get(rendererId);
    if (!ext) return 'MISSING_REFERENCE';
    if (ext.execution === 'server') return 'INVALID_RENDERER';
    return ext.platforms.includes(platformOfTarget(target as never)) ? undefined : 'UNSUPPORTED_PLATFORM';
  };
  for (const [i, activity] of (course.activities ?? []).entries()) {
    const path = `/activities/${i}`;
    standaloneChecks.activity(activity, path, report);
    refs(activity.objectiveIds, objectives, `${path}/objectiveIds`);
    for (const [j, r] of activity.rendererRefs.entries()) {
      const code = rendererFor(r.rendererId, r.target, 'learner_activity');
      if (code) report(code, `${path}/rendererRefs/${j}`, `Renderer ${r.rendererId} cannot render this activity on ${r.target}.`);
    }
    for (const target of courseTargets) if (!activity.supportedTargets.includes(target) && !activity.equivalentFallbacks.some(f => f.target === target))
      report('UNSUPPORTED_TARGET_WITHOUT_FALLBACK', `${path}/supportedTargets`, `Declared course target ${target} needs support or an objective-equivalent fallback.`);
    for (const [j, f] of activity.equivalentFallbacks.entries()) {
      const fp = `${path}/equivalentFallbacks/${j}`;
      const covered = f.kind === 'activity' ? activities.get(f.ref)?.objectiveIds : f.kind === 'assessment' ? assessments.get(f.ref)?.objectiveIds : undefined;
      if (f.kind === 'text_block' ? !textBlocks.has(f.ref) : covered === undefined) report('MISSING_REFERENCE', `${fp}/ref`, `Unknown ${f.kind} ${f.ref}.`);
      else if (covered && f.objectiveIds.some(o => !covered.includes(o))) report('NON_EQUIVALENT_FALLBACK', fp, 'The fallback does not cover its declared objectives.');
      if (f.kind === 'activity' && activities.get(f.ref) && !activities.get(f.ref)!.supportedTargets.includes(f.target))
        report('NON_EQUIVALENT_FALLBACK', fp, 'A fallback activity must support the fallback target.');
    }
    if (activity.evaluatorRef !== undefined) evaluatorRef(activity.evaluatorRef, `${path}/evaluatorRef`);
    if (activity.executionAdapter === 'bundled_native') {
      const required = activity.capabilityRequirements.filter(c => c.required).map(c => c.capability);
      for (const target of activity.supportedTargets) {
        const modules = (course.platformAdapters ?? []).filter(a => a.target === target && a.kind === 'native_module');
        if (!modules.some(m => required.every(c => m.providesCapabilities.includes(c))))
          report('NATIVE_MODULE_REQUIRED', `${path}/executionAdapter`, `${target} needs a declared native module providing the required capabilities.`);
      }
    }
  }
  for (const [ci, chapter] of course.chapters.entries()) for (const [ei, episode] of chapter.episodes.entries()) for (const [bi, block] of episode.blocks.entries()) {
    if (block.type !== 'activity' || !('activityId' in block)) continue;
    const path = `/chapters/${ci}/episodes/${ei}/blocks/${bi}/activityId`;
    const activity = activities.get(block.activityId);
    if (!activity) report('MISSING_REFERENCE', path, `Unknown activity ${block.activityId}.`);
    else if (!activity.objectiveIds.some(o => episode.objectiveIds.includes(o))) report('ACTIVITY_SCOPE_MISMATCH', path, 'The activity must teach an objective of its episode.');
  }

  // admin, steps, research, storyboards, inspectors, scenes, timelines
  for (const [i, section] of (course.adminSections ?? []).entries()) {
    standaloneChecks.adminSection(section, `/adminSections/${i}`, report);
    if (section.rendererRef !== undefined) {
      const renderer = renderers.get(section.rendererRef);
      if (!renderer) report('MISSING_REFERENCE', `/adminSections/${i}/rendererRef`, `Unknown renderer ${section.rendererRef}.`);
      else if (renderer.surface !== 'admin') report('INVALID_RENDERER_SURFACE', `/adminSections/${i}/rendererRef`, 'Admin sections use admin renderers.');
    }
  }
  for (const [i, step] of (course.learningSteps ?? []).entries()) {
    const path = `/learningSteps/${i}`;
    standaloneChecks.learningStep(step, path, report);
    const episode = episodes.get(step.episodeId);
    if (!episode) report('MISSING_REFERENCE', `${path}/episodeId`, `Unknown episode ${step.episodeId}.`);
    else for (const [j, blockId] of step.blockIds.entries()) if (!episode.blocks.some(b => b.id === blockId)) report('STEP_SCOPE_MISMATCH', `${path}/blockIds/${j}`, `Block ${blockId} is not in episode ${episode.id}.`);
    if (step.nextStepId !== null) ref(step.nextStepId, steps, `${path}/nextStepId`);
    ref(step.gateId, gates, `${path}/gateId`);
  }
  for (const [i, step] of (course.learningSteps ?? []).entries()) {
    const seen = new Set<string>(); let cursor: string | null = step.id;
    while (cursor !== null && steps.has(cursor)) {
      if (seen.has(cursor)) { report('STEP_CYCLE', `/learningSteps/${i}/nextStepId`, 'Learning step sequences must end.'); break; }
      seen.add(cursor); cursor = steps.get(cursor)!.nextStepId;
    }
  }
  const topics = new Map((course.research?.publicTopics ?? []).map(t => [t.id, t]));
  for (const [i, task] of (course.researchTasks ?? []).entries()) {
    const path = `/researchTasks/${i}`;
    refs(task.objectiveIds, objectives, `${path}/objectiveIds`);
    refs(task.publicTopicIds, topics, `${path}/publicTopicIds`);
    for (const topicId of task.publicTopicIds) {
      const topic = topics.get(topicId); if (!topic) continue;
      if (!topic.objectiveIds.some(o => task.objectiveIds.includes(o))) report('RESEARCH_SCOPE_MISMATCH', `${path}/publicTopicIds`, `Topic ${topicId} does not concern the task objectives.`);
      if (topic.allowedDomains && (!task.sourcePolicy.allowedDomains || task.sourcePolicy.allowedDomains.some(d => !topic.allowedDomains!.includes(d))))
        report('RESEARCH_DOMAIN_WIDENED', `${path}/sourcePolicy/allowedDomains`, 'A task cannot widen an author-reviewed topic domain allowlist.');
    }
  }
  for (const [i, board] of (course.storyboards ?? []).entries()) {
    const path = `/storyboards/${i}`;
    standaloneChecks.storyboard(board, path, report);
    refs(board.objectiveIds, objectives, `${path}/objectiveIds`);
    refs(board.sourceRefs, sources, `${path}/sourceRefs`);
    ref(board.referenceVisualId, visuals, `${path}/referenceVisualId`);
    for (const [j, frame] of board.frames.entries()) {
      ref(frame.visualId, visuals, `${path}/frames/${j}/visualId`);
      const checks = visuals.get(frame.visualId ?? board.referenceVisualId ?? '')?.referenceChecks ?? [];
      for (const check of frame.referenceCheckIds ?? []) if (!checks.includes(check)) report('MISSING_REFERENCE', `${path}/frames/${j}/referenceCheckIds`, `Unknown reference check ${check}.`);
    }
    const eq = board.accessibleEquivalent;
    const target = eq.kind === 'text_block' ? textBlocks : eq.kind === 'visual' ? visuals : activities;
    ref(eq.ref, target, `${path}/accessibleEquivalent/ref`);
  }
  const subjects: Record<DebugInspector['subjects'][number]['kind'], Map<string, unknown>> = {
    activity: activities, visual: visuals, evaluator: evaluators, agent_strategy: strategies, gate: gates, tool: tools,
  };
  for (const [i, inspector] of (course.debugInspectors ?? []).entries()) {
    const path = `/debugInspectors/${i}`;
    standaloneChecks.debugInspector(inspector, path, report);
    for (const [j, subject] of inspector.subjects.entries()) ref(subject.ref, subjects[subject.kind], `${path}/subjects/${j}/ref`);
    if (inspector.rendererRef !== undefined) {
      const renderer = renderers.get(inspector.rendererRef);
      if (!renderer) report('MISSING_REFERENCE', `${path}/rendererRef`, `Unknown renderer ${inspector.rendererRef}.`);
      else if (renderer.surface !== 'inspector') report('INVALID_RENDERER_SURFACE', `${path}/rendererRef`, 'Inspectors use inspector renderers.');
    }
  }
  for (const [i, scene] of (course.scenes ?? []).entries()) {
    standaloneChecks.scene(scene, `/scenes/${i}`, report);
    for (const [j, asset] of scene.assets.entries()) ref(asset.sourceRef, sources, `/scenes/${i}/assets/${j}/sourceRef`);
  }
  for (const [i, timeline] of (course.timelines ?? []).entries()) {
    standaloneChecks.timeline(timeline, `/timelines/${i}`, report);
    const scene = scenes.get(timeline.sceneId);
    if (!scene) { report('MISSING_REFERENCE', `/timelines/${i}/sceneId`, `Unknown scene ${timeline.sceneId}.`); continue; }
    for (const [j, track] of timeline.tracks.entries()) if (!scene.layers.some(l => l.id === track.layerId))
      report('MISSING_REFERENCE', `/timelines/${i}/tracks/${j}/layerId`, `Unknown layer ${track.layerId}.`);
  }

  // versioned gates
  const policyAt = (scopeRef: string): LearningPolicy | undefined => {
    if (scopeRef === 'course') return course.policy;
    const [kind, id] = [scopeRef.slice(0, scopeRef.indexOf(':')), scopeRef.slice(scopeRef.indexOf(':') + 1)];
    return kind === 'chapter' ? chapters.get(id)?.policy : episodes.get(id)?.policy;
  };
  for (const [i, gate] of course.gates.entries()) {
    if (!isVersionedGate(gate)) continue;
    const path = `/gates/${i}`;
    standaloneChecks.gate(gate, path, report);
    refs(gate.requiredObjectives, objectives, `${path}/requiredObjectives`);
    for (const [j, c] of gate.readinessCriteria.entries()) refs(c.objectiveIds, objectives, `${path}/readinessCriteria/${j}/objectiveIds`);
    if (gate.scope.kind === 'chapter') ref(gate.scope.chapterId, chapters, `${path}/scope/chapterId`);
    if (gate.scope.kind === 'episode') ref(gate.scope.episodeId, episodes, `${path}/scope/episodeId`);
    ref(gate.remediationPolicyRef, adaptationPolicies, `${path}/remediationPolicyRef`);
    if (gate.nextActivityId !== null && !episodes.has(gate.nextActivityId) && !steps.has(gate.nextActivityId) && !activities.has(gate.nextActivityId))
      report('MISSING_REFERENCE', `${path}/nextActivityId`, `Unknown next activity ${gate.nextActivityId}.`);
    if (!policyAt(gate.capPolicyRef)) report('CAP_POLICY_NOT_DECLARED', `${path}/capPolicyRef`, 'The cap policy reference must name a scope that declares a policy.');
    else {
      const scopeRefs = gate.scope.kind === 'course' ? ['course'] : gate.scope.kind === 'chapter' ? [`chapter:${gate.scope.chapterId}`, 'course']
        : [`episode:${gate.scope.episodeId}`, `chapter:${chapterOf.get(gate.scope.episodeId)}`, 'course'];
      if (!scopeRefs.includes(gate.capPolicyRef)) report('CAP_SCOPE_MISMATCH', `${path}/capPolicyRef`, 'The cap policy must apply to the gate scope or an ancestor.');
    }
    if (gate.conversationalRubricRef !== undefined) {
      const rubric = rubrics.get(gate.conversationalRubricRef);
      if (!rubric) report('MISSING_REFERENCE', `${path}/conversationalRubricRef`, `Unknown rubric ${gate.conversationalRubricRef}.`);
      else if (!rubric.requiresCitedEvidence) report('UNCITED_CONVERSATIONAL_RUBRIC', `${path}/conversationalRubricRef`, 'Conversational evidence must cite the learner; a model impression is not evidence.');
    }
    refs(gate.interactiveCheckRefs ?? [], assessments, `${path}/interactiveCheckRefs`);
    for (const [j, id] of (gate.interactiveCheckRefs ?? []).entries()) {
      const item = assessments.get(id);
      if (item && !DETERMINISTIC_TYPES.has(item.type)) report('INVALID_EVIDENCE_MODE', `${path}/interactiveCheckRefs/${j}`, `${id} is not a deterministic interactive check.`);
    }
    refs(gate.practicalTaskRefs ?? [], assessments, `${path}/practicalTaskRefs`);
    for (const [j, id] of (gate.practicalTaskRefs ?? []).entries()) {
      const item = assessments.get(id);
      if (item && !PRACTICAL_TYPES.has(item.type)) report('INVALID_EVIDENCE_MODE', `${path}/practicalTaskRefs/${j}`, `${id} is not a verified practical task.`);
    }
    const items = gateAssessmentIds(gate).map(id => assessments.get(id)).filter(item => item !== undefined);
    const conversation = gate.conversationalRubricRef !== undefined ? 1 : 0;
    if (conversation === 0 && items.length > 0 && items.every(item => RECOGNITION_TYPES.has(item.type)))
      report('RECOGNITION_ONLY_GATE', path, 'Every gate item is recognition-only; add production, transfer or conversational evidence.');
    const transfer = items.filter(item => item.role === 'transfer' && !RECOGNITION_TYPES.has(item.type)).length + conversation;
    if (transfer < gate.minimumIndependentEvidence.transferItems)
      report('MISSING_TRANSFER_ITEM', `${path}/minimumIndependentEvidence/transferItems`, 'The gate cannot collect its declared independent transfer evidence.');
    for (const objective of gate.requiredObjectives) {
      const families = new Set(items.filter(item => item.objectiveIds.includes(objective)).map(item => item.familyId)).size + conversation;
      if (families === 0) report('UNCOVERED_GATE_OBJECTIVE', path, `No gate evidence covers ${objective}.`);
      else if (families < gate.minimumIndependentEvidence.families) report('INSUFFICIENT_ITEM_FAMILIES', path, `The gate cannot collect ${gate.minimumIndependentEvidence.families} independent families for ${objective}.`);
    }
    const critical = (course.hypotheses ?? []).filter(h => h.kind === 'misconception' && h.critical && h.objectiveIds.some(o => gate.requiredObjectives.includes(o)));
    if (critical.length > 0 && !gate.readinessCriteria.some(c => c.kind === 'no_critical_misconception'))
      report('MISSING_MISCONCEPTION_CHECK', `${path}/readinessCriteria`, 'Gates over objectives with critical misconceptions must require that none remain unresolved.');
    for (const h of critical) {
      const checked = items.some(item => item.misconceptionIds?.includes(h.id) || (item.type === 'choice' && item.options.some(o => o.misconceptionId === h.id)));
      if (!checked) report('MISSING_MISCONCEPTION_CHECK', path, `No gate item can expose critical misconception ${h.id}.`);
    }
  }
  for (const [ci, chapter] of course.chapters.entries()) for (const [ei, episode] of chapter.episodes.entries()) {
    const gate = episode.gateId ? gates.get(episode.gateId) : undefined;
    if (!gate || !isVersionedGate(gate)) continue;
    const scope = gate.scope;
    const ok = scope.kind === 'course' || (scope.kind === 'chapter' && scope.chapterId === chapter.id) || (scope.kind === 'episode' && scope.episodeId === episode.id);
    if (!ok) report('GATE_SCOPE_MISMATCH', `/chapters/${ci}/episodes/${ei}/gateId`, 'The gate scope does not contain this episode.');
  }
  // placement additions
  if (course.placement?.evidenceThresholds) {
    const families = new Set(course.placement.assessmentIds.map(id => assessments.get(id)?.familyId).filter(Boolean)).size;
    if (families < course.placement.evidenceThresholds.minimumIndependentFamilies)
      report('UNSATISFIABLE_PLACEMENT', '/placement/evidenceThresholds', 'Placement items cannot meet the declared family threshold.');
  }
  return issues;
}
