import { describe, expect, it } from 'vitest';
import { resolvePublicResearchRequest, validateCourse, type CourseManifest } from '../src/index.js';
import { compileCourse, verifyCompiledCourse } from '../src/compiler.js';
import { validateCourseAdaptation } from '../src/adaptation.js';
import { adaptationFixture, context } from './adaptation-fixture.js';
import { courseFixture } from './fixture.js';

function researchCourse(): CourseManifest {
  const course = courseFixture();
  course.research = { publicTopics: [{ id: 'ordering-public', objectiveIds: ['compare'],
    queryText: 'Public examples of ascending and descending numerical order', allowedDomains: ['reference.example'] }] };
  return course;
}

describe('author-approved public research boundary', () => {
  it('resolves only declared public text/domains and detaches all outputs', () => {
    const course = researchCourse();
    const selection = { topicId: 'ordering-public' };
    const result = resolvePublicResearchRequest(course, selection);
    expect(result).toEqual({ valid: true, authorityAuthenticity: 'not_checked', issues: [], request: {
      queryText: course.research!.publicTopics[0]!.queryText, allowedDomains: ['reference.example'],
    } });
    if (!result.valid) throw new Error('Expected resolution.');
    result.request.allowedDomains!.push('changed.example');
    result.request.queryText = 'Changed';
    expect(course.research!.publicTopics[0]!.allowedDomains).toEqual(['reference.example']);
    expect(selection).toEqual({ topicId: 'ordering-public' });
  });

  it('supports unrelated domains and topics without a provider or domain allowlist', () => {
    const course = researchCourse();
    course.research!.publicTopics.push({ id: 'comparison-language', objectiveIds: ['compare'], queryText: 'Public language used to describe comparisons' });
    expect(resolvePublicResearchRequest(course, { topicId: 'comparison-language' })).toMatchObject({
      valid: true, request: { queryText: 'Public language used to describe comparisons' },
    });
    const selected = resolvePublicResearchRequest(course, { topicId: 'comparison-language' });
    if (!selected.valid) throw new Error('Expected resolution.');
    expect(Object.keys(selected.request)).toEqual(['queryText']);
    course.research!.publicTopics[0]!.allowedDomains = ['xn--bcher-kva.example', 'another.reference.example'];
    expect(validateCourse(course).valid).toBe(true);
  });

  it('fails closed without opt-in or for an invented topic ID; query text cannot substitute for ID', () => {
    expect(validateCourse(courseFixture()).valid).toBe(true);
    expect(resolvePublicResearchRequest(courseFixture(), { topicId: 'ordering-public' }).valid).toBe(false);
    const result = resolvePublicResearchRequest(researchCourse(), { topicId: 'invented' });
    expect(result).toMatchObject({ valid: false, issues: [{ code: 'UNAPPROVED_RESEARCH_TOPIC' }] });
    expect(resolvePublicResearchRequest(researchCourse(), { topicId: researchCourse().research!.publicTopics[0]!.queryText }).valid).toBe(false);
  });

  it.each(['queryText', 'query', 'publicResearchTopic', 'allowedDomains', 'objectiveIds', 'profile', 'history', 'answers',
    'privateOperationalContext', 'context', 'approved', 'role'])('rejects selection field %s instead of merging it', key => {
    const result = resolvePublicResearchRequest(researchCourse(), { topicId: 'ordering-public', [key]: 'PRIVATE_SENTINEL' });
    expect(result.valid).toBe(false);
    expect('request' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
  });

  it('never projects other course data or performs template substitution', () => {
    const course = researchCourse();
    course.summary = 'SYNTHETIC_PRIVATE_SENTINEL';
    course.assessments[0]!.prompt = 'SYNTHETIC_PRIVATE_SENTINEL';
    course.research!.publicTopics[0]!.queryText = 'Literal public notation {{profile}} and ${history}';
    const result = resolvePublicResearchRequest(course, { topicId: 'ordering-public' });
    expect(result).toMatchObject({ valid: true, request: { queryText: 'Literal public notation {{profile}} and ${history}' } });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_SENTINEL');
  });

  it('makes no authenticity or semantic publicity claim for well-shaped author data', () => {
    const untrustedCandidate = researchCourse();
    untrustedCandidate.research!.publicTopics[0]!.queryText = 'Candidate text which still requires author approval';
    const result = resolvePublicResearchRequest(untrustedCandidate, { topicId: 'ordering-public' });
    expect(result).toMatchObject({ valid: true, authorityAuthenticity: 'not_checked' });
    // The host must select the trusted manifest; a data validator cannot identify its author.
    expect('authorized' in result).toBe(false);
  });

  it.each([null, {}, [], 'ordering-public', { topicId: 'ordering-public', extra: undefined }, { topicId: NaN },
    { topicId: 'ordering-public\n' }, { topicId: 'a'.repeat(129) }, { topicId: 'Ordering-Public' }])('rejects invalid selectors: %j', selector => {
    expect(resolvePublicResearchRequest(researchCourse(), selector).valid).toBe(false);
  });

  it('rejects accessors and prototype authority without invoking them', () => {
    let reads = 0;
    const getter = { get topicId() { reads++; return 'ordering-public'; } };
    expect(resolvePublicResearchRequest(researchCourse(), getter).valid).toBe(false);
    const hidden = Object.defineProperty({ topicId: 'ordering-public' }, 'privateContext', { value: 'PRIVATE_SENTINEL' });
    expect(resolvePublicResearchRequest(researchCourse(), hidden).valid).toBe(false);
    expect(resolvePublicResearchRequest(researchCourse(), Object.create({ topicId: 'ordering-public' })).valid).toBe(false);
    expect(reads).toBe(0);
  });

  it('rejects duplicate IDs, invented or duplicate objectives, and unknown author fields', () => {
    const base = researchCourse();
    for (const mutate of [
      (c: CourseManifest) => c.research!.publicTopics.push(structuredClone(c.research!.publicTopics[0]!)),
      (c: CourseManifest) => c.research!.publicTopics[0]!.objectiveIds.push('invented'),
      (c: CourseManifest) => c.research!.publicTopics[0]!.objectiveIds.push('compare'),
      (c: CourseManifest) => c.research!.publicTopics[0]!.objectiveIds.splice(0),
      (c: CourseManifest) => Object.assign(c.research!, { privateContext: {} }),
      (c: CourseManifest) => Object.assign(c.research!.publicTopics[0]!, { approvedByModel: true }),
      (c: CourseManifest) => Object.assign(c.research!.publicTopics[0]!, { queryTemplate: '{{answers}}' }),
      (c: CourseManifest) => { c.research!.publicTopics = []; },
      (c: CourseManifest) => { c.research!.publicTopics[0]!.id += '\n'; },
    ]) {
      const course = structuredClone(base); mutate(course);
      expect(validateCourse(course).valid).toBe(false);
      expect(resolvePublicResearchRequest(course, { topicId: 'ordering-public' }).valid).toBe(false);
    }
  });

  it.each(['', '   \n\t', 'a'.repeat(2049), 42, null])('rejects invalid query %j', queryText => {
    const course = researchCourse(); Object.assign(course.research!.publicTopics[0]!, { queryText });
    expect(validateCourse(course).valid).toBe(false);
  });

  it.each(['https://reference.example', 'reference.example/path', '*.example', 'user@reference.example',
    'reference.example:443', 'Reference.example', 'reference.example.', 'reference.example\n', 'reference.example?query',
    '-reference.example', 'reference-.example', 'reference..example', '127.0.0.1', '[::1]', 'bücher.example',
    'a'.repeat(64) + '.example', 'a.'.repeat(125) + 'example'])('rejects noncanonical domain %s', domain => {
    const course = researchCourse(); course.research!.publicTopics[0]!.allowedDomains = [domain];
    expect(validateCourse(course).valid).toBe(false);
  });

  it('rejects empty, duplicate, excessive, and nonstring domain declarations', () => {
    for (const allowedDomains of [[], ['reference.example', 'reference.example'], Array.from({ length: 101 }, (_, i) => `site${i}.example`), [null]]) {
      const course = researchCourse(); Object.assign(course.research!.publicTopics[0]!, { allowedDomains });
      expect(validateCourse(course).valid).toBe(false);
    }
  });

  it('retains author research only in the server projection and course digest', () => {
    const course = researchCourse(); const compiled = compileCourse(course);
    expect(compiled.server.research).toEqual(course.research);
    expect('research' in compiled.learner).toBe(false);
    expect(verifyCompiledCourse(compiled)).toBe(true);
    const altered = structuredClone(compiled);
    altered.server.research!.publicTopics[0]!.queryText = 'Different author text';
    expect(verifyCompiledCourse(altered)).toBe(false);
    expect(compileCourse(altered.server).digest).not.toBe(compiled.digest);
  });

  it('does not let an adaptation proposal approve public research', async () => {
    const f = adaptationFixture();
    expect((await validateCourseAdaptation({ ...f.proposal, research: researchCourse().research }, context(f))).valid).toBe(false);
  });
});
