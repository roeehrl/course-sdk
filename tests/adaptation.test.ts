import { describe, expect, it } from 'vitest';
import { defineCourseAdaptation, validateAssignmentDecisions, validateCourseAdaptation } from '../src/adaptation.js';
import { validateCourse } from '../src/validate.js';
import { adaptationFixture, context, reseal } from './adaptation-fixture.js';
import type { CourseAdaptation, TeachingArtifact } from '../src/adaptation-types.js';

async function codes(f = adaptationFixture()) { return (await validateCourseAdaptation(f.proposal, context(f))).issues.map(i => i.code); }
const variant = (f: ReturnType<typeof adaptationFixture>) => f.proposal.artifacts.find(a => a.kind === 'assessment_variant')! as Extract<TeachingArtifact, { kind: 'assessment_variant' }>;

describe('verified-teaching proposal DATA contracts', () => {
  it.each(['ordering', 'language', 'plant-observations'])('accepts unrelated %s content without authorizing or authenticating anything', async domain => {
    const f = adaptationFixture(domain), before = structuredClone(f);
    expect(validateCourse(f.course).valid).toBe(true);
    const result = await validateCourseAdaptation(f.proposal, context(f));
    expect(result.valid, JSON.stringify(result.issues)).toBe(true);
    if (result.valid) {
      expect(result.proofAuthenticity).toBe('not_checked'); expect(result.applicationAuthority).toBe('not_checked');
      expect(result.assignmentOperationIds.length).toBe(f.assignments.length);
      result.proposal.rationale = 'detached';
    }
    expect(f).toEqual(before);
    expect((await validateAssignmentDecisions(f.proposal, context(f), f.assignments)).valid).toBe(true);
  });
  it('snapshots proposal/context before awaiting hash work and authoring helpers detach input', async () => {
    const f = adaptationFixture(); const promise = validateCourseAdaptation(f.proposal, context(f));
    f.proposal.rationale = 'mutated after call'; f.plan.revision++;
    const result = await promise; expect(result.valid).toBe(true);
    if (result.valid) expect(result.proposal.rationale).not.toBe(f.proposal.rationale);
    const clone = defineCourseAdaptation(f.proposal); clone.rationale = 'other'; expect(f.proposal.rationale).not.toBe(clone.rationale);
  });
  it.each(['mastery', 'credit', 'consent', 'policy', 'required', 'costs', 'trusted'])('rejects a model-supplied %s mutation/authority claim', async field => {
    const f = adaptationFixture(); (f.proposal as unknown as Record<string, unknown>)[field] = true;
    expect(await codes(f)).toContain('SCHEMA');
  });
  it('rejects unknown nested fields, executable recipes and forged proof-authenticity flags', async () => {
    for (const location of ['artifact', 'operation', 'proof']) {
      const f = adaptationFixture();
      const object = location === 'artifact' ? f.proposal.artifacts[0]! : location === 'operation' ? f.proposal.operations[0]! : f.proposal.proofReceipts[0]!;
      (object as unknown as Record<string, unknown>).authenticated = true;
      expect(await codes(f)).toContain('SCHEMA');
    }
    const f = adaptationFixture(); (variant(f).recipe as unknown as Record<string, unknown>).eval = 'return 1';
    expect(await codes(f)).toContain('SCHEMA');
  });
  it('does not mistake a well-shaped forged model receipt for an authenticated verifier result', async () => {
    const f = adaptationFixture(); f.proposal.proofReceipts.forEach(p => { p.receiptRef = 'model-invented-receipt'; });
    const result = await validateCourseAdaptation(f.proposal, context(f));
    expect(result.valid).toBe(true); // Only host authentication can detect a well-shaped forgery.
    if (result.valid) { expect(result.proofAuthenticity).toBe('not_checked'); expect(result).not.toHaveProperty('verified'); expect(result).not.toHaveProperty('authorized'); }
  });
  it.each(['not-registered', 'wrong-version', 'changed-implementation', 'wrong-kind'])('rejects %s verifier claims', async mode => {
    const f = adaptationFixture();
    if (mode === 'not-registered') f.proposal.proofReceipts[0]!.verifierId = 'invented';
    if (mode === 'wrong-version') f.proposal.proofReceipts[0]!.verifierVersion = '9.0.0';
    if (mode === 'changed-implementation') f.registeredVerifiers[0]!.implementationDigest = 'f'.repeat(64);
    if (mode === 'wrong-kind') f.registeredVerifiers[0]!.artifactKinds = ['media'];
    expect(await codes(f)).toContain('UNREGISTERED_VERIFIER');
  });
  it('rejects missing, failed, duplicated and undeclared proof checks', async () => {
    for (const mode of ['missing', 'failed', 'duplicate', 'invented', 'outcome']) {
      const f = adaptationFixture(), proof = f.proposal.proofReceipts[0]!;
      if (mode === 'missing') proof.checks.pop();
      if (mode === 'failed') proof.checks[0]!.result = 'failed';
      if (mode === 'duplicate') proof.checks.push(structuredClone(proof.checks[0]!));
      if (mode === 'invented') proof.checks.push({ id: 'invented', result: 'passed' });
      if (mode === 'outcome') proof.outcome = 'failed';
      expect(await codes(f)).toContain(mode === 'duplicate' ? 'DUPLICATE_CHECK' : 'PROOF_CHECK_FAILED');
    }
    const f = adaptationFixture(); f.proposal.proofReceipts.splice(0, 1); expect(await codes(f)).toContain('MISSING_PROOF');
  });
  it('binds artifact and verifier source references independently', async () => {
    for (const target of ['artifact', 'receipt', 'verifier']) {
      const f = adaptationFixture();
      if (target === 'artifact') f.proposal.artifacts[0]!.sourceRefs = ['invented-source'];
      if (target === 'receipt') f.proposal.proofReceipts[0]!.sourceRefs = [f.course.sources[1]!.id];
      if (target === 'verifier') f.registeredVerifiers[0]!.sourceRefs = [f.course.sources[0]!.id];
      expect(await codes(f)).toContain(target === 'artifact' ? 'UNKNOWN_SOURCE' : 'SOURCE_BINDING');
    }
  });
  it('rejects invented objectives, renamed canonical families and canonical-ID swaps', async () => {
    for (const mode of ['objective', 'family', 'canonical']) {
      const f = adaptationFixture(), artifact = variant(f);
      if (mode === 'objective') artifact.objectiveIds = ['invented'];
      if (mode === 'family') artifact.assessment.familyId = 'invented';
      if (mode === 'canonical') artifact.canonicalAssessmentId = 'invented';
      await reseal(f);
      expect(await codes(f)).toContain(mode === 'objective' ? 'UNKNOWN_OBJECTIVE' : 'UNKNOWN_FAMILY');
    }
  });
  it('cannot change scoring tolerance, objective coverage or assessment type through a variant', async () => {
    const f = adaptationFixture(); const a = variant(f).assessment;
    if (a.type !== 'numeric') throw new Error('fixture'); a.grading.absoluteTolerance = 100;
    await reseal(f); expect(await codes(f)).toContain('ASSESSMENT_STANDARD_CHANGED');
    const changed = adaptationFixture('language'); variant(changed).assessment.objectiveIds = ['other'];
    await reseal(changed); expect(await codes(changed)).toContain('ASSESSMENT_STANDARD_CHANGED');
  });
  it('rejects a changed answer or hidden fixture even when teaching text is unchanged', async () => {
    for (const change of ['grading', 'fixtures', 'text']) {
      const f = adaptationFixture(), a = variant(f);
      if (change === 'grading' && a.assessment.type === 'numeric') a.assessment.grading.expected++;
      if (change === 'fixtures') a.hiddenFixtures = { replacement: 'changed' };
      if (change === 'text') a.assessment.prompt += ' changed';
      expect(await codes(f)).toContain('ARTIFACT_DIGEST_MISMATCH');
    }
  });
  it('recomputing artifact hashes cannot reuse receipts for changed proposal terms', async () => {
    const f = adaptationFixture(); f.proposal.rationale += ' changed';
    expect(await codes(f)).toContain('PROOF_BINDING');
    f.proposal.proofReceipts[0]!.artifactDigest = '0'.repeat(64); expect(await codes(f)).toContain('PROOF_BINDING');
  });
  it('rejects base-course, cross-course plan, stale revision, stale plan hash and stale target mismatches', async () => {
    for (const which of ['base', 'plan-base', 'revision', 'plan-digest', 'target']) {
      const f = adaptationFixture();
      if (which === 'base') f.course.summary += ' changed';
      if (which === 'plan-base') f.plan.baseCourseDigest = 'f'.repeat(64);
      if (which === 'revision') f.plan.revision++;
      if (which === 'plan-digest') f.plan.digest = 'f'.repeat(64);
      if (which === 'target') f.plan.targetDigests.push({ episodeId: 'ordering-episode', blockId: 'ordering-text', digest: 'f'.repeat(64) });
      expect(await codes(f)).toContain(which === 'base' || which === 'plan-base' ? 'BASE_DIGEST_MISMATCH' : which === 'target' ? 'STALE_TARGET' : 'STALE_PLAN');
    }
  });
  it('rejects duplicate proposal entities and IDs already occupied in the plan', async () => {
    for (const kind of ['artifact', 'operation', 'receipt', 'item', 'historical']) {
      const f = adaptationFixture();
      if (kind === 'artifact') f.proposal.artifacts.push(structuredClone(f.proposal.artifacts[0]!));
      if (kind === 'operation') f.proposal.operations.push(structuredClone(f.proposal.operations[0]!));
      if (kind === 'receipt') f.proposal.proofReceipts.push(structuredClone(f.proposal.proofReceipts[0]!));
      if (kind === 'item') variant(f).assessment.id = f.course.assessments[0]!.id;
      if (kind === 'historical') f.plan.occupiedIds.push(f.proposal.id);
      expect(await codes(f)).toContain('DUPLICATE_ID');
    }
  });
  it('rejects conflicting replacements, unused artifacts, double-use and operation/kind mismatches', async () => {
    const f = adaptationFixture(); f.proposal.operations[0]!.artifactId = 'absent'; expect(await codes(f)).toContain('MISSING_REFERENCE');
    const double = adaptationFixture(); double.proposal.operations[0]!.artifactId = double.proposal.operations[1]!.artifactId;
    expect(await codes(double)).toContain('DUPLICATE_ARTIFACT_USE');
    const badKind = adaptationFixture(); badKind.proposal.operations[0]!.artifactId = variant(badKind).id;
    expect(await codes(badKind)).toContain('ARTIFACT_KIND');
    const extra = adaptationFixture(); extra.proposal.operations.splice(0, 1); expect(await codes(extra)).toContain('UNUSED_ARTIFACT');
    const conflict = adaptationFixture(); const replacement = conflict.proposal.operations.find(o => o.type === 'replace_teaching')!;
    conflict.proposal.operations.push({ ...replacement, id: 'another-replacement' }); expect(await codes(conflict)).toContain('CONFLICTING_REPLACEMENT');
  });
  it('requires author opt-in and enforces target, generator, byte and variant limits', async () => {
    for (const mode of ['disabled', 'operation', 'generator', 'bytes', 'variants']) {
      const f = adaptationFixture();
      if (mode === 'disabled') delete f.course.adaptation;
      if (mode === 'operation') f.course.adaptation!.targets[0]!.allowedOperations = ['attach_media'];
      if (mode === 'generator') variant(f).generator.version = '2.0.0';
      if (mode === 'bytes') f.course.adaptation!.limits.maxArtifactBytes = 1;
      if (mode === 'variants') f.plan.variantCounts = [{ familyId: 'ordering-family', count: 3 }];
      await reseal(f, mode !== 'generator' && mode !== 'variants');
      expect(await codes(f)).toContain(({ disabled: 'ADAPTATION_DISABLED', operation: 'AUTHOR_TARGET', generator: 'GENERATOR_NOT_ALLOWED', bytes: 'AUTHOR_LIMIT', variants: 'AUTHOR_LIMIT' })[mode]!);
    }
  });
  it('cannot replace an assessment block or suggest a protected profile change', async () => {
    const f = adaptationFixture(); const operation = f.proposal.operations.find(o => o.type === 'replace_teaching')!;
    if (operation.type !== 'replace_teaching') throw new Error('fixture'); operation.blockId = 'ordering-check';
    await reseal(f); expect(await codes(f)).toContain('AUTHOR_TARGET');
    const language = adaptationFixture('language'); const profile = language.proposal.artifacts.find(a => a.kind === 'profile_suggestion')!;
    if (profile.kind !== 'profile_suggestion') throw new Error('fixture'); profile.fieldId = 'mastery';
    await reseal(language); expect(await codes(language)).toContain('PROFILE_FIELD_NOT_ALLOWED');
    language.course.adaptation!.profileFieldIds.push('learner.mastery');
    expect(validateCourse(language.course).issues.map(i => i.code)).toContain('ADAPTATION_AUTHORING');
  });
  it('rejects media self-review without matching proof and invalid renderer references', async () => {
    const f = adaptationFixture('plant-observations'); const media = f.proposal.artifacts.find(a => a.kind === 'media')!;
    if (media.kind !== 'media') throw new Error('fixture'); media.media.review = 'unreviewed';
    await reseal(f); expect(await codes(f)).toContain('UNREVIEWED_MEDIA');
    const visual = adaptationFixture(); const a = visual.proposal.artifacts.find(a => a.kind === 'visual')!;
    if (a.kind !== 'visual') throw new Error('fixture'); a.visual.rendererId = 'unknown-renderer';
    await reseal(visual); expect(await codes(visual)).toContain('INVALID_VISUAL');
  });
  it('cannot use an author template outside its canonical family or a server verifier as a renderer', async () => {
    const f = adaptationFixture(); f.course.adaptation!.families[0]!.numericalRecipeIds = [];
    await reseal(f, true); expect(await codes(f)).toContain('RECIPE_NOT_ALLOWED');
    const visual = adaptationFixture(), a = visual.proposal.artifacts.find(a => a.kind === 'visual')!;
    if (a.kind !== 'visual') throw new Error('fixture');
    a.visual.rendererId = visual.course.adaptation!.verifiers[0]!.extensionId;
    await reseal(visual); expect(await codes(visual)).toContain('INVALID_VISUAL');
  });
  it('retains classification/cost decisions as separate unauthenticated author/server claims', async () => {
    const f = adaptationFixture(); const good = await validateAssignmentDecisions(f.proposal, context(f), f.assignments);
    expect(good.valid).toBe(true); if (good.valid && 'authorityAuthenticity' in good) expect(good.authorityAuthenticity).toBe('not_checked');
    for (const mode of ['missing', 'duplicate', 'changed-hash', 'cost', 'model-authority']) {
      const decisions = structuredClone(f.assignments);
      if (mode === 'missing') decisions.pop();
      if (mode === 'duplicate') decisions.push(structuredClone(decisions[0]!));
      if (mode === 'changed-hash') decisions[0]!.proposalDigest = '0'.repeat(64);
      if (mode === 'cost') decisions[0]!.plannedMinutes = 16;
      if (mode === 'model-authority') (decisions[0] as unknown as Record<string, unknown>).authority = 'model';
      expect((await validateAssignmentDecisions(f.proposal, context(f), decisions)).valid).toBe(false);
    }
  });
  it.each([NaN, Infinity, undefined, () => 1, BigInt(1)])('rejects nonfinite/non-JSON recipe or fixture values', async value => {
    const f = adaptationFixture(); (variant(f) as unknown as Record<string, unknown>).hiddenFixtures = { value };
    expect(await codes(f)).toContain('NOT_JSON');
  });
  it('rejects accessors without executing them, hidden properties and cycles', async () => {
    const f = adaptationFixture(); let calls = 0;
    Object.defineProperty(f.proposal, 'rationale', { get() { calls++; return 'unexpected'; }, enumerable: true });
    expect(await codes(f)).toContain('NOT_JSON'); expect(calls).toBe(0);
    const hidden = adaptationFixture(); Object.defineProperty(hidden.proposal, 'hidden', { value: 1 }); expect(await codes(hidden)).toContain('NOT_JSON');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect((await validateCourseAdaptation(cycle as unknown as CourseAdaptation, context(adaptationFixture()))).valid).toBe(false);
  });
});
