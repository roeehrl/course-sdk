import { describe, expect, it } from 'vitest';
import { validateCourse } from '../src/index.js';
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
