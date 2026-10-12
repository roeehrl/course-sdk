import type { CourseManifest, ValidationIssue } from './types.js';
import { numericalTemplateIssues } from './numerical-recipe.js';

export function adaptationAuthoringIssues(course: CourseManifest): ValidationIssue[] {
  const authoring = course.adaptation; if (!authoring) return [];
  const issues: ValidationIssue[] = [];
  const report = (message: string) => issues.push({ code: 'ADAPTATION_AUTHORING', path: '/adaptation', message });
  const sources = new Set(course.sources.map(s => s.id));
  const approvedSources = new Set(authoring.sourceRefs);
  function checkSources(refs: string[]) { if (refs.some(id => !sources.has(id) || !approvedSources.has(id))) report('Use declared, author-approved source references.'); }
  function unique(ids: string[]) { if (new Set(ids).size !== ids.length) report('Declaration IDs must be unique.'); }
  checkSources(authoring.sourceRefs);
  unique(authoring.targets.map(t => t.episodeId)); unique(authoring.families.map(f => f.familyId));
  unique(authoring.generators.map(g => g.id)); unique(authoring.verifiers.map(v => v.id)); unique(authoring.numericalRecipes.map(r => r.id));
  const episodes = course.chapters.flatMap(c => c.episodes);
  for (const target of authoring.targets) {
    const episode = episodes.find(e => e.id === target.episodeId);
    if (!episode || target.objectiveIds.some(id => !episode.objectiveIds.includes(id))) report('Adaptation target objectives must belong to its episode.');
    if (target.replaceableBlockIds.some(id => !episode?.blocks.some(b => b.id === id && b.type === 'text'))) report('Only declared existing text blocks may be replaced.');
  }
  for (const generator of authoring.generators) {
    checkSources(generator.sourceRefs);
    const extension = course.extensions.find(e => e.id === generator.extensionId);
    if (!extension?.capabilities.includes('teaching.generate') || extension.version !== generator.version) report('Generator must bind a matching declared extension and capability.');
  }
  for (const verifier of authoring.verifiers) {
    checkSources(verifier.sourceRefs);
    const extension = course.extensions.find(e => e.id === verifier.extensionId);
    if (extension?.execution !== 'server' || !extension.capabilities.includes('teaching.verify') || extension.version !== verifier.version) report('Verifier must bind a matching server extension with teaching.verify.');
  }
  for (const family of authoring.families) {
    const item = course.assessments.find(a => a.id === family.canonicalAssessmentId);
    if (!item || item.familyId !== family.familyId) report('Canonical family must reference an existing item in that family.');
    if (family.generatorIds.some(id => !authoring.generators.some(g => g.id === id && g.artifactKinds.includes('assessment_variant')))) report('Family generator is not declared for assessment variants.');
    if (family.verifierIds.some(id => !authoring.verifiers.some(v => v.id === id && v.artifactKinds.includes('assessment_variant')))) report('Family verifier is not declared for assessment variants.');
    if (family.numericalRecipeIds.some(id => !authoring.numericalRecipes.some(r => r.id === id)) || (family.numericalRecipeIds.length > 0 && item?.type !== 'numeric')) report('Numerical templates must be explicitly bound to an existing numeric family.');
  }
  const reserved = new Set(['mastery','credit','credits','grade','grading','score','consent','policy','cap','caps','evidence','completion','passed']);
  if (authoring.profileFieldIds.some(id => id.split(/[._:-]/).some(part => reserved.has(part)))) report('Profile suggestions cannot target authority, evidence or progression fields.');
  for (const recipe of authoring.numericalRecipes) {
    issues.push(...numericalTemplateIssues(recipe).map(i => ({ ...i, path: '/adaptation/numericalRecipes' + i.path })));
    checkSources(recipe.sourceRefs);
    const verifier = authoring.verifiers.find(v => v.id === recipe.referenceCheck.verifierId && v.version === recipe.referenceCheck.verifierVersion);
    if (!verifier || !verifier.artifactKinds.includes('assessment_variant') || !verifier.requiredCheckIds.includes(recipe.referenceCheck.checkId)) report('Numerical reference check must bind an author-declared assessment verifier/check.');
  }
  return issues;
}
