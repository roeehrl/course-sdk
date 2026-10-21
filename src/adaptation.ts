import type { ValidateFunction } from 'ajv';
import proposalValidator from './generated/adaptation-validator.js';
import contextValidator from './generated/adaptation-context-validator.js';
import assignmentValidator from './generated/assignment-decisions-validator.js';
import { validateCourse } from './validate.js';
import { canonicalJson } from './json.js';
import { digestAdaptationProposal, digestJson, digestTeachingArtifact } from './integrity.js';
import { evaluateNumericalRecipe } from './numerical-recipe.js';
import { AdaptationDataError, sameIds, shapeIssues } from './adaptation-shape.js';
import type { ActivityAssignmentDecision, AdaptationValidationContext, AdaptationValidationResult, CourseAdaptation, TeachingArtifact } from './adaptation-types.js';

/** Data validation only. Registry inputs must be loaded by the host, not the model. */
export async function validateCourseAdaptation(input: unknown, contextInput: AdaptationValidationContext): Promise<AdaptationValidationResult> {
  const issues = [...shapeIssues(proposalValidator as ValidateFunction, input), ...shapeIssues(contextValidator as ValidateFunction, contextInput, '/context')];
  if (issues.length) return { valid: false, issues };
  const checked = validateCourse(contextInput.course);
  if (!checked.valid) return { valid: false, issues: checked.issues.map(i => ({ ...i, path: '/context/course' + i.path })) };
  const context = structuredClone(contextInput), proposal = structuredClone(input) as CourseAdaptation;
  const course = checked.course, authoring = course.adaptation;
  const report = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!authoring) return { valid: false, issues: [{ code: 'ADAPTATION_DISABLED', path: '/context/course', message: 'The base course has no author-declared adaptation rules.' }] };
  const baseDigest = await digestJson(course);
  if (context.baseCourseDigest !== baseDigest || context.plan.baseCourseDigest !== baseDigest || proposal.baseCourseDigest !== baseDigest) report('BASE_DIGEST_MISMATCH', '/baseCourseDigest', 'Course, plan and proposal must bind the same immutable base bytes.');
  if (proposal.expectedPlanRevision !== context.plan.revision || proposal.expectedPlanDigest !== context.plan.digest) report('STALE_PLAN', '/expectedPlanRevision', 'Proposal must be rebased against the exact current plan.');
  if (context.plan.revision >= Number.MAX_SAFE_INTEGER) report('PLAN_REVISION_LIMIT', '/context/plan/revision', 'Plan revision cannot advance safely.');
  if (proposal.operations.length > authoring.limits.maxOperations || proposal.artifacts.length > authoring.limits.maxArtifacts) report('AUTHOR_LIMIT', '', 'Proposal exceeds an author-declared size limit.');
  const episodes = course.chapters.flatMap(c => c.episodes);
  const objectives = new Set(course.objectives.map(o => o.id));
  const occupied = new Set([...context.plan.occupiedIds, course.id,
    ...[course.objectives, course.chapters, episodes, course.assessments, course.gates, course.extensions, course.visuals, course.media, course.sources].flatMap(items => items.map(i => i.id)),
    ...episodes.flatMap(e => e.blocks.map(b => b.id))]);
  const fresh = new Set<string>();
  function claimId(id: string, path: string) {
    if (fresh.has(id) || occupied.has(id)) report('DUPLICATE_ID', path, 'New IDs must be unique and cannot reuse existing course or plan identities.');
    fresh.add(id);
  }
  claimId(proposal.id, '/id');
  const currentTargets = new Map<string, string>();
  for (const target of context.plan.targetDigests) {
    const key = `${target.episodeId}/${target.blockId}`;
    if (currentTargets.has(key)) report('DUPLICATE_ID', '/context/plan/targetDigests', 'Plan target bindings must be unique.');
    currentTargets.set(key, target.digest);
    if (!episodes.some(e => e.id === target.episodeId && e.blocks.some(b => b.id === target.blockId && b.type === 'text'))) report('MISSING_REFERENCE', '/context/plan/targetDigests', 'Plan target must bind an existing text block.');
  }
  const counts = new Map<string, number>();
  for (const count of context.plan.variantCounts) {
    if (counts.has(count.familyId)) report('DUPLICATE_ID', '/context/plan/variantCounts', 'Family counts must be unique.');
    counts.set(count.familyId, count.count);
    if (!authoring.families.some(f => f.familyId === count.familyId)) report('UNKNOWN_FAMILY', '/context/plan/variantCounts', 'Count names an undeclared canonical family.');
  }
  const registrations = new Map<string, typeof context.registeredVerifiers[number]>();
  for (const registration of context.registeredVerifiers) {
    const key = `${registration.id}@${registration.version}`;
    if (registrations.has(key)) report('DUPLICATE_ID', '/context/registeredVerifiers', 'Verifier registrations must be unique by ID/version.');
    registrations.set(key, registration);
  }
  const artifacts = new Map<string, TeachingArtifact>();
  for (const [index, artifact] of proposal.artifacts.entries()) {
    const path = `/artifacts/${index}`;
    claimId(artifact.id, path + '/id'); artifacts.set(artifact.id, artifact);
    if (artifact.objectiveIds.some(id => !objectives.has(id))) report('UNKNOWN_OBJECTIVE', path, 'Adaptations can only reference existing objectives.');
    if (artifact.sourceRefs.some(id => !authoring.sourceRefs.includes(id))) report('UNKNOWN_SOURCE', path, 'Artifact sources must be approved by the course author.');
    const generator = authoring.generators.find(g => g.id === artifact.generator.id && g.version === artifact.generator.version);
    if (!generator?.artifactKinds.includes(artifact.kind)) report('GENERATOR_NOT_ALLOWED', path, 'Generator identity/version/kind is not author-declared.');
    if (new TextEncoder().encode(canonicalJson(artifact)).byteLength > authoring.limits.maxArtifactBytes) report('AUTHOR_LIMIT', path, 'Artifact exceeds the author-declared byte limit.');
    if (artifact.digest !== await digestTeachingArtifact(artifact)) report('ARTIFACT_DIGEST_MISMATCH', path + '/digest', 'Artifact identity includes every content, grading and fixture field.');
    if (artifact.kind === 'assessment_variant') {
      claimId(artifact.assessment.id, path + '/assessment/id');
      const original = course.assessments.find(a => a.id === artifact.canonicalAssessmentId);
      const family = authoring.families.find(f => f.canonicalAssessmentId === artifact.canonicalAssessmentId && f.familyId === artifact.assessment.familyId);
      if (!original || !family || original.familyId !== artifact.assessment.familyId) report('UNKNOWN_FAMILY', path, 'Variant must keep its existing canonical assessment and family binding.');
      if (original && (original.type !== artifact.assessment.type || !sameIds(original.objectiveIds, artifact.assessment.objectiveIds))) report('ASSESSMENT_STANDARD_CHANGED', path, 'Variant cannot change canonical type or objective coverage.');
      if (!sameIds(artifact.objectiveIds, artifact.assessment.objectiveIds)) report('OBJECTIVE_SCOPE', path, 'Artifact and assessment objective bindings differ.');
      if (family && !family.generatorIds.includes(artifact.generator.id)) report('GENERATOR_NOT_ALLOWED', path, 'Family does not permit this generator.');
      if (original?.type === 'numeric' && artifact.assessment.type === 'numeric' && original.grading.absoluteTolerance !== artifact.assessment.grading.absoluteTolerance) report('ASSESSMENT_STANDARD_CHANGED', path, 'Numeric tolerance is author-controlled.');
      if (original?.type === 'rubric' && artifact.assessment.type === 'rubric' && canonicalJson(original.grading) !== canonicalJson(artifact.assessment.grading)) report('ASSESSMENT_STANDARD_CHANGED', path, 'Rubric and evaluator cannot be rewritten by a variant.');
      if (original?.type === 'code' && artifact.assessment.type === 'code' && (original.language !== artifact.assessment.language || original.grading.evaluatorId !== artifact.assessment.grading.evaluatorId)) report('ASSESSMENT_STANDARD_CHANGED', path, 'Code language and evaluator are author-controlled.');
      const candidateCourse = validateCourse({ ...course, assessments: [...course.assessments, artifact.assessment] });
      if (!candidateCourse.valid) report('INVALID_ASSESSMENT', path, 'Generated assessment fails the existing course assessment contract.');
      if (family) {
        counts.set(family.familyId, (counts.get(family.familyId) ?? 0) + 1);
        if (counts.get(family.familyId)! > family.maxVariantsPerPlan) report('AUTHOR_LIMIT', path, 'Canonical family variant allowance is exhausted.');
      }
      if (artifact.recipe) {
        if (!family?.numericalRecipeIds.includes(artifact.recipe.templateId)) report('RECIPE_NOT_ALLOWED', path, 'The canonical family does not permit this numerical template.');
        const template = authoring.numericalRecipes.find(r => r.id === artifact.recipe!.templateId);
        if (!template) report('UNKNOWN_RECIPE', path, 'Only author-supplied numerical templates are allowed.');
        else {
          if (template.sourceRefs.some(id => !artifact.sourceRefs.includes(id))) report('SOURCE_BINDING', path, 'Recipe source references must be retained.');
          try {
            const computed = await evaluateNumericalRecipe(template, artifact.recipe);
            if (artifact.assessment.type !== 'numeric' || artifact.assessment.grading.expected !== computed.value || artifact.assessment.prompt !== computed.prompt) report('RECIPE_OUTPUT_MISMATCH', path, 'Generated prompt and answer must agree with the bounded author template.');
          } catch (error) {
            if (error instanceof AdaptationDataError) issues.push(...error.issues.map(i => ({ ...i, path: path + '/recipe' + i.path })));
            else throw error;
          }
        }
      }
    } else if (artifact.kind === 'media') {
      claimId(artifact.media.id, path + '/media/id');
      if (artifact.media.review !== 'reviewed') report('UNREVIEWED_MEDIA', path, 'Attachments require review and a matching proof claim; the flag alone is not authentication.');
      if (!artifact.sourceRefs.includes(artifact.media.sourceRef)) report('SOURCE_BINDING', path, 'Media provenance must be bound by its artifact sources.');
      if (!validateCourse({ ...course, media: [...course.media, artifact.media] }).valid) report('INVALID_MEDIA', path, 'Media fails the existing resource contract.');
    } else if (artifact.kind === 'visual') {
      claimId(artifact.visual.id, path + '/visual/id');
      const renderer = course.extensions.find(e => e.id === artifact.visual.rendererId);
      if (!renderer?.capabilities.includes('visual.render') || renderer.execution === 'server' || course.platforms.some(p => !artifact.visual.platforms.includes(p)) || !validateCourse({ ...course, visuals: [...course.visuals, artifact.visual] }).valid) report('INVALID_VISUAL', path, 'Visual must use a declared client renderer and support all course targets.');
    } else if (artifact.kind === 'episode') {
      // The artifact ID becomes the personal episode ID; its blocks are new IDs too.
      for (const [b, block] of artifact.blocks.entries()) claimId(block.id, `${path}/blocks/${b}/id`);
    } else if (artifact.kind === 'profile_suggestion' && !authoring.profileFieldIds.includes(artifact.fieldId)) report('PROFILE_FIELD_NOT_ALLOWED', path, 'Only author-declared non-authority profile fields may be suggested.');
  }
  const used = new Set<string>(), replaced = new Set<string>(), assignmentOperationIds: string[] = [];
  const expectedKinds = { attach_media: 'media', attach_visual: 'visual', add_assessment_variant: 'assessment_variant', suggest_profile_correction: 'profile_suggestion' } as const;
  for (const [index, operation] of proposal.operations.entries()) {
    const path = `/operations/${index}`; claimId(operation.id, path + '/id');
    const artifact = artifacts.get(operation.artifactId);
    if (!artifact) { report('MISSING_REFERENCE', path, 'Operation refers to an absent artifact.'); continue; }
    if (used.has(artifact.id)) report('DUPLICATE_ARTIFACT_USE', path, 'Each artifact must have one unambiguous proposed operation.');
    used.add(artifact.id);
    if (operation.type === 'append_teaching' || operation.type === 'replace_teaching') {
      if (!['explanation', 'practice'].includes(artifact.kind)) report('ARTIFACT_KIND', path, 'Teaching operations accept only explanation or practice artifacts.');
    } else if (operation.type === 'insert_episode') {
      if (artifact.kind !== 'episode') report('ARTIFACT_KIND', path, 'Episode insertion accepts only an episode artifact.');
    } else if (artifact.kind !== expectedKinds[operation.type]) report('ARTIFACT_KIND', path, 'Operation and artifact kinds differ.');
    if (operation.type === 'suggest_profile_correction') continue;
    assignmentOperationIds.push(operation.id);
    const anchorId = operation.type === 'insert_episode' ? operation.afterEpisodeId : operation.episodeId;
    const target = authoring.targets.find(t => t.episodeId === anchorId);
    const episode = episodes.find(e => e.id === anchorId);
    if (operation.type === 'insert_episode' && !episode) report('MISSING_REFERENCE', path, 'A personal episode must follow an existing base episode.');
    if (!target?.allowedOperations.includes(operation.type) || artifact.objectiveIds.some(id => !target.objectiveIds.includes(id))) report('AUTHOR_TARGET', path, 'Operation is outside its author-declared episode/objective scope.');
    if (operation.type === 'replace_teaching') {
      const key = `${operation.episodeId}/${operation.blockId}`;
      if (replaced.has(key)) report('CONFLICTING_REPLACEMENT', path, 'A proposal cannot replace the same target twice.');
      replaced.add(key);
      const block = episode?.blocks.find(b => b.id === operation.blockId);
      if (!target?.replaceableBlockIds.includes(operation.blockId) || block?.type !== 'text') report('AUTHOR_TARGET', path, 'Replacement target must be an author-permitted text block.');
      else if (operation.expectedTargetDigest !== (currentTargets.get(key) ?? await digestJson(block))) report('STALE_TARGET', path, 'Replacement must bind the exact current text artifact.');
    }
  }
  if (used.size !== proposal.artifacts.length) report('UNUSED_ARTIFACT', '/artifacts', 'Every generated artifact must have an operation.');
  const proposalDigest = await digestAdaptationProposal(proposal);
  const covered = new Map<string, Set<string>>();
  for (const [index, receipt] of proposal.proofReceipts.entries()) {
    const path = `/proofReceipts/${index}`; claimId(receipt.id, path + '/id');
    const artifact = artifacts.get(receipt.artifactId);
    const declaration = authoring.verifiers.find(v => v.id === receipt.verifierId && v.version === receipt.verifierVersion);
    const registered = registrations.get(`${receipt.verifierId}@${receipt.verifierVersion}`);
    if (!artifact) { report('MISSING_REFERENCE', path, 'Receipt names an absent artifact.'); continue; }
    const implementation = course.extensions.find(e => e.id === declaration?.extensionId)?.integrity.slice('sha256-'.length);
    if (!declaration?.artifactKinds.includes(artifact.kind) || !registered?.artifactKinds.includes(artifact.kind)
      || registered.implementationDigest !== implementation || receipt.verifierImplementationDigest !== registered.implementationDigest) {
      report('UNREGISTERED_VERIFIER', path, 'Receipt must match an author-approved, host-registered verifier implementation/version/kind.'); continue;
    }
    if (receipt.proposalDigest !== proposalDigest || receipt.artifactDigest !== artifact.digest) report('PROOF_BINDING', path, 'Receipt must bind the exact proposal and artifact digest.');
    if (!sameIds(receipt.sourceRefs, artifact.sourceRefs) || !sameIds(receipt.verifierSourceRefs, declaration.sourceRefs) || !sameIds(registered.sourceRefs, declaration.sourceRefs)) report('SOURCE_BINDING', path, 'Receipt and registered verifier provenance must match their declarations.');
    const checkIds = receipt.checks.map(c => c.id);
    if (new Set(checkIds).size !== checkIds.length) report('DUPLICATE_CHECK', path, 'Proof check IDs must be unique.');
    if (receipt.outcome !== 'passed' || receipt.checks.some(c => c.result !== 'passed' || !registered.checkIds.includes(c.id)) || declaration.requiredCheckIds.some(id => !checkIds.includes(id))) report('PROOF_CHECK_FAILED', path, 'Every required registered check must be reported as passing.');
    if (artifact.kind === 'assessment_variant') {
      const family = authoring.families.find(f => f.canonicalAssessmentId === artifact.canonicalAssessmentId);
      if (!family?.verifierIds.includes(receipt.verifierId)) report('VERIFIER_NOT_ALLOWED', path, 'Canonical family does not permit this verifier.');
    }
    covered.set(artifact.id, new Set([...(covered.get(artifact.id) ?? []), receipt.verifierId]));
  }
  for (const artifact of proposal.artifacts) {
    if (!covered.has(artifact.id)) report('MISSING_PROOF', '/artifacts', 'Each artifact requires a matching registered verifier receipt claim.');
    if (artifact.kind === 'assessment_variant' && artifact.recipe) {
      const template = authoring.numericalRecipes.find(t => t.id === artifact.recipe!.templateId);
      if (template && !covered.get(artifact.id)?.has(template.referenceCheck.verifierId)) report('MISSING_REFERENCE_PROOF', '/artifacts', 'Numerical variants also require the author-selected reference verifier.');
    }
  }
  return issues.length ? { valid: false, issues } : { valid: true, proposal, proposalDigest, issues: [],
    proofAuthenticity: 'not_checked', applicationAuthority: 'not_checked', assignmentOperationIds };
}

export function defineCourseAdaptation(input: CourseAdaptation): CourseAdaptation { return structuredClone(input); }

/** Validate separate author/server decisions; these data claims still require host authentication. */
export async function validateAssignmentDecisions(proposal: CourseAdaptation, context: AdaptationValidationContext, input: unknown) {
  const issues = shapeIssues(assignmentValidator as ValidateFunction, input);
  if (issues.length) return { valid: false as const, issues };
  const validated = await validateCourseAdaptation(proposal, context);
  if (!validated.valid) return validated;
  const decisions = structuredClone(input) as ActivityAssignmentDecision[];
  const seen = new Set<string>(), limits = context.course.adaptation!.limits;
  for (const [i, decision] of decisions.entries()) {
    if (seen.has(decision.operationId) || !validated.assignmentOperationIds.includes(decision.operationId)) issues.push({ code: 'ASSIGNMENT_SCOPE', path: `/${i}`, message: 'Each assignment operation needs exactly one authority decision.' });
    seen.add(decision.operationId);
    if (decision.proposalDigest !== validated.proposalDigest) issues.push({ code: 'ASSIGNMENT_BINDING', path: `/${i}`, message: 'Decision must bind the exact proposal.' });
    if (!limits.allowedClassifications.includes(decision.classification) || decision.plannedMinutes > limits.maxPlannedMinutesPerAssignment || decision.additionalEpisodes > limits.maxAdditionalEpisodesPerAssignment) issues.push({ code: 'AUTHOR_LIMIT', path: `/${i}`, message: 'Assignment exceeds author-declared classification/cost bounds.' });
    // A whole episode is real added work: it must be metered as at least one episode.
    const operation = proposal.operations.find(o => o.id === decision.operationId);
    if (operation?.type === 'insert_episode' && decision.additionalEpisodes < 1) issues.push({ code: 'EPISODE_COST_REQUIRED', path: `/${i}`, message: 'An inserted episode must count as at least one additional episode.' });
  }
  if (validated.assignmentOperationIds.some(id => !seen.has(id))) issues.push({ code: 'MISSING_ASSIGNMENT', path: '', message: 'The host must supply every required assignment decision.' });
  return issues.length ? { valid: false as const, issues } : { valid: true as const, decisions, issues: [], authorityAuthenticity: 'not_checked' as const };
}
