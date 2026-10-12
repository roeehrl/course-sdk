import { expect, it } from 'vitest';
import { digestTeachingArtifact } from '../src/integrity.js';
import type { ArtifactVerifierPort, ExerciseGeneratorPort, TeachingArtifact, TeachingArtifactDraft } from '../src/adaptation-types.js';
import { adaptationFixture } from './adaptation-fixture.js';

it('uses the same generator/verifier ports for a nonnumerical creator plugin', async () => {
  const f = adaptationFixture('language');
  const original = f.proposal.artifacts.find(a => a.kind === 'assessment_variant')!;
  const generator: ExerciseGeneratorPort = {
    registration: f.course.adaptation!.generators[0]!,
    async generate(input) {
      expect(input.objectiveIds).toEqual(original.objectiveIds);
      expect(input.canonicalAssessment?.familyId).toBe('language-family');
      const { digest: _digest, ...draft } = structuredClone(original);
      return draft as TeachingArtifactDraft;
    },
  };
  const verifier: ArtifactVerifierPort = {
    registration: f.registeredVerifiers[0]!,
    async verify({ artifact, requiredCheckIds }) {
      // The test plugin's independent reference is a tiny declared phrase table,
      // not the generator's answer key. Real semantic review remains host-owned.
      const item = artifact.kind === 'assessment_variant' ? artifact.assessment : undefined;
      const referenceOption = item?.type === 'choice' ? item.options.find(o => o.text === 'Good morning; please come in.')?.id : undefined;
      const matched = item?.type === 'choice' && referenceOption === item.grading.correctOptionId;
      return { artifactDigest: await digestTeachingArtifact(artifact),
        checks: requiredCheckIds.map(id => ({ id, result: matched ? 'passed' : 'failed' })), evidenceRefs: ['phrase-reference-result'] };
    },
  };
  const draft = await generator.generate({ baseCourseDigest: f.baseCourseDigest, objectiveIds: original.objectiveIds,
    canonicalAssessment: f.course.assessments[0]!, sourceRefs: original.sourceRefs, specification: { scenario: 'arriving visitor' } }, {});
  const artifact = { ...draft, digest: await digestTeachingArtifact(draft) } as TeachingArtifact;
  const report = await verifier.verify({ baseCourseDigest: f.baseCourseDigest, proposalDigest: f.proposal.proofReceipts[0]!.proposalDigest,
    artifact, requiredCheckIds: ['reference'] }, {});
  expect(report.checks[0]!.result).toBe('passed'); expect(report).not.toHaveProperty('authenticated');
  if (artifact.kind !== 'assessment_variant' || artifact.assessment.type !== 'choice') throw new Error('fixture');
  artifact.assessment.grading.correctOptionId = 'leaving';
  const bad = await verifier.verify({ baseCourseDigest: f.baseCourseDigest, proposalDigest: f.proposal.proofReceipts[0]!.proposalDigest,
    artifact, requiredCheckIds: ['reference'] }, {});
  expect(bad.checks[0]!.result).toBe('failed'); expect(bad.artifactDigest).not.toBe(artifact.digest);
});
