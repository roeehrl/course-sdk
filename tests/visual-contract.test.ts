import { describe, expect, it } from 'vitest';
import { publicationIssues, validateCourse } from '../src/index.js';
import { courseFixture } from './fixture.js';
import type { LegacyProgressionGate } from '../src/types.js';

function withVisual() {
  const course = courseFixture();
  course.extensions.push({
    id: 'example:vector', version: '1.0.0', platforms: ['web'], execution: 'declarative', capabilities: ['observation.emit'],
    entrypoint: 'renderers/vector.json', integrity: `sha256-${'a'.repeat(64)}`,
    accessibility: { keyboard: true, reducedMotion: true, textAlternative: 'A table describes the order.' },
  });
  course.visuals.push({
    id: 'order-view', rendererId: 'example:vector', platforms: ['web'], state: { values: [3, 8] }, scene: { nodes: ['left', 'right'] },
    layouts: { compact: { direction: 'vertical' }, expanded: { direction: 'horizontal' } },
    timeline: { durationMs: 1000, seekable: true, cues: [{ atMs: 0, event: 'begin' }, { atMs: 1000, event: 'end' }] },
    accessibility: { description: 'Three precedes eight.', reducedMotion: { mode: 'step' } }, referenceChecks: ['ascending-order'],
  });
  course.chapters[0]!.episodes[0]!.blocks.push({ id: 'picture', type: 'visual', visualId: 'order-view' });
  return course;
}

describe('renderer, media and platform contracts', () => {
  it('accepts a declared responsive visual with a reduced-motion path', () => {
    expect(validateCourse(withVisual()).valid).toBe(true);
  });
  it('rejects a visual claiming a platform its renderer does not support', () => {
    const course = withVisual(); course.visuals[0]!.platforms.push('ios');
    expect(validateCourse(course).issues.some((e) => e.code === 'UNSUPPORTED_PLATFORM')).toBe(true);
  });
  it('rejects a course requiring native support from a web-only activity', () => {
    const course = withVisual(); course.platforms.push('android');
    expect(validateCourse(course).issues.some((e) => e.code === 'UNSUPPORTED_PLATFORM')).toBe(true);
  });
  it.each([-1, 1001])('rejects timeline cues outside the duration', (atMs) => {
    const course = withVisual(); course.visuals[0]!.timeline.cues[1]!.atMs = atMs;
    expect(validateCourse(course).valid).toBe(false);
  });
  it('rejects reordered timeline cues', () => {
    const course = withVisual(); course.visuals[0]!.timeline.cues.reverse();
    expect(validateCourse(course).issues.some((e) => e.code === 'INVALID_TIMELINE')).toBe(true);
  });
  it.each(['../server.js', '/tmp/code.js', 'a/../../b.js', 'https://example.com/code.js', 'a\\b.js', 'a//b.js'])('rejects unsafe entrypoint %s', (entrypoint) => {
    const course = withVisual(); course.extensions[0]!.entrypoint = entrypoint;
    expect(validateCourse(course).issues.some((e) => e.code === 'UNSAFE_ENTRYPOINT')).toBe(true);
  });
  it('rejects required unreviewed media even when an alternative exists', () => {
    const course = courseFixture();
    course.sources.push({ id: 'reference', title: 'Reference', url: 'https://example.com/reference', reviewedAt: '2026-10-12T00:00:00Z' });
    course.media.push({ id: 'clip', type: 'video', sourceRef: 'reference', url: 'https://example.com/clip.mp4', review: 'unreviewed', generated: true, alternativeMarkdown: 'An original explanation.' });
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'video', type: 'media', mediaId: 'clip', required: true });
    expect(validateCourse(course).issues.some((e) => e.code === 'UNREVIEWED_REQUIRED_MEDIA')).toBe(true);
    course.media[0]!.review = 'reviewed';
    expect(validateCourse(course).valid).toBe(true);
  });
  it('does not accept a client renderer as an authoritative evaluator', () => {
    const course = withVisual();
    (course.gates[0] as LegacyProgressionGate).conversationalEvaluatorId = 'example:vector';
    expect(validateCourse(course).issues.some((e) => e.code === 'INVALID_EVALUATOR')).toBe(true);
  });

});

describe('required visual and activity accessibility', () => {
  const codes = (course: unknown) => { const r = validateCourse(course); return r.valid ? [] : r.issues; };
  it('rejects a required visual whose renderer has no keyboard support', () => {
    const course = withVisual(); course.extensions[0]!.accessibility.keyboard = false;
    expect(codes(course)).toEqual([expect.objectContaining({ code: 'INACCESSIBLE_VISUAL', path: '/chapters/0/episodes/0/blocks/2/visualId' })]);
  });
  it.each([['renderer text alternative', (c: ReturnType<typeof withVisual>) => { c.extensions[0]!.accessibility.textAlternative = ' \n\t'; }],
    ['visual description', (c: ReturnType<typeof withVisual>) => { c.visuals[0]!.accessibility.description = '   '; }]] as const)('rejects a required visual with a blank %s', (_name, blank) => {
    const course = withVisual(); blank(course);
    expect(codes(course).map((i) => i.code)).toEqual(['MISSING_TEXT_ALTERNATIVE']);
  });
  it('accepts a keyboard-less renderer when no lesson block requires its visual', () => {
    const course = withVisual(); course.extensions[0]!.accessibility.keyboard = false;
    course.chapters[0]!.episodes[0]!.blocks.pop();
    expect(validateCourse(course).valid).toBe(true);
  });
  it('rejects a legacy activity block whose extension has no keyboard path or text alternative', () => {
    const course = withVisual();
    course.extensions.push({ ...structuredClone(course.extensions[0]!), id: 'example:sorter', accessibility: { keyboard: false, reducedMotion: true, textAlternative: ' ' } });
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'sorter', type: 'activity', extensionId: 'example:sorter', configuration: {} });
    expect(codes(course).map((i) => i.code).sort()).toEqual(['INACCESSIBLE_ACTIVITY', 'MISSING_TEXT_ALTERNATIVE']);
  });
  it('rejects required media with a blank text alternative but accepts optional media', () => {
    const course = courseFixture();
    course.sources.push({ id: 'reference', title: 'Reference', url: 'https://example.com/reference', reviewedAt: '2026-10-12T00:00:00Z' });
    course.media.push({ id: 'clip', type: 'video', sourceRef: 'reference', url: 'https://example.com/clip.mp4', review: 'reviewed', generated: false, alternativeMarkdown: '  ' });
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'video', type: 'media', mediaId: 'clip', required: true });
    expect(codes(course).map((i) => i.code)).toEqual(['MISSING_TEXT_ALTERNATIVE']);
    (course.chapters[0]!.episodes[0]!.blocks.at(-1) as { required: boolean }).required = false;
    expect(validateCourse(course).valid).toBe(true);
  });
});

describe('legacy conversational gates', () => {
  const codes = (course: unknown) => { const r = validateCourse(course); return r.valid ? [] : r.issues; };
  it('still require the declared item families and objective coverage', () => {
    const course = withVisual();
    course.extensions.push({ id: 'grader', version: '1.0.0', platforms: ['web'], execution: 'server', capabilities: ['assessment.evaluate'],
      entrypoint: 'grader.js', integrity: `sha256-${'b'.repeat(64)}`, accessibility: { keyboard: true, reducedMotion: true, textAlternative: 'Server grader.' } });
    const gate = course.gates[0] as LegacyProgressionGate;
    gate.conversationalEvaluatorId = 'grader';
    expect(validateCourse(course).valid).toBe(true);
    gate.minimumIndependentFamilies = 5;
    expect(codes(course).map((i) => i.code)).toEqual(['INSUFFICIENT_ITEM_FAMILIES']);
    gate.minimumIndependentFamilies = 1; gate.assessmentIds = [];
    expect(codes(course).map((i) => i.code).sort()).toEqual(['INSUFFICIENT_ITEM_FAMILIES', 'UNCOVERED_GATE_OBJECTIVE']);
  });
  it('are refused for publication with the exact gate path', () => {
    const course = withVisual();
    course.extensions.push({ id: 'grader', version: '1.0.0', platforms: ['web'], execution: 'server', capabilities: ['assessment.evaluate'],
      entrypoint: 'grader.js', integrity: `sha256-${'b'.repeat(64)}`, accessibility: { keyboard: true, reducedMotion: true, textAlternative: 'Server grader.' } });
    expect(publicationIssues(course)).toEqual([]);
    (course.gates[0] as LegacyProgressionGate).conversationalEvaluatorId = 'grader';
    expect(publicationIssues(course)).toEqual([expect.objectContaining({ code: 'CONVERSATIONAL_GATE_UNSUPPORTED', path: '/gates/0/conversationalEvaluatorId' })]);
    expect(publicationIssues({}).length).toBeGreaterThan(0);
  });
});
