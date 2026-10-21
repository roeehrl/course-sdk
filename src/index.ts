export type * from './types.js';
export type * from './adaptation-types.js';
export type * from './research-types.js';
export type * from './contracts-types.js';
export type * from './record-types.js';
export { resolvePublicResearchRequest, validateResearchRequest, validateResearchResult } from './research.js';
export type { LearnerAdaptation, LearnerAdaptationArtifact } from './adaptation-projection.js';
export { validateCourse, learningPolicyIssues } from './validate.js';
export { getEpisodeRequirement } from './episode.js';
export { defineCourseAdaptation, validateCourseAdaptation, validateAssignmentDecisions } from './adaptation.js';
export { digestJson, digestTeachingArtifact, digestAdaptationProposal } from './integrity.js';
export { instantiateNumericalRecipe, evaluateNumericalRecipe, checkNumericalReference, numericalTemplateIssues } from './numerical-recipe.js';
export { AdaptationDataError } from './adaptation-shape.js';
export { SDK_VERSION } from './version.js';
export {
  CONTRACT_KINDS, ContractValidationError, validateContract,
  defineConcept, defineEpisode, defineAssessment, defineActivity, defineRubric, defineTool, defineAdaptationPolicy, defineLearningPolicy,
  defineAdminSection, defineLearningStep, defineProgressionGate, defineMediaResource, defineStoryboard, defineResearchTask, definePlacementPolicy,
  defineRenderer, defineEvaluator, defineAgentStrategy, definePlatformAdapter, defineDebugInspector, defineScene, defineTimeline,
  defineRendererAdapter, defineTeachingHypothesis, defineDiagnosticProbe, defineStage,
  defineCourse, defineVisualExperience, defineExtension, defineInteraction, defineVisualPane, defineVisualChecks, defineStudyInstruments, defineConceptMappingDraft,
  bindData, responsiveVariant, defineLocaleBundle, assembleCourse,
} from './define.js';
export {
  SUPPORTED_LANGUAGES, SUPPORTED_LOCALES, DEFAULT_COURSE_LOCALE, isSupportedLocale, canonicalLocale, localeLanguage, localeDirection, negotiateLocale,
} from './locale.js';
export type { SupportedLanguage, TextDirection } from './locale.js';
export {
  courseTextKeys, courseLocales, courseText, localeCoverage, localizeCourse, forEachTextSite, textStructure, structureDifferences, isLocalizedText,
} from './localization.js';
export type {
  LocalizedText, TextInput, TextSite, TextStructure, LocaleCoverage, LocalizableCourse, LocalizedCourse, CourseDraft, DataBindingInput, InteractionInput,
  VisualPaneInput, SceneInput, SceneLayerInput, VisualExperienceInput, ExtensionManifestInput,
} from './localization.js';
export { SDK_MESSAGES, SDK_MESSAGE_IDS, formatSdkMessage, formatSdkMessages, sdkMessageLanguage, sdkMessage } from './messages.js';
export type { SdkMessageId, SdkMessageParam } from './messages.js';
export type { ContractKind, ContractKinds } from './define.js';
export { RECORD_KINDS, validateRecord } from './records.js';
export { decideGate, checkGateDecision } from './gate-decision.js';
export type { GateDecisionContext, GateDecisionResult } from './gate-decision.js';
export { lintCourse } from './lint.js';
export { publicationIssues } from './publication.js';
export type { LintFinding } from './lint.js';
export { isVersionedGate, gateObjectiveIds, gateAssessmentIds, gateConversation, judgesConversation } from './contracts-validate.js';
export { buildConceptGraph, resolveRetentionIntervals } from './concepts.js';
export { adminSettingsSchema, adminSettingDefaults, checkAdminSettingChange } from './admin.js';
export type { AdminSettingChange } from './admin.js';
export { courseRoadmap } from './roadmap.js';
export { POLICY_FIXTURE_LIMITS, addCalendarDays, policyScopes, resolveCoursePolicy, runPolicyFixtures } from './policy-fixtures.js';
export type {
  PolicyAnchor, PolicyFixture, PolicyFixtureFile, PolicyFixtureOutcome, PolicyFixtureReport, PolicyFixtureStep, PolicyStepOutcome, PolicyWorkField, ResolvedCoursePolicy,
} from './policy-fixtures.js';
export type { Roadmap, RoadmapChapter, RoadmapGroup } from './roadmap.js';
export type { PlatformContract } from './contract-constants.js';
export {
  REQUIRED_ACTIVITY_FIELDS, PLATFORM_CONTRACT, platformContract,
  DEFAULT_REVIEW_INTERVALS_DAYS, PLATFORM_TARGETS, KNOWN_CAPABILITIES, FORBIDDEN_CAPABILITIES, RECOGNITION_TYPES, LAYOUT_BREAKPOINTS,
  MAX_EVENT_BYTES, MAX_STATE_BYTES, windowClass, targetsForPlatforms, VISUAL_CHECK_LIMITS, normalizeDigestNumbers,
} from './contract-constants.js';

