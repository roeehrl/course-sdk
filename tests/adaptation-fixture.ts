import { readFileSync } from 'node:fs';
import { digestAdaptationProposal, digestJson, digestTeachingArtifact } from '../src/integrity.js';
import type { ActivityAssignmentDecision, AdaptationValidationContext, CourseAdaptation } from '../src/adaptation-types.js';

export interface PublicAdaptationFixture extends AdaptationValidationContext {
  proposal: CourseAdaptation;
  assignments: ActivityAssignmentDecision[];
}
export function adaptationFixture(domain = 'ordering'): PublicAdaptationFixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/${domain}.adaptation.json`, import.meta.url), 'utf8')) as PublicAdaptationFixture;
}
export function context(fixture: PublicAdaptationFixture): AdaptationValidationContext {
  const { course, baseCourseDigest, plan, registeredVerifiers } = fixture;
  return { course, baseCourseDigest, plan, registeredVerifiers };
}
/** Test-only resealing does not authenticate fixture receipts. */
export async function reseal(fixture: PublicAdaptationFixture, changedCourse = false) {
  if (changedCourse) {
    fixture.baseCourseDigest = await digestJson(fixture.course);
    fixture.plan.baseCourseDigest = fixture.baseCourseDigest;
    fixture.proposal.baseCourseDigest = fixture.baseCourseDigest;
    fixture.plan.digest = await digestJson({ baseCourseDigest: fixture.baseCourseDigest, revision: fixture.plan.revision });
    fixture.proposal.expectedPlanDigest = fixture.plan.digest;
  }
  for (const artifact of fixture.proposal.artifacts) artifact.digest = await digestTeachingArtifact(artifact);
  const proposalDigest = await digestAdaptationProposal(fixture.proposal);
  for (const receipt of fixture.proposal.proofReceipts) {
    receipt.proposalDigest = proposalDigest;
    const artifact = fixture.proposal.artifacts.find(a => a.id === receipt.artifactId);
    if (artifact) receipt.artifactDigest = artifact.digest;
  }
  fixture.assignments.forEach(decision => { decision.proposalDigest = proposalDigest; });
}
