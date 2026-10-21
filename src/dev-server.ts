import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateCourse } from './validate.js';
import { lintCourse, type LintFinding } from './lint.js';
import { compileCourse, type CompiledCourse } from './compiler.js';
import { conformanceReport, type ConformanceReport } from './tooling.js';
import { compatibilityReport, type CompatibilityReport } from './compat.js';
import { courseLocales, localizeCourse } from './localization.js';
import type { VisualsRenderer } from './local-renderer.js';
import type { CourseManifest, ValidationIssue } from './types.js';

/**
 * 0.6: `course dev`, a live local preview. It watches the course source, rebuilds on every change
 * (validation, lint, conformance, compatibility and compile), and serves one page on 127.0.0.1 that
 * shows the course outline in any of its locales, renders each visual with the released Course Core
 * visuals renderer when it is installed, and lists every problem inline next to what it is about.
 * The browser reloads itself after a rebuild. Nothing is written to disk and nothing leaves the machine.
 */

export interface DevBuild {
  revision: number;
  ok: boolean;
  /** Why the source could not be read or evaluated (a JSON syntax error, a failing TypeScript module). */
  loadError: string | null;
  logs: string;
  course: CourseManifest | null;
  issues: ValidationIssue[];
  findings: LintFinding[];
  conformance: ConformanceReport | null;
  compatibility: CompatibilityReport | null;
  compiled: CompiledCourse | null;
}
export interface DevServerOptions {
  /** Reads the course (JSON file, course directory or TypeScript module). */
  load: () => Promise<{ course: unknown; logs?: string }>;
  /** Directories or files to watch. */
  watch: string[];
  port?: number;
  renderer?: VisualsRenderer | null;
  /** A note about the renderer when none could be loaded. */
  rendererNote?: string;
  debounceMs?: number;
  onBuild?: (build: DevBuild) => void;
}
export interface DevServer {
  url: string;
  rebuild(): Promise<DevBuild>;
  current(): DevBuild;
  close(): Promise<void>;
}

const MAX_CLIENTS = 32;
const IGNORED = /(^|[/\\])(node_modules|\.git|dist)([/\\]|$)|(^|[/\\])\.[^/\\]+$/;
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Builds once; never throws (a failure is reported in the build). */
async function build(revision: number, options: DevServerOptions): Promise<DevBuild> {
  const empty = { revision, course: null, issues: [], findings: [], conformance: null, compatibility: null, compiled: null };
  let loaded: { course: unknown; logs?: string };
  try { loaded = await options.load(); }
  catch (error) {
    const issues = (error as { issues?: ValidationIssue[] }).issues ?? [];
    return { ...empty, ok: false, loadError: error instanceof Error ? error.message : 'The course could not be read.', logs: (error as { logs?: string }).logs ?? '', issues };
  }
  const logs = loaded.logs ?? '';
  const result = validateCourse(loaded.course);
  const findings = lintCourse(loaded.course);
  if (!result.valid) return { ...empty, ok: false, loadError: null, logs, issues: result.issues, findings };
  const localRenderers = options.renderer ? [{ rendererId: options.renderer.rendererId, version: options.renderer.version, features: options.renderer.features, source: options.renderer.source }] : [];
  return {
    revision, ok: true, loadError: null, logs, course: result.course, issues: [], findings,
    conformance: conformanceReport(result.course), compatibility: compatibilityReport(result.course, { localRenderers }), compiled: compileCourse(result.course),
  };
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1d21;--muted:#5b616e;--line:#d9dce1;--bad:#b3261e;--warn:#8a5300;--good:#1e6b34;--card:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--fg:#e8e9ec;--muted:#a3a8b3;--line:#33363d;--bad:#ff8a80;--warn:#ffcc80;--good:#8bd5a0;--card:#1d1f23}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
header,main{max-width:960px;margin:0 auto;padding:16px}header{border-bottom:1px solid var(--line)}
h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.15rem;margin:24px 0 8px}h3{font-size:1rem;margin:16px 0 4px}
.meta,.muted{color:var(--muted);font-size:.9rem}.status{font-weight:600}.ok{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}
nav a{margin-inline-end:12px}ul.problems{padding-inline-start:20px}ul.problems li{margin:4px 0}code{font-size:.85em;overflow-wrap:anywhere}
.block{border:1px solid var(--line);border-radius:8px;padding:12px;margin:8px 0;background:var(--card);overflow-wrap:anywhere}
.text{white-space:pre-wrap}.visual svg{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}
`;

function problemList(items: { level: string; code: string; path: string; message: string }[]): string {
  if (!items.length) return '';
  return `<ul class="problems">${items.map(i => `<li class="${i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : 'muted'}">`
    + `<strong>${escape(i.code)}</strong> <code>${escape(i.path)}</code> ${escape(i.message)}</li>`).join('')}</ul>`;
}
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The preview page. Every course value is escaped; only renderer SVG (already sanitized by the renderer) is embedded. */
export function renderPreviewPage(current: DevBuild, options: { locale?: string; renderer?: VisualsRenderer | null; rendererNote?: string } = {}): string {
  const head = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escape(title)}</title><style>${STYLE}</style>${options.renderer?.stylesheet ? '<link rel="stylesheet" href="/visuals.css">' : ''}`
    + `<script src="/reload.js" defer></script></head><body data-revision="${current.revision}">`;
  if (!current.course) {
    const problems = current.issues.map(i => ({ level: 'error', ...i }));
    return `${head('Course preview: not built')}<header><h1>Course preview</h1><p class="status bad">The course does not build yet.</p>`
      + `<p class="muted">Fix the problems below and save; this page reloads by itself.</p></header><main>`
      + (current.loadError ? `<h2>Could not read the course</h2><pre class="bad">${escape(current.loadError)}</pre>` : '')
      + (problems.length ? `<h2>Problems (${problems.length})</h2>${problemList(problems)}` : '')
      + (current.findings.length ? `<h2>Lint</h2>${problemList(current.findings.map(f => ({ level: f.severity, code: f.code, path: f.path, message: f.message })))}` : '')
      + (current.logs ? `<h2>Module output</h2><pre>${escape(current.logs)}</pre>` : '') + '</main></body></html>';
  }
  const source = current.course;
  const { course, locale, direction, fallbacks } = localizeCourse(source, options.locale ?? source.locale);
  const findings = current.findings.map(f => ({ level: f.severity, code: f.code, path: f.path, message: f.message }));
  const checks = current.conformance!.checks.filter(c => c.status !== 'passed').map(c => ({ level: c.status === 'failed' ? 'error' : 'warning', code: c.id, path: '', message: c.detail }));
  const compat = current.compatibility!;
  // Findings for one item, without those of its children (shown with each child).
  const at = (prefix: string, children?: string) => problemList(findings.filter(f => under(f.path, prefix) && !(children && under(f.path, children))));
  const visuals = new Map(course.visuals.map((v, i) => [v.id, { visual: v, index: i }]));
  const assessments = new Map(course.assessments.map(a => [a.id, a]));
  const blockHtml = (block: CourseManifest['chapters'][number]['episodes'][number]['blocks'][number], path: string): string => {
    let body: string;
    switch (block.type) {
      case 'text': body = `<div class="text">${escape(block.markdown)}</div>`; break;
      case 'assessment': {
        const item = assessments.get(block.assessmentId);
        body = item ? `<p><strong>${escape(item.type)}</strong> ${escape(item.prompt)}</p>` : `<p class="bad">Unknown assessment ${escape(block.assessmentId)}</p>`;
        break;
      }
      case 'visual': {
        const found = visuals.get(block.visualId);
        if (!found) { body = `<p class="bad">Unknown visual ${escape(block.visualId)}</p>`; break; }
        const { visual, index } = found;
        const rendered = options.renderer && visual.rendererId === options.renderer.rendererId ? options.renderer.render(source.visuals[index]!, `v${index}`) : null;
        body = rendered && 'svg' in rendered ? `<div class="visual">${rendered.svg}</div>`
          : rendered ? `<p class="bad">The renderer refused this visual: ${escape(rendered.error)}</p>`
            : `<p class="muted">${escape(visual.rendererId)} is not available in this preview${options.renderer ? '' : ` (${escape(options.rendererNote ?? 'no visuals renderer installed')})`}.</p>`;
        body += `<p class="muted">Text alternative: ${escape(visual.accessibility.description)}</p>` + at(`/visuals/${index}`);
        break;
      }
      case 'media': body = `<p>Media <code>${escape(block.mediaId)}</code>${block.required ? ' (required)' : ''}</p>`; break;
      case 'activity': body = `<p>Activity <code>${escape('activityId' in block ? block.activityId : block.extensionId)}</code></p>`; break;
    }
    return `<div class="block" id="${escape(`block-${block.id}`)}"><div class="muted">${escape(block.type)} · ${escape(block.id)}</div>${body}${at(path)}</div>`;
  };
  const outline = course.chapters.map((chapter, c) => `<section><h2>${escape(chapter.title)}</h2>${at(`/chapters/${c}`, `/chapters/${c}/episodes`)}`
    + chapter.episodes.map((episode, e) => `<h3>${escape(episode.title)} <span class="muted">${escape(episode.id)}</span></h3>`
      + at(`/chapters/${c}/episodes/${e}`, `/chapters/${c}/episodes/${e}/blocks`)
      + episode.blocks.map((block, b) => blockHtml(block, `/chapters/${c}/episodes/${e}/blocks/${b}`)).join('')).join('') + '</section>').join('');
  const locales = courseLocales(source);
  const status = current.conformance!.status;
  return `${head(`Course preview: ${course.title}`)}<header><h1>${escape(course.title)}</h1>`
    + `<p class="meta">${escape(course.id)} ${escape(course.version)} · digest <code>${escape(current.compiled!.digest.slice(0, 12))}</code> · build ${current.revision}</p>`
    + `<p class="status ${status === 'passed' ? 'ok' : status === 'failed' ? 'bad' : 'warn'}">Conformance: ${escape(status.replaceAll('_', ' '))}`
    + ` · compatibility: ${escape(compat.status)} · renderer: ${escape(options.renderer ? options.renderer.source : 'none')}</p>`
    + (locales.length > 1 ? `<nav aria-label="Locales">${locales.map(tag => tag === locale ? `<strong>${escape(tag)}</strong> ` : `<a href="/?locale=${encodeURIComponent(tag)}">${escape(tag)}</a>`).join('')}</nav>` : '')
    + '</header><main>'
    + (checks.length || compat.problems.length ? `<h2>Checks needing attention</h2>${problemList([...checks, ...compat.problems.map(p => ({ level: p.severity === 'blocking' ? 'error' : 'warning', code: p.code, path: '', message: p.detail }))])}` : '')
    + (fallbacks.length ? `<p class="warn">${fallbacks.length} text(s) are shown in ${escape(source.locale)} because ${escape(locale)} has no translation.</p>` : '')
    + `<div lang="${escape(locale)}" dir="${direction}">${outline}</div>`
    + (findings.length ? `<h2>All lint findings (${findings.length})</h2>${problemList(findings)}` : '')
    + (current.logs ? `<h2>Module output</h2><pre>${escape(current.logs)}</pre>` : '') + '</main></body></html>';
}

const RELOAD_SCRIPT = `(() => {
  const revision = document.body.dataset.revision;
  const events = new EventSource('/events');
  events.addEventListener('build', event => { if (event.data !== revision) location.reload(); });
})();
`;

/** Starts the preview server on 127.0.0.1 and the watcher. */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  let revision = 0, current = await build(++revision, options), building: Promise<DevBuild> | null = null, again = false;
  options.onBuild?.(current);
  const clients = new Set<ServerResponse>();
  const announce = () => { for (const client of clients) client.write(`event: build\ndata: ${current.revision}\n\n`); };
  const rebuild = async (): Promise<DevBuild> => {
    if (building) { again = true; return building; }
    building = (async () => {
      do { again = false; current = await build(++revision, options); options.onBuild?.(current); } while (again);
      announce();
      return current;
    })().finally(() => { building = null; });
    return building;
  };
  const stylesheet = options.renderer?.stylesheet ? await readFile(options.renderer.stylesheet, 'utf8') : null;
  let port = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const host = request.headers.host ?? '';
    // Refuse other host names (DNS rebinding) and anything but reads.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { response.writeHead(421).end(); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    const url = new URL(request.url ?? '/', `http://${host}`);
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` };
    const send = (status: number, type: string, body: string) => response.writeHead(status, { ...headers, 'content-type': type }).end(request.method === 'HEAD' ? undefined : body);
    switch (url.pathname) {
      case '/': {
        const locale = url.searchParams.get('locale') ?? undefined;
        send(current.ok ? 200 : 422, 'text/html; charset=utf-8', renderPreviewPage(current, { ...(locale ? { locale } : {}), renderer: options.renderer ?? null, ...(options.rendererNote ? { rendererNote: options.rendererNote } : {}) }));
        return;
      }
      case '/reload.js': send(200, 'text/javascript; charset=utf-8', RELOAD_SCRIPT); return;
      case '/visuals.css': if (stylesheet) send(200, 'text/css; charset=utf-8', stylesheet); else send(404, 'text/plain', 'Not found'); return;
      case '/build.json': {
        const { compiled: _compiled, course: _course, ...summary } = current;
        send(200, 'application/json', JSON.stringify(summary, null, 2));
        return;
      }
      case '/compiled.json': if (current.compiled) send(200, 'application/json', JSON.stringify(current.compiled, null, 2)); else send(422, 'application/json', JSON.stringify({ error: 'The course does not build.' })); return;
      case '/events': {
        if (clients.size >= MAX_CLIENTS) { send(503, 'text/plain', 'Too many preview tabs.'); return; }
        response.writeHead(200, { ...headers, 'content-type': 'text/event-stream', connection: 'keep-alive' });
        response.write(`retry: 1000\nevent: build\ndata: ${current.revision}\n\n`);
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }
      default: send(404, 'text/plain; charset=utf-8', 'Not found');
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 4321, '127.0.0.1', () => resolve()); });
  port = (server.address() as AddressInfo).port;
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = options.watch.map(target => watch(target, { recursive: true }, (_event, name) => {
    if (name && IGNORED.test(String(name))) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void rebuild(); }, options.debounceMs ?? 150);
  }));
  return {
    url: `http://127.0.0.1:${port}/`,
    rebuild, current: () => current,
    async close() {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
