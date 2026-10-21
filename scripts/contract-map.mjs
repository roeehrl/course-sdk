// Public contract and record kinds and the course.schema.json definition behind each.
// Shared by the validator and type generators so both cover the same kinds.
export const CONTRACT_DEFINITIONS = Object.freeze({
  concept: 'concept', episode: 'episode', assessment: 'assessment', activity: 'activityDefinition', rubric: 'rubricDefinition',
  tool: 'toolDefinition', adaptationPolicy: 'adaptationPolicy', learningPolicy: 'policy', adminSection: 'adminSection',
  learningStep: 'learningStep', progressionGate: 'versionedGate', mediaResource: 'media', storyboard: 'storyboard',
  researchTask: 'researchTask', placementPolicy: 'placement', extension: 'extension', renderer: 'rendererDefinition',
  evaluator: 'evaluatorDefinition', agentStrategy: 'agentStrategy', platformAdapter: 'platformAdapter', debugInspector: 'debugInspector',
  visualExperience: 'visual', scene: 'scene', timeline: 'timeline', rendererAdapter: 'rendererAdapter',
  interaction: 'interaction', dataBinding: 'dataBinding', visualLayouts: 'visualLayouts', visualPane: 'visualPane', visualChecks: 'visualChecks',
  studyInstruments: 'studyInstruments', conceptMappingDraft: 'conceptMappingDraft',
  teachingHypothesis: 'hypothesisTemplate', diagnosticProbe: 'diagnosticProbe', stage: 'stage', localeBundle: 'localeBundle',
});
const records = ['attempt', 'evidence', 'gateDecision', 'teachingHypothesis', 'interventionPlan', 'learnerClaim',
  'researchRequest', 'researchResult', 'mediaReview', 'mediaJob', 'placementEvidence', 'pathExemption', 'resolvedConstraintSnapshot',
  'extensionAllowance', 'extensionOffer', 'extensionGrant', 'closureOutcome', 'platformCapabilities', 'adminCapability',
  'toolCapability', 'artifactValidation', 'activityInstance', 'episodeRevision', 'conceptGraph', 'debugTrace', 'decisionRecord',
  'contextCapsule', 'learningEventExport'];
export const RECORD_DEFINITIONS = Object.freeze({
  ...Object.fromEntries(records.map(name => [name, name])),
  // Design names for existing records.
  mediaCandidate: 'researchResult', rubricRevision: 'rubricDefinition',
});
