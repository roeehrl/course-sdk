import type { CourseAdaptation, TeachingArtifactKind } from './adaptation-types.js';

export interface LearnerAdaptationArtifact {
  id: string;
  digest: string;
  kind: TeachingArtifactKind;
  objectiveIds: string[];
  markdown?: string;
  media?: Extract<CourseAdaptation['artifacts'][number], { kind: 'media' }>['media'];
  visual?: Extract<CourseAdaptation['artifacts'][number], { kind: 'visual' }>['visual'];
  assessment?: { id: string; type: string; objectiveIds: string[] };
  suggestion?: { fieldId: string; proposedValue: string | number | boolean | null; rationale: string };
}
export interface LearnerAdaptation {
  id: string;
  status: 'proposal';
  baseCourseDigest: string;
  expectedPlanRevision: number;
  artifacts: LearnerAdaptationArtifact[];
  operations: CourseAdaptation['operations'];
}

/** Internal projection of validated data. It grants no right to deliver/apply it. */
export function projectLearnerAdaptation(proposal: CourseAdaptation): LearnerAdaptation {
  return {
    id: proposal.id, status: 'proposal', baseCourseDigest: proposal.baseCourseDigest, expectedPlanRevision: proposal.expectedPlanRevision,
    operations: structuredClone(proposal.operations),
    artifacts: proposal.artifacts.map(artifact => {
      const publicArtifact: LearnerAdaptationArtifact = { id: artifact.id, digest: artifact.digest, kind: artifact.kind, objectiveIds: [...artifact.objectiveIds] };
      if (artifact.kind === 'explanation' || artifact.kind === 'practice') publicArtifact.markdown = artifact.markdown;
      if (artifact.kind === 'media') publicArtifact.media = structuredClone(artifact.media);
      if (artifact.kind === 'visual') publicArtifact.visual = structuredClone(artifact.visual);
      if (artifact.kind === 'assessment_variant') publicArtifact.assessment = { id: artifact.assessment.id, type: artifact.assessment.type, objectiveIds: [...artifact.assessment.objectiveIds] };
      if (artifact.kind === 'profile_suggestion') publicArtifact.suggestion = { fieldId: artifact.fieldId, proposedValue: artifact.proposedValue, rationale: artifact.rationale };
      return publicArtifact;
    }),
  };
}
