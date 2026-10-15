import { describe, expect, it } from 'vitest';
import { validateCourse } from '../src/index.js';
import { compileCourse, verifyCompiledCourse } from '../src/compiler.js';
import type { CourseManifest, Assessment } from '../src/types.js';
import type { VersionedProgressionGate } from '../src/contracts-types.js';
import { richCourse } from './contracts-fixture.js';

const codes = (course: unknown) => validateCourse(course).issues.map(i => i.code);
const gate = (c: CourseManifest) => c.gates[0] as VersionedProgressionGate;
const item = (c: CourseManifest, id: string) => c.assessments.find(a => a.id === id)! as Assessment;

describe('0.5 contracts inside a course', () => {
  it('accepts a course that uses every 0.5 section', () => {
    expect(validateCourse(richCourse()).issues).toEqual([]);
  });

  const cases: [string, (c: CourseManifest) => void, string][] = [
    // gates (#9, #10)
    ['a recognition-only versioned gate', c => { const g = gate(c); g.interactiveCheckRefs = ['length-choice']; g.eligibleEvidenceKinds = ['deterministic_interactive_check']; delete g.conversationalRubricRef; }, 'RECOGNITION_ONLY_GATE'],
    ['a gate without transfer items', c => { item(c, 'length-prediction').role = 'application'; const g = gate(c); g.eligibleEvidenceKinds = ['deterministic_interactive_check']; delete g.conversationalRubricRef; }, 'MISSING_TRANSFER_ITEM'],
    ['a gate without a transfer criterion', c => { gate(c).readinessCriteria = gate(c).readinessCriteria.filter(r => r.kind !== 'transfer_success'); }, 'MISSING_TRANSFER_CRITERION'],
    ['a critical misconception with no misconception criterion', c => { gate(c).readinessCriteria = gate(c).readinessCriteria.filter(r => r.kind !== 'no_critical_misconception'); }, 'MISSING_MISCONCEPTION_CHECK'],
    ['a critical misconception no gate item exposes', c => {
      const choice = item(c, 'length-choice'); if (choice.type === 'choice') delete choice.options[1]!.misconceptionId; delete item(c, 'length-prediction').misconceptionIds; }, 'MISSING_MISCONCEPTION_CHECK'],
    ['a probe used as gate evidence', c => { gate(c).interactiveCheckRefs!.push('mass-probe'); }, 'PROBE_AS_GATE_EVIDENCE'],
    ['an uncited conversational rubric', c => { c.rubrics![0]!.requiresCitedEvidence = false; }, 'UNCITED_CONVERSATIONAL_RUBRIC'],
    ['an evidence mode without refs', c => { delete gate(c).interactiveCheckRefs; }, 'INVALID_EVIDENCE_MODE'],
    ['a non-deterministic interactive check', c => { gate(c).interactiveCheckRefs!.push('length-teach'); }, 'INVALID_EVIDENCE_MODE'],
    ['too few families', c => { gate(c).minimumIndependentEvidence.families = 9; }, 'INSUFFICIENT_ITEM_FAMILIES'],
    ['an unknown remediation policy', c => { gate(c).remediationPolicyRef = 'missing'; }, 'MISSING_REFERENCE'],
    ['an undeclared cap policy scope', c => { gate(c).capPolicyRef = 'episode:length'; }, 'CAP_POLICY_NOT_DECLARED'],
    ['a cap policy outside the gate scope', c => { c.chapters[0]!.episodes[0]!.policy = { mode: 'open_ended', existingMaterialAccess: 'read_only' }; gate(c).capPolicyRef = 'episode:timing'; }, 'CAP_SCOPE_MISMATCH'],
    ['an unknown next activity', c => { gate(c).nextActivityId = 'nowhere'; }, 'MISSING_REFERENCE'],
    ['a gate scope that excludes its episode', c => { gate(c).scope = { kind: 'episode', episodeId: 'timing' }; }, 'GATE_SCOPE_MISMATCH'],
    ['appeals without a window', c => { delete gate(c).appealPolicy.windowDays; }, 'INVALID_APPEAL_POLICY'],
    // assessments
    ['a transfer role on a recognition item', c => { item(c, 'length-choice').role = 'transfer'; }, 'TRANSFER_REQUIRES_PRODUCTION'],
    ['a misconception on the correct option', c => { const choice = item(c, 'length-choice'); if (choice.type === 'choice') choice.options[0]!.misconceptionId = 'mass-matters'; }, 'INVALID_ANSWER_KEY'],
    ['a trace key that misses a step', c => { const t = item(c, 'length-trace'); if (t.type === 'trace') t.grading.expected.pop(); }, 'INVALID_ANSWER_KEY'],
    ['an undeclared misconception reference', c => { item(c, 'length-prediction').misconceptionIds = ['nope']; }, 'MISSING_REFERENCE'],
    ['a rubric task with an evaluator lacking that item type', c => { c.evaluators![0]!.itemTypes = ['rubric']; }, 'INVALID_EVALUATOR'],
    ['a rubric task with an unknown rubric', c => { const t = item(c, 'length-teach'); if (t.type === 'teach_back') t.grading.rubricId = 'nope'; }, 'MISSING_REFERENCE'],
    // hypotheses & probes
    ['a hypothesis without a probe', c => { c.probes = []; }, 'UNPROBED_HYPOTHESIS'],
    ['an objective with hypotheses but no probe', c => { c.probes = []; }, 'MISSING_DIAGNOSTIC_PROBE'],
    ['a probe whose item misses the objective', c => { c.probes![0]!.assessmentId = 'period-numeric'; }, 'PROBE_SCOPE_MISMATCH'],
    ['a probe signal for an option that does not exist', c => { c.probes![0]!.signals[0] = { hypothesisId: 'mass-matters', optionIds: ['ghost'] }; }, 'MISSING_REFERENCE'],
    ['a missing-prerequisite hypothesis naming a non-prerequisite', c => { c.hypotheses![1]!.prerequisiteObjectiveId = 'predict-period'; }, 'INVALID_HYPOTHESIS'],
    ['a concept cycle', c => { c.concepts![0]!.prerequisiteConceptIds = ['length-dependence']; }, 'CONCEPT_CYCLE'],
    // activities (#14)
    ['a course target without support or fallback', c => { c.activities![0]!.equivalentFallbacks = []; }, 'UNSUPPORTED_TARGET_WITHOUT_FALLBACK'],
    ['a fallback that drops an objective', c => { c.activities![0]!.equivalentFallbacks[0]!.ref = 'timing-text'; c.activities![0]!.equivalentFallbacks[0]!.kind = 'assessment'; }, 'MISSING_REFERENCE'],
    ['a supported target without a renderer', c => { c.activities![0]!.rendererRefs.pop(); }, 'MISSING_RENDERER_REF'],
    ['a renderer missing the target', c => { c.renderers![0]!.targets = ['web_desktop', 'web_mobile']; }, 'UNSUPPORTED_PLATFORM'],
    ['a forbidden capability', c => { c.activities![0]!.capabilityRequirements.push({ capability: 'evidence.write', required: true }); }, 'FORBIDDEN_CAPABILITY'],
    ['an unknown capability', c => { c.activities![0]!.capabilityRequirements.push({ capability: 'rocket.launch', required: false }); }, 'UNKNOWN_CAPABILITY'],
    ['a pointer-only activity', c => { c.activities![0]!.accessibleSemantics.nonPointerPath = false; }, 'INACCESSIBLE_ACTIVITY'],
    ['state version without migration', c => { c.activities![0]!.stateMigration = { stateVersion: 2, strategy: 'none', migratesFrom: [] }; }, 'STATE_MIGRATION_REQUIRED'],
    ['a phone target without a compact layout', c => { delete c.activities![0]!.layouts.compact; }, 'MISSING_LAYOUT'],
    ['an activity without font scale input', c => { c.activities![0]!.layoutInputs = ['effective_window_bounds']; }, 'MISSING_LAYOUT_INPUT'],
    ['a native activity without a declared native module', c => {
      const a = c.activities![0]!; a.executionAdapter = 'bundled_native'; a.supportedTargets = ['ios_phone', 'ipados_tablet'];
      a.rendererRefs = [{ target: 'ios_phone', rendererId: 'sim-plugin' }, { target: 'ipados_tablet', rendererId: 'sim-plugin' }]; a.equivalentFallbacks = [
        { target: 'web_desktop', kind: 'text_block', ref: 'length-alt', objectiveIds: ['predict-period'] }, { target: 'web_mobile', kind: 'text_block', ref: 'length-alt', objectiveIds: ['predict-period'] }]; }, 'NATIVE_MODULE_REQUIRED'],
    ['an activity block for an unknown activity', c => { const b = c.chapters[0]!.episodes[1]!.blocks[1]!; if (b.type === 'activity' && 'activityId' in b) b.activityId = 'ghost'; }, 'MISSING_REFERENCE'],
    // admin (#20)
    ['an admin setting outside its bounds', c => { const s = c.adminSections![0]!.settings[0]!; if (s.type === 'number') s.default = 99; }, 'INVALID_SETTING_DEFAULT'],
    ['an admin setting that targets authority', c => { c.adminSections![0]!.settings[0]!.id = 'grade-override'; }, 'ADMIN_SETTING_AUTHORITY'],
    ['an undeclared mutation permission', c => { c.adminSections![0]!.settings[1]!.mutationPermission = 'policy.write'; }, 'ADMIN_PERMISSION_UNDECLARED'],
    ['a read permission used for mutation', c => { c.adminSections![0]!.settings[1]!.mutationPermission = 'course.read'; }, 'ADMIN_PERMISSION_READ_ONLY'],
    ['an admin section with a learner renderer', c => { c.adminSections![0]!.rendererRef = 'sim-renderer'; }, 'INVALID_RENDERER_SURFACE'],
    // agents, tools, policies
    ['an evaluator strategy that applies changes', c => { c.agentStrategies![0]!.roles.push('evaluator'); }, 'AUTONOMY_EXCEEDS_ROLE'],
    ['an operation the course does not permit', c => { c.agentStrategies![0]!.autonomy.mayApply = ['insert_episode']; }, 'ADAPTATION_DISABLED'],
    ['propose-only with applied changes', c => { c.agentStrategies![0]!.autonomy.level = 'propose_only'; }, 'INVALID_AUTONOMY'],
    ['an unknown tool', c => { c.agentStrategies![0]!.toolRefs = ['ghost']; }, 'MISSING_REFERENCE'],
    ['a tool in a client extension', c => { c.tools![0]!.extensionId = 'sim-plugin'; }, 'INVALID_TOOL'],
    ['a non-idempotent writing tool', c => { c.tools![0]!.sideEffects = 'artifact_write'; c.tools![0]!.idempotency = 'non_idempotent'; }, 'NON_IDEMPOTENT_SIDE_EFFECT'],
    ['remediation beyond the course cap', c => { c.adaptationPolicies![0]!.maxCyclesPerConcept = 9; }, 'CAP_EXCEEDED'],
    ['extension offers while extensions are disabled', c => { c.adaptationPolicies![0]!.onExhausted = 'offer_extension'; }, 'EXTENSIONS_DISABLED'],
    ['unconfirmed model judgments', c => { c.evaluators![0]!.humanConfirmation = 'none'; }, 'UNCONFIRMED_MODEL_JUDGMENT'],
    ['an evaluator on a client extension', c => { c.evaluators![0]!.extensionId = 'sim-plugin'; }, 'INVALID_EVALUATOR'],
    // platform, debug, visuals
    ['a native module without an app build', c => { c.platformAdapters![0]!.requiresAppBuild = false; }, 'NATIVE_REQUIRES_BUILD'],
    ['payload access without debug.payload', c => { c.debugInspectors![0]!.payloadAccess = 'payload_with_audit'; }, 'DEBUG_PERMISSION_REQUIRED'],
    ['replay without the safe replay view', c => { c.debugInspectors![0]!.views = ['context']; }, 'INVALID_REPLAY'],
    ['an inspector subject that does not exist', c => { c.debugInspectors![0]!.subjects[0]!.ref = 'ghost'; }, 'MISSING_REFERENCE'],
    ['an unsupported renderer feature without fallback', c => { c.rendererAdapters![0]!.fallbacks = []; }, 'UNSUPPORTED_FEATURE_WITHOUT_FALLBACK'],
    ['a meaningful layer without semantics', c => { c.scenes![0]!.layers[0]!.semanticNodeIds = []; }, 'INACCESSIBLE_SCENE'],
    ['keyframes beyond the timeline', c => { c.timelines![0]!.tracks[0]!.keyframes.push({ atMs: 9000, value: 0 }); }, 'INVALID_TIMELINE'],
    ['a track for an unknown layer', c => { c.timelines![0]!.tracks[0]!.layerId = 'ghost'; }, 'MISSING_REFERENCE'],
    // steps, research, storyboards, media, stages
    ['a learning step cycle', c => { c.learningSteps![2]!.nextStepId = 'step-explain'; }, 'STEP_CYCLE'],
    ['a step with blocks from another episode', c => { c.learningSteps![0]!.blockIds.push('timing-text'); }, 'STEP_SCOPE_MISMATCH'],
    ['a gate step without a gate', c => { delete c.learningSteps![2]!.gateId; }, 'INVALID_STEP'],
    ['a research task widening domains', c => { c.researchTasks![0]!.sourcePolicy.allowedDomains = ['elsewhere.example']; }, 'RESEARCH_DOMAIN_WIDENED'],
    ['a research task with an unknown topic', c => { c.researchTasks![0]!.publicTopicIds = ['ghost']; }, 'MISSING_REFERENCE'],
    ['a verified animation without a reference model', c => { delete c.storyboards![0]!.referenceVisualId; }, 'MISSING_REFERENCE_COMPUTATION'],
    ['storyboard frames out of order', c => { c.storyboards![0]!.frames.push({ id: 'late', atMs: 9999, description: 'Too late.' }); }, 'INVALID_TIMELINE'],
    ['a segment on unreviewed media', c => { c.media[0]!.review = 'unreviewed'; }, 'UNREVIEWED_SEGMENT'],
    ['an inverted segment', c => { c.media[0]!.segment = { startSeconds: 50, endSeconds: 10 }; }, 'INVALID_SEGMENT'],
    ['a chapter in an unknown stage', c => { c.chapters[0]!.stageId = 'ghost'; }, 'MISSING_REFERENCE'],
    ['duplicate activity IDs', c => { c.activities!.push(structuredClone(c.activities![0]!)); }, 'DUPLICATE_ID'],
    ['a retention item exposed by a versioned gate', c => { gate(c).interactiveCheckRefs!.push('later-prediction'); }, 'RETENTION_ITEM_NOT_HELD_OUT'],
    ['an evaluator ID that shadows an extension', c => { c.evaluators![0]!.id = 'grader'; }, 'DUPLICATE_ID'],
  ];
  it.each(cases)('rejects %s', (_name, mutate, code) => {
    const course = richCourse(); mutate(course);
    expect(codes(course)).toContain(code);
  });

  it('rejects schema violations in new sections (closed objects, ceilings, constants)', () => {
    const extra = richCourse() as unknown as { activities: Record<string, unknown>[] }; extra.activities[0]!.secret = true;
    expect(codes(extra)).toContain('SCHEMA');
    const budget = richCourse(); budget.activities![0]!.resourceBudget.maxEventBytes = 16385;
    expect(codes(budget)).toContain('SCHEMA');
    const assisted = richCourse() as unknown as { gates: { assistancePolicy: Record<string, unknown> }[] }; assisted.gates[0]!.assistancePolicy.agentAuthoredAnswers = 'accepted';
    expect(codes(assisted)).toContain('SCHEMA');
  });

  it('accepts legitimate alternatives: conversation-only gates and course-wide scope', () => {
    const c = richCourse(); const g = gate(c);
    g.eligibleEvidenceKinds = ['rubric_backed_conversation']; delete g.interactiveCheckRefs; g.minimumIndependentEvidence.families = 1;
    g.readinessCriteria = [{ id: 'i', kind: 'independent_success', description: 'Explain.', objectiveIds: [] }, { id: 't', kind: 'transfer_success', description: 'Explain a new case.', objectiveIds: [] },
      { id: 'r', kind: 'rubric_criteria', description: 'Rubric met.', objectiveIds: [] }];
    c.hypotheses![0]!.critical = false;
    expect(validateCourse(c).issues).toEqual([]);
    const wide = richCourse(); gate(wide).scope = { kind: 'course' }; gate(wide).capPolicyRef = 'course';
    expect(validateCourse(wide).issues).toEqual([]);
  });

  it('compiles 0.5 sections with server-only data kept off the learner projection', () => {
    const compiled = compileCourse(richCourse());
    expect(verifyCompiledCourse(compiled)).toBe(true);
    const learner = compiled.learner as unknown as Record<string, unknown>;
    for (const section of ['hypotheses', 'probes', 'rubrics', 'evaluators', 'tools', 'adaptationPolicies', 'adminSections', 'researchTasks', 'storyboards', 'agentStrategies', 'debugInspectors'])
      expect(learner).not.toHaveProperty(section);
    expect(compiled.learner.activities![0]).not.toHaveProperty('evaluatorRef');
    expect(compiled.learner.renderers!.map(r => r.id)).toEqual(['sim-renderer']);
    const lg = compiled.learner.gates[0]!;
    expect(lg).toMatchObject({ id: 'length-ready', version: '1.0.0', minimumIndependentEvidence: { families: 2, transferItems: 1 } });
    expect(JSON.stringify(lg)).not.toMatch(/interactiveCheckRefs|conversationalRubricRef|remediationPolicyRef/);
    expect(compiled.learner.retention).toEqual({ intervalsDays: [1, 3, 7, 21], objectiveIds: ['predict-period'] });
    expect(compiled.learner.assessments.some(a => a.id === 'later-prediction')).toBe(false);
    expect(compiled.server).toHaveProperty('agentStrategies');
  });

  it('compiles deterministically regardless of key order', () => {
    const course = richCourse();
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(course).reverse())));
    expect(compileCourse(reordered).digest).toBe(compileCourse(course).digest);
    const changed = richCourse(); changed.activities![0]!.resourceBudget.timeoutMs = 2001;
    expect(compileCourse(changed).digest).not.toBe(compileCourse(course).digest);
  });
});
