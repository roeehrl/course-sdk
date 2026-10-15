import type { CourseManifest } from './types.js';
import type { CourseStage } from './contracts-types.js';

export interface RoadmapChapter { id: string; title: string; summary?: string; subtitle?: string; iconAsset?: string; episodeIds: string[] }
export interface RoadmapGroup { stage: CourseStage | null; chapters: RoadmapChapter[] }
export interface Roadmap { chapterLabel: string | null; groups: RoadmapGroup[] }

/**
 * Author-declared roadmap structure for a validated course: chapters in course order, grouped
 * into consecutive runs by `stageId` (a chapter without a stage forms an ungrouped run), with
 * the author's labels, subtitles and icon assets. Hosts render it instead of hard-coding
 * "Chapter" labels or icons; `chapterLabel` is null when the author declares none.
 * Learner progress states are host data and are not part of this structure.
 */
export function courseRoadmap(course: Pick<CourseManifest, 'chapters' | 'stages' | 'chapterLabel'>): Roadmap {
  const stages = new Map((course.stages ?? []).map(stage => [stage.id, stage]));
  const groups: RoadmapGroup[] = [];
  for (const chapter of course.chapters) {
    const stage = chapter.stageId !== undefined ? stages.get(chapter.stageId) ?? null : null;
    const entry: RoadmapChapter = { id: chapter.id, title: chapter.title, episodeIds: chapter.episodes.map(e => e.id) };
    if (chapter.summary !== undefined) entry.summary = chapter.summary;
    if (chapter.subtitle !== undefined) entry.subtitle = chapter.subtitle;
    if (chapter.iconAsset !== undefined) entry.iconAsset = chapter.iconAsset;
    const last = groups.at(-1);
    if (last && stage !== null && last.stage?.id === stage.id) last.chapters.push(entry);
    else groups.push({ stage: stage === null ? null : structuredClone(stage), chapters: [entry] });
  }
  return { chapterLabel: course.chapterLabel ?? null, groups };
}
