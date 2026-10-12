import { describe, expect, it } from 'vitest';
import { compileCourse, compileCourseAdaptation, verifyCompiledCourse, verifyCompiledCourseAdaptation } from '../src/compiler.js';
import { digestJson } from '../src/integrity.js';
import { adaptationFixture, context, reseal } from './adaptation-fixture.js';
import { courseFixture } from './fixture.js';
import type { TeachingArtifact } from '../src/adaptation-types.js';

describe('immutable courses and generated learner projection', () => {
  it('keeps existing schema-1 / format-1 courses compatible without opt-in', () => {
    const base = courseFixture(); const result = compileCourse(base);
    expect(result.server.schemaVersion).toBe(1); expect(result.formatVersion).toBe(1);
    expect(result.server).toEqual(base); expect(verifyCompiledCourse(result)).toBe(true);
    expect(result.server).not.toHaveProperty('adaptation');
  });
  it.each(['ordering', 'language', 'plant-observations'])('separates base, proposal, plan and artifact identities for %s', async domain => {
    const f = adaptationFixture(domain), before = structuredClone(f.course);
    const base = compileCourse(f.course), adaptation = await compileCourseAdaptation(f.proposal, context(f));
    expect(base.digest).toBe(f.baseCourseDigest); expect(base.digest).toBe(await digestJson(base.server));
    expect(adaptation.proposedPlan.baseCourseDigest).toBe(base.digest);
    expect(adaptation.proposedPlan.revision).toBe(f.plan.revision + 1);
    expect(adaptation.proposedPlan.digest).not.toBe(base.digest);
    expect(adaptation.server.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.digest))).toBe(true);
    expect(f.course).toEqual(before); expect(compileCourse(f.course).digest).toBe(base.digest);
    expect(adaptation.status).toBe('proposal'); expect(adaptation.applicationAuthority).toBe('not_checked');
    expect(await verifyCompiledCourseAdaptation(adaptation, context(f))).toBe(true);
  });
  it('strips author templates and generated item banks, recipes, answers, receipts and hidden fixtures', async () => {
    for (const domain of ['ordering', 'language', 'plant-observations']) {
      const f = adaptationFixture(domain), base = compileCourse(f.course), compiled = await compileCourseAdaptation(f.proposal, context(f));
      expect(base.learner).not.toHaveProperty('adaptation');
      const learner = JSON.stringify(compiled.learner);
      for (const secret of ['correctOptionId', 'absoluteTolerance', 'hiddenFixtures', 'negativeAnswers', 'FIXTURE_NOT_FOR_LEARNER', 'proofReceipts', 'receiptRef', 'templateDigest', 'promptTemplate']) expect(learner).not.toContain(secret);
      const original = f.proposal.artifacts.find(a => a.kind === 'assessment_variant') as Extract<TeachingArtifact, { kind: 'assessment_variant' }>;
      expect(learner).not.toContain(original.assessment.prompt);
      const projected = compiled.learner.artifacts.find(a => a.kind === 'assessment_variant')!;
      expect(Object.keys(projected.assessment!).sort()).toEqual(['id', 'objectiveIds', 'type']);
      expect(compiled.server.artifacts.some(a => a.kind === 'assessment_variant' && a.hiddenFixtures)).toBe(true);
    }
  });
  it('hides generated code fixture references and data, while retaining them on the server', async () => {
    const f = adaptationFixture(), artifact = f.proposal.artifacts.find(a => a.kind === 'assessment_variant') as Extract<TeachingArtifact, { kind: 'assessment_variant' }>;
    f.course.extensions[1]!.capabilities.push('assessment.evaluate');
    const code = { id: f.course.assessments[0]!.id, type: 'code' as const, objectiveIds: f.course.objectives.map(o => o.id), familyId: f.course.assessments[0]!.familyId,
      prompt: 'Implement ordering.', language: 'python', starterCode: 'def order(values):\n    pass', grading: { evaluatorId: f.course.extensions[1]!.id, fixtureRef: 'canonical-tests' } };
    f.course.assessments = [code]; artifact.assessment = { ...code, id: 'generated-code-item', grading: { ...code.grading, fixtureRef: 'SECRET_GENERATED_FIXTURE_REF' } };
    f.course.adaptation!.families[0]!.numericalRecipeIds = [];
    delete artifact.recipe; artifact.hiddenFixtures = { cases: [{ input: [9, 4], expected: [4, 9] }] };
    await reseal(f, true);
    const compiled = await compileCourseAdaptation(f.proposal, context(f));
    expect(JSON.stringify(compiled.learner)).not.toContain('SECRET_GENERATED_FIXTURE_REF');
    expect(JSON.stringify(compiled.learner)).not.toContain('starterCode');
    expect(JSON.stringify(compiled.server)).toContain('SECRET_GENERATED_FIXTURE_REF');
  });
  it('detects learner/server tampering, forged authority flags and outdated context on verification', async () => {
    const f = adaptationFixture(), original = await compileCourseAdaptation(f.proposal, context(f));
    for (const change of ['learner', 'server', 'authority', 'plan']) {
      const compiled = structuredClone(original);
      if (change === 'learner') compiled.learner.artifacts[0]!.markdown = 'tampered';
      if (change === 'server') compiled.server.rationale = 'tampered';
      if (change === 'authority') (compiled as unknown as Record<string, unknown>).proofAuthenticity = 'verified';
      if (change === 'plan') compiled.proposedPlan.digest = '0'.repeat(64);
      expect(await verifyCompiledCourseAdaptation(compiled, context(f))).toBe(false);
    }
    f.plan.revision++;
    expect(await verifyCompiledCourseAdaptation(original, context(f))).toBe(false);
    expect(await verifyCompiledCourseAdaptation(null, context(f))).toBe(false);
  });
});
