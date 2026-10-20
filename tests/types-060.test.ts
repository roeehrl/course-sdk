import { describe, expect, it } from 'vitest';
import { bindData, responsiveVariant } from '../src/index.js';
import type {
  Assessment, ConceptMappingDraft, DataBinding, Interaction, LearningStepKind, RenderFeature, SceneLayer, StudyInstruments, VisualExperience, VisualLayouts, VisualPane,
} from '../src/index.js';

/**
 * Compile-time checks for the 0.6 contract additions: tsc (npm run typecheck) fails if an
 * accepted shape stops compiling or a rejected one (marked @ts-expect-error) starts to.
 */
const features: RenderFeature[] = ['symbol', 'spring', 'stagger', 'layout_set', 'panes', 'mask'];
// @ts-expect-error not a render feature
const unknownFeature: RenderFeature = 'sparkle';

const step: LearningStepKind = 'pre_test';
// @ts-expect-error not a step kind
const unknownStep: LearningStepKind = 'post_test';

const code: Assessment = { id: 'c', type: 'code', objectiveIds: ['o'], prompt: 'p', familyId: 'f', language: 'python', starterCode: '', grading: { evaluatorId: 'e', fixtureRef: 'x' }, browserExecution: 'python' };
// @ts-expect-error browser execution is python or none
const node: Assessment = { id: 'c', type: 'code', objectiveIds: ['o'], prompt: 'p', familyId: 'f', language: 'js', starterCode: '', grading: { evaluatorId: 'e', fixtureRef: 'x' }, browserExecution: 'node' };
// @ts-expect-error only code and code_repair items take browserExecution
const numeric: Assessment = { id: 'n', type: 'numeric', objectiveIds: ['o'], prompt: 'p', familyId: 'f', grading: { expected: 1, absoluteTolerance: 0, explanation: 'e' }, browserExecution: 'none' };

const layouts: VisualLayouts = responsiveVariant({ compact: {}, tabletPortrait: {}, tabletLandscape: {}, wide: {} });
// Never called: only the types are checked.
const partialSet = () =>
  // @ts-expect-error responsiveVariant builds the whole four-layout set
  responsiveVariant({ compact: {}, tabletPortrait: {}, wide: {} });
const visual: Pick<VisualExperience, 'layouts' | 'requiredFeatures'> = { layouts, requiredFeatures: ['layout_set'] };

const binding: DataBinding = bindData('length', { range: { min: 0, max: 1 } });
const objectBinding = () =>
  // @ts-expect-error bindData names a state key
  bindData({ state: 'length' });
const interaction: Interaction = { id: 'i', kind: 'scrub', target: 't', label: 'Time', binding, alternative: { kind: 'control' } };
// @ts-expect-error not an interaction kind
const swipe: Interaction = { ...interaction, kind: 'swipe' };

const pane: VisualPane = { id: 'f', kind: 'formula', title: 'F', tex: 'x', label: 'x' };
// @ts-expect-error a formula pane needs its text alternative
const unlabeled: VisualPane = { id: 'f', kind: 'formula', title: 'F', tex: 'x' };

const use: SceneLayer = { id: 'u', kind: 'use', symbol: 's', semanticNodeIds: [], decorative: true, label: 'Token' };

const instruments: StudyInstruments = { pre: ['a'], post: ['b'], allowedArms: [{ id: 'x', label: 'X', behaviour: 'chat_only' }, { id: 'y', label: 'Y', behaviour: 'fixed' }] };
// @ts-expect-error not an arm behaviour
const tutorArm: StudyInstruments = { pre: [], post: [], allowedArms: [{ id: 'x', label: 'X', behaviour: 'tutor' }] };

const draft: ConceptMappingDraft = { id: 'd', status: 'draft', otherCourse: { id: 'other' }, links: [{ relation: 'overlaps', from: { course: 'this', objectiveId: 'a' }, to: { course: 'other', objectiveId: 'b' } }] };
// @ts-expect-error a mapping in an SDK course is always a draft
const applied: ConceptMappingDraft = { ...draft, status: 'applied' };

describe('0.6 compile-time contract checks', () => {
  it('compile (checked by tsc) and keep their runtime values', () => {
    expect([features.length, step, code.type, layouts.expanded, visual.requiredFeatures, interaction.kind, pane.kind, use.kind, instruments.pre, draft.status])
      .toEqual([6, 'pre_test', 'code', {}, ['layout_set'], 'scrub', 'formula', 'use', ['a'], 'draft']);
    expect([unknownFeature, unknownStep, node.type, numeric.type, swipe.kind, unlabeled.kind, tutorArm.pre, applied.status]).toHaveLength(8);
    expect(partialSet).toThrow(); expect(objectBinding).toThrow();
  });
});
