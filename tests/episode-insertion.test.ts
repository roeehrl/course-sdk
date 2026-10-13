import { describe, expect, it } from 'vitest';
import { validateAssignmentDecisions, validateCourseAdaptation } from '../src/adaptation.js';
import { projectLearnerAdaptation } from '../src/adaptation-projection.js';
import { adaptationFixture, context, reseal } from './adaptation-fixture.js';
import type { TeachingArtifact } from '../src/adaptation-types.js';

/** Turns the fixture's appended explanation into a whole personal episode. */
async function episodeFixture(change: (f: ReturnType<typeof adaptationFixture>) => void = () => {}) {
  const f = adaptationFixture();
  for (const kinds of [f.course.adaptation!.verifiers[0]!.artifactKinds, f.registeredVerifiers[0]!.artifactKinds, f.course.adaptation!.generators[0]!.artifactKinds]) kinds.push('episode');
  f.course.adaptation!.targets[0]!.allowedOperations.push('insert_episode');
  const artifact = f.proposal.artifacts.find(a => a.kind === 'explanation')!;
  const episode = { ...artifact, kind: 'episode', title: 'Why the running minimum works', blocks: [
    { id: 'remedial-block-1', markdown: 'Keep the smallest value seen so far.' },
    { id: 'remedial-block-2', markdown: 'Compare every next value with it; keep the smaller.' },
  ] } as unknown as TeachingArtifact;
  delete (episode as unknown as { markdown?: string }).markdown;
  f.proposal.artifacts[f.proposal.artifacts.indexOf(artifact)] = episode;
  const operation = f.proposal.operations.find(o => o.artifactId === artifact.id)!;
  f.proposal.operations[f.proposal.operations.indexOf(operation)] = { id: operation.id, type: 'insert_episode', afterEpisodeId: 'ordering-episode', artifactId: artifact.id };
  f.assignments.find(a => a.operationId === operation.id)!.additionalEpisodes = 1;
  change(f);
  await reseal(f, true);
  return f;
}
const codes = async (f: Awaited<ReturnType<typeof episodeFixture>>) => (await validateCourseAdaptation(f.proposal, context(f))).issues.map(i => i.code);

describe('whole personal episodes', () => {
  it('accepts an author-permitted inserted episode metered as an additional episode', async () => {
    const f = await episodeFixture();
    const result = await validateCourseAdaptation(f.proposal, context(f));
    expect(result.valid, JSON.stringify(result.issues)).toBe(true);
    expect((await validateAssignmentDecisions(f.proposal, context(f), f.assignments)).valid).toBe(true);
    const learner = projectLearnerAdaptation(f.proposal);
    expect(learner.artifacts.find(a => a.kind === 'episode')?.episode?.blocks).toHaveLength(2);
  });
  it('rejects unmetered, unpermitted, misplaced, mismatched or colliding insertions', async () => {
    const unmetered = await episodeFixture(f => { f.assignments.find(a => a.operationId === 'ordering-explanation-operation')!.additionalEpisodes = 0; });
    expect((await validateAssignmentDecisions(unmetered.proposal, context(unmetered), unmetered.assignments)).issues.map(i => i.code)).toContain('EPISODE_COST_REQUIRED');
    expect(await codes(await episodeFixture(f => { f.course.adaptation!.targets[0]!.allowedOperations = f.course.adaptation!.targets[0]!.allowedOperations.filter(o => o !== 'insert_episode'); }))).toContain('AUTHOR_TARGET');
    expect(await codes(await episodeFixture(f => { (f.proposal.operations.find(o => o.type === 'insert_episode') as { afterEpisodeId: string }).afterEpisodeId = 'no-such-episode'; }))).toContain('MISSING_REFERENCE');
    expect(await codes(await episodeFixture(f => { (f.proposal.artifacts.find(a => a.kind === 'episode') as unknown as { blocks: { id: string }[] }).blocks[0]!.id = 'ordering-text'; }))).toContain('DUPLICATE_ID');
    expect(await codes(await episodeFixture(f => {
      const op = f.proposal.operations.find(o => o.type === 'insert_episode')!;
      (op as { artifactId: string }).artifactId = f.proposal.artifacts.find(a => a.kind === 'practice')!.id;
      const prior = f.proposal.operations.find(o => o.type === 'replace_teaching')!;
      (prior as { artifactId: string }).artifactId = f.proposal.artifacts.find(a => a.kind === 'episode')!.id;
    }))).toContain('ARTIFACT_KIND');
  });
});
