import type { CourseManifest } from '../src/types.js';

export function courseFixture(): CourseManifest {
  return {
    schemaVersion: 1, id: 'sorting-basics', version: '0.1.0', title: 'Sorting basics',
    summary: 'A small public course for contract testing.', locale: 'en', platforms: ['web'],
    objectives: [{ id: 'compare', description: 'Compare two numbers.', prerequisites: [], placeable: true }],
    chapters: [{ id: 'start', title: 'Ordering', episodes: [{
      id: 'compare-pair', title: 'Compare a pair', objectiveIds: ['compare'], gateId: 'compare-ready',
      blocks: [{ id: 'explain', type: 'text', markdown: 'Compare 3 and 8. Three comes first in ascending order.' }, { id: 'check', type: 'assessment', assessmentId: 'pair-a' }],
    }] }],
    assessments: [
      { id: 'pair-a', type: 'choice', objectiveIds: ['compare'], familyId: 'pair-order', prompt: 'Which comes first: 3 or 8?', options: [{ id: 'three', text: '3' }, { id: 'eight', text: '8' }], grading: { correctOptionId: 'three', explanation: 'Three is less than eight.' } },
      { id: 'pair-b', type: 'numeric', objectiveIds: ['compare'], familyId: 'minimum', prompt: 'Enter the smaller number in 4 and 9.', grading: { expected: 4, absoluteTolerance: 0, explanation: 'Four is the smaller value.' } },
    ],
    gates: [{ id: 'compare-ready', objectiveIds: ['compare'], assessmentIds: ['pair-a', 'pair-b'], minimumIndependentFamilies: 2, requireAllObjectives: true }],
    sources: [], extensions: [], visuals: [], media: [],
    policy: { mode: 'bounded', window: { calendarDays: 30, anchor: 'enrollment_started', timeZone: 'UTC', pauseRule: 'approved_only' }, existingMaterialAccess: 'read_only' },
    placement: { enabled: true, learnerMayDecline: true, objectiveIds: ['compare'], assessmentIds: ['pair-a', 'pair-b'], protectedEpisodeIds: [], maxItems: 2 },
  };
}
