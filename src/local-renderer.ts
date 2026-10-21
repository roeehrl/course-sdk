import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LocalRenderer } from './compat.js';
import type { VisualExperience } from './types.js';

/**
 * 0.6: finds the released Course Core visuals renderer (`@course-core/visuals`, installed by the
 * author from the Core release's course-core-visuals-<version>.tgz) for `course dev` and
 * `course compat`. The SDK does not depend on it: it is resolved from the course project's
 * node_modules, or from an explicit package directory, and only its `./headless` entry is loaded.
 * That entry renders sanitized SVG without React, a DOM or network access.
 */
export const VISUALS_PACKAGE = '@course-core/visuals';
/** renderSvg arrived in visuals 0.4.0. */
export const MINIMUM_VISUALS_VERSION = '0.4.0';

export interface VisualsRenderer extends LocalRenderer {
  directory: string;
  /** Path of the package's styles.css, if it has one. */
  stylesheet: string | null;
  /** Sanitized SVG for one visual's first frame, or an error to show in its place. */
  render(visual: VisualExperience, idPrefix: string): { svg: string } | { error: string };
}

interface HeadlessModule {
  RENDERER_ID: string;
  SUPPORTED_FEATURES: readonly string[];
  fromVisualExperience(experience: VisualExperience): unknown;
  evaluateScene(scene: unknown): unknown;
  renderSvg(frame: unknown, options: { idPrefix: string; title: string }): string;
}

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const exists = async (file: string) => (await lstat(file).catch(() => undefined))?.isFile() ?? false;
const versionAtLeast = (version: string, minimum: string) => {
  const [a, b] = [version, minimum].map(v => v.split(/[-+]/)[0]!.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (a![i] !== b![i]) return a![i]! > b![i]!;
  return true;
};

/** The visuals package directory: `explicit`, or the nearest node_modules/@course-core/visuals above `from`. */
export async function findVisualsPackage(from: string, explicit?: string): Promise<string | undefined> {
  if (explicit) return path.resolve(explicit);
  let directory = path.resolve(from);
  for (;;) {
    const candidate = path.join(directory, 'node_modules', ...VISUALS_PACKAGE.split('/'));
    if (await exists(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Loads the headless renderer from a visuals package directory. Throws a plain message when it is unusable. */
export async function loadVisualsRenderer(directory: string): Promise<VisualsRenderer> {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown; exports?: Record<string, unknown> };
  if (manifest.name !== VISUALS_PACKAGE) throw new Error(`${directory} is not the ${VISUALS_PACKAGE} package.`);
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version) || !versionAtLeast(manifest.version, MINIMUM_VISUALS_VERSION))
    throw new Error(`Preview needs ${VISUALS_PACKAGE} ${MINIMUM_VISUALS_VERSION} or later; found ${String(manifest.version)}.`);
  const entry = (manifest.exports?.['./headless'] as { import?: unknown } | undefined)?.import;
  if (typeof entry !== 'string') throw new Error(`${VISUALS_PACKAGE} ${manifest.version} has no ./headless entry.`);
  const file = path.resolve(directory, entry);
  if (path.relative(directory, file).startsWith('..') || !(await exists(file))) throw new Error(`${VISUALS_PACKAGE} ./headless points outside the package.`);
  const headless = await import(pathToFileURL(file).href) as Partial<HeadlessModule>;
  for (const name of ['fromVisualExperience', 'evaluateScene', 'renderSvg'] as const)
    if (typeof headless[name] !== 'function') throw new Error(`${VISUALS_PACKAGE} ${manifest.version} does not export ${name}.`);
  const module = headless as HeadlessModule;
  const stylesheet = path.join(directory, 'dist', 'styles.css');
  return {
    rendererId: module.RENDERER_ID, version: manifest.version, features: [...(module.SUPPORTED_FEATURES ?? [])].sort(), source: `${VISUALS_PACKAGE}@${manifest.version}`,
    directory, stylesheet: await exists(stylesheet) ? stylesheet : null,
    render(visual, idPrefix) {
      try {
        const svg = module.renderSvg(module.evaluateScene(module.fromVisualExperience(visual)), { idPrefix, title: visual.accessibility.description });
        return Buffer.byteLength(svg) > MAX_SVG_BYTES ? { error: `The rendered SVG exceeds ${MAX_SVG_BYTES} bytes.` } : { svg };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'The renderer failed.' };
      }
    },
  };
}
