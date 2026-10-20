#!/usr/bin/env node
// Dependency-free checks for the public package boundary. Requires Node >=24.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const registry = 'https://registry.npmjs.org/';
const packageName = '@course-core/sdk';
const maxFileSize = 2 * 1024 * 1024;
const maxUnpackedSize = 10 * 1024 * 1024;
const requiredFiles = [
  'package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js', 'dist/index.d.ts',
  'dist/compiler.js', 'dist/compiler.d.ts', 'dist/cli.js', 'dist/course.schema.json',
  'dist/adaptation.js', 'dist/adaptation.d.ts', 'dist/adaptation.schema.json',
  'dist/course-package.js', 'dist/course-package.d.ts', 'dist/course-package.schema.json', 'dist/learning-event-export.schema.json', 'dist/tar.js',
  'dist/numerical-recipe.js', 'dist/validator-dependencies.json',
  'dist/research.js', 'dist/research.d.ts', 'dist/research-types.d.ts', 'dist/generated/research-selection-validator.js',
  'dist/episode.js', 'dist/episode.d.ts',
  'dist/define.js', 'dist/define.d.ts', 'dist/records.js', 'dist/records.d.ts', 'dist/gate-decision.js', 'dist/gate-decision.d.ts',
  'dist/lint.js', 'dist/tooling.js', 'dist/tooling.d.ts', 'dist/contracts-types.d.ts', 'dist/record-types.d.ts',
  'dist/generated/contracts-validator.js', 'dist/generated/records-validator.js',
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  // Child output can contain a secret discovered in an invalid package. Never echo it.
  check(!result.error && result.status === 0,
    `${path.basename(command)} ${args[0] ?? ''} failed (${result.error?.code ?? result.status}). ` +
    'Reproduce the documented command locally to inspect its output.');
  return result.stdout;
}

function auditRepositoryReferences(name, text) {
  // Decode ordinary URL escaping without rejecting unrelated percent signs in code.
  const normalized = text.replace(/\\\//g, '/').replace(/(?:%[0-9a-f]{2})+/gi, (value) => {
    try { return decodeURIComponent(value); } catch { return value; }
  });
  const publicRepositories = new Set(['course-sdk', 'course-core']);
  const references = /(?:^|[^A-Za-z0-9_./:@-])(?:(?:https?|git|ssh|git\+https?|git\+ssh):\/\/(?:[^/\s@]+@)?|git@)?(github\.com|www\.github\.com|raw\.githubusercontent\.com|api\.github\.com|codeload\.github\.com)(?::\d+)?[/:]([^\s"'`<>()\[\]{}?#]+)/gi;
  for (const match of normalized.matchAll(references)) {
    const host = match[1].toLowerCase();
    // URL normalization prevents an allowed prefix plus /../ from bypassing policy.
    const segments = new URL(`https://${host}/${match[2]}`).pathname.slice(1).split('/');
    if (host === 'api.github.com') {
      if (segments.shift()?.toLowerCase() !== 'repos') continue;
    }
    const [owner, repositoryPath] = segments;
    if (owner?.toLowerCase() !== 'roeehrl' || !repositoryPath) continue;
    const repository = repositoryPath.toLowerCase().replace(/\.git$/, '');
    check(publicRepositories.has(repository),
      `${name}: owner repository reference is not on the public allowlist; inspect locally (matched content is redacted)`);
  }
}

function auditText(name, bytes) {
  check(bytes.length <= maxFileSize, `${name}: exceeds the per-file size limit`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`${name}: binary or invalid UTF-8 content is not allowed`); }
  check(!text.includes('\0'), `${name}: NUL bytes are not allowed`);
  const patterns = [
    ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{30,})\b/],
    ['npm token', /\bnpm_[A-Za-z0-9]{36,}\b/],
    ['cloud access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['service token', /\b(?:xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{35})\b/],
    ['credential in a URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/i],
    ['literal credential', /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
    ['host-specific path', /(?:\/Users\/[^/\s"']+\/|\/home\/[^/\s"']+\/|[A-Z]:[\\/]Users[\\/])/i],
  ];
  for (const [label, expression] of patterns) {
    check(!expression.test(text), `${name}: possible ${label}; inspect locally (matched content is redacted)`);
  }
  auditRepositoryReferences(name, text);
  return text;
}

function auditDependencyMap(dependencies, label) {
  for (const [name, spec] of Object.entries(dependencies ?? {})) {
    check(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name), `${label}: invalid dependency name`);
    // Deliberately exclude Git, URLs, aliases, file:, workspace:, and registry tags.
    check(typeof spec === 'string' && /^[v~^<>=*\d]/.test(spec) && /^[v~^<>=*0-9A-Za-z.|+\s-]+$/.test(spec),
      `${label}: ${name} must use a public registry version or semver range`);
  }
}

function auditManifest(manifest, expectedVersion) {
  check(manifest.name === packageName, `Package must be named ${packageName}`);
  check(typeof manifest.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version),
    'Package version must be an explicit semver version');
  if (expectedVersion !== undefined) check(manifest.version === expectedVersion, 'Tag version does not match package.json');
  check(manifest.private !== true && manifest.license === 'Apache-2.0' && manifest.type === 'module',
    'Expected a public Apache-2.0 ESM package');
  check(manifest.engines?.node === '>=24', 'Expected engines.node >=24; update the CI matrix if this changes');
  assert.deepEqual([...(manifest.files ?? [])].sort(), ['LICENSE', 'NOTICE', 'README.md', 'dist'], 'Keep the package files allowlist explicit');
  assert.deepEqual(Object.keys(manifest.exports ?? {}).sort(), ['.', './adaptation-schema', './compiler', './event-export-schema', './package-schema', './schema'], 'Unexpected public export surface');
  for (const [key, stem] of [['.', 'index'], ['./compiler', 'compiler']]) {
    assert.deepEqual(manifest.exports[key], { types: `./dist/${stem}.d.ts`, import: `./dist/${stem}.js` }, `Unexpected ${key} export`);
    check(Object.keys(manifest.exports[key])[0] === 'types', `${key}: put the types condition first`);
  }
  check(manifest.exports['./schema'] === './dist/course.schema.json', 'Missing standalone schema export');
  check(manifest.exports['./adaptation-schema'] === './dist/adaptation.schema.json', 'Missing standalone adaptation schema export');
  check(manifest.exports['./package-schema'] === './dist/course-package.schema.json', 'Missing standalone course-package schema export');
  check(manifest.exports['./event-export-schema'] === './dist/learning-event-export.schema.json', 'Missing standalone event-export schema export');
  assert.deepEqual(manifest.bin, { course: './dist/cli.js' }, 'Expected the course CLI');
  check(!manifest.workspaces && !manifest.bundleDependencies && !manifest.bundledDependencies && !manifest.overrides,
    'Workspaces, bundled dependencies, and overrides need an explicit package policy review');
  check(!manifest.publishConfig?.registry || manifest.publishConfig.registry === registry,
    'Only the public npm registry is allowed');
  check(!manifest.publishConfig?.access || manifest.publishConfig.access === 'public', 'Package access must be public');
  for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
    check(!manifest.scripts?.[lifecycle], `Consumer lifecycle script ${lifecycle} is not allowed`);
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    auditDependencyMap(manifest[field], `package.json ${field}`);
  }
}

function auditLock(lock, manifest) {
  check(lock.lockfileVersion === 3 && lock.packages?.[''], 'Commit a complete npm lockfileVersion 3 lockfile');
  check(lock.name === manifest.name && lock.version === manifest.version, 'Lockfile package identity is stale');
  check(lock.packages[''].name === manifest.name && lock.packages[''].version === manifest.version, 'Lockfile root identity is stale');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(lock.packages[''][field] ?? {}, manifest[field] ?? {}, `Lockfile ${field} are stale`);
  }
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (location === '') continue;
    check(location.startsWith('node_modules/') && !location.includes('\\') &&
      location.split('/').every((part) => part && part !== '.' && part !== '..'), 'Invalid lockfile package location');
    check(!entry.link && typeof entry.resolved === 'string', `${location}: local links and unresolved packages are forbidden`);
    let url;
    try { url = new URL(entry.resolved); } catch { throw new Error(`${location}: invalid dependency URL`); }
    check(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.port &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('.tgz'),
    `${location}: dependencies must resolve to unauthenticated HTTPS tarballs on registry.npmjs.org`);
    check(typeof entry.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity),
      `${location}: a SHA-512 integrity hash is required`);
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      auditDependencyMap(entry[field], `${location} ${field}`);
    }
  }
}

async function auditSourceRepositoryReferences(directory) {
  // Scan public inputs even before a build exists. Never traverse .git, installed
  // dependencies, build output, or sibling checkouts. Symlinks cannot widen scope.
  const sourceDirectories = new Set(['src', 'tests', 'scripts', 'fixtures', '.github']);
  async function scan(current, relative = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (!relative && !(entry.isFile() || sourceDirectories.has(entry.name))) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(current, entry.name);
      check(!entry.isSymbolicLink(), `${name}: source audit cannot follow symbolic links`);
      if (entry.isDirectory()) await scan(target, name);
      else if (entry.isFile()) auditRepositoryReferences(name, await readFile(target, 'utf8'));
    }
  }
  await scan(directory);
}

async function auditSource(expectedVersion) {
  for (const forbidden of ['.npmrc', '.gitmodules']) {
    try { await lstat(path.join(root, forbidden)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`${forbidden} is forbidden: public CI must not use alternate registries or submodules`);
  }
  const manifest = JSON.parse(auditText('package.json', await readFile(path.join(root, 'package.json'))));
  auditManifest(manifest, expectedVersion);
  const lock = JSON.parse(auditText('package-lock.json', await readFile(path.join(root, 'package-lock.json'))));
  auditLock(lock, manifest);
  await auditSourceRepositoryReferences(root);
  return manifest;
}

function allowedFile(name) {
  if (['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/course.schema.json', 'dist/adaptation.schema.json', 'dist/course-package.schema.json', 'dist/learning-event-export.schema.json', 'dist/validator-dependencies.json'].includes(name)) return true;
  if (!/^dist\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:js|d\.ts)$/.test(name)) return false;
  return !/(?:^|\/)(?:tests?|fixtures?|examples?|data|datasets?|coverage|node_modules|src)(?:[/._-]|$)/i.test(name);
}

function tarNumber(bytes, label) {
  const value = bytes.toString('ascii').replace(/\0.*$/, '').trim();
  check(/^[0-7]+$/.test(value), `Unsupported tar ${label}`);
  return Number.parseInt(value, 8);
}

// Inspect the archive before npm can extract it. No shell tar extraction, symlinks,
// hardlinks, PAX overrides, long-name records, devices, traversal, or duplicate names.
function readTarball(compressed) {
  check(compressed.length <= maxUnpackedSize, 'Tarball exceeds the compressed size limit');
  const tar = gunzipSync(compressed, { maxOutputLength: maxUnpackedSize });
  check(tar.length % 512 === 0, 'Truncated tar archive');
  const entries = new Map();
  let offset = 0;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      check(offset + 1024 <= tar.length && tar.subarray(offset).every((byte) => byte === 0), 'Invalid tar end marker');
      ended = true;
      break;
    }
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    check(checksum === tarNumber(header.subarray(148, 156), 'checksum'), 'Tar header checksum mismatch');
    const string = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');
    check(string(257, 263) === 'ustar', 'Only the ustar archive format is allowed');
    const prefix = string(345, 500);
    const name = `${prefix ? `${prefix}/` : ''}${string(0, 100)}`;
    check(name.startsWith('package/') && !name.includes('\\') &&
      name.replace(/\/$/, '').split('/').every((part) => part && part !== '.' && part !== '..'), 'Unsafe tar entry path');
    const relative = name.slice('package/'.length);
    const type = header[156];
    const size = tarNumber(header.subarray(124, 136), 'size');
    check(size <= maxFileSize, 'Tar entry exceeds the size limit');
    check(type === 0 || type === 48 || type === 53, 'Links and extended/special tar records are forbidden');
    check(!string(157, 257), 'Tar link targets are forbidden');
    check((tarNumber(header.subarray(100, 108), 'mode') & 0o7000) === 0, 'Special file mode bits are forbidden');
    offset += 512;
    check(offset + size <= tar.length, 'Truncated tar entry');
    if (type === 53) {
      check(size === 0 && (relative === '' || /^dist\/(?:[A-Za-z0-9_-]+\/)*$/.test(relative)), 'Unexpected tar directory');
    } else {
      check(allowedFile(relative), `Disallowed package file: ${relative}`);
      check(!entries.has(relative), `Duplicate tar entry: ${relative}`);
      entries.set(relative, { bytes: tar.subarray(offset, offset + size), mode: tarNumber(header.subarray(100, 108), 'mode') });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  check(ended, 'Tar archive has no end marker');
  return entries;
}

function auditPackage(entries, manifest, report) {
  for (const required of requiredFiles) check(entries.has(required), `Missing packed file: ${required}. Finish the SDK implementation and run npm run build.`);
  for (const [name, entry] of entries) auditText(name, entry.bytes);
  const packedManifest = JSON.parse(entries.get('package.json').bytes.toString('utf8'));
  auditManifest(packedManifest, manifest.version);
  assert.deepEqual(packedManifest, manifest, 'Packed manifest differs from the source manifest');
  const files = [...entries].map(([name, entry]) => ({ path: name, size: entry.bytes.length })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(report.files.map(({ path, size }) => ({ path, size })).sort((a, b) => a.path.localeCompare(b.path)), files,
    'npm pack inventory differs from the actual archive');
  check(report.name === packageName && report.version === manifest.version, 'npm pack identity mismatch');
  check(report.bundled?.length === 0, 'Bundled dependencies are forbidden');
  const license = entries.get('LICENSE').bytes.toString('utf8');
  check(license.includes('Apache License') && license.includes('Version 2.0, January 2004') &&
    license.includes('END OF TERMS AND CONDITIONS'), 'Missing complete Apache-2.0 license');
  const cli = entries.get('dist/cli.js');
  check(cli.bytes.toString('utf8').startsWith('#!/usr/bin/env node\n'), 'The packed CLI must have a Node shebang');
  JSON.parse(entries.get('dist/course.schema.json').bytes.toString('utf8'));
  JSON.parse(entries.get('dist/adaptation.schema.json').bytes.toString('utf8'));
  JSON.parse(entries.get('dist/course-package.schema.json').bytes.toString('utf8'));
  check(JSON.parse(entries.get('dist/learning-event-export.schema.json').bytes.toString('utf8')).$ref === '#/$defs/learningEventExport', 'The event-export schema must describe learningEventExport');
  const notice = entries.get('NOTICE').bytes.toString('utf8');
  const inventory = JSON.parse(entries.get('dist/validator-dependencies.json').bytes.toString('utf8'));
  const bundledNames = new Set();
  assert.deepEqual(inventory.map(row => row.validator).sort(), ['adaptation', 'adaptation-context', 'assignment-decisions', 'contracts', 'course', 'numerical-recipe', 'recipe-instance', 'records', 'research-selection'], 'Unexpected validator inventory');
  for (const row of inventory) {
    const bundle = entries.get(`dist/generated/${row.validator}-validator.js`);
    check(bundle, 'A generated validator listed in the inventory is missing');
    const code = bundle.bytes.toString('utf8');
    for (const dependency of row.dependencies) {
      bundledNames.add(dependency.name);
      check(['ajv', 'ajv-formats', 'fast-deep-equal'].includes(dependency.name) && dependency.license === 'MIT', 'Review newly bundled runtime licenses');
      const marker = `${dependency.name}@${dependency.version}\n`;
      check(notice.includes(marker), 'Missing bundled dependency notice');
      const license = notice.split(marker)[1].split(/\n\n(?:ajv|ajv-formats|fast-deep-equal)@/)[0].trim();
      check(createHash('sha256').update(license).digest('hex') === dependency.licenseSha256, 'Packed notice differs from the inspected license');
      check(code.includes(license), 'Generated bundle lost its exact third-party license notice');
      check(dependency.modules.length > 0 && dependency.modules.every(module => code.includes(`node_modules/${module}`)), 'Bundled module inventory differs from actual code');
    }
  }
  assert.deepEqual([...bundledNames].sort(), ['ajv', 'ajv-formats', 'fast-deep-equal']);
  return files;
}

const fixture = {
  schemaVersion: 1, id: 'package-smoke', version: '1.0.0', title: 'Package smoke test',
  summary: 'Synthetic public package verification.', locale: 'en', platforms: ['web'],
  objectives: [{ id: 'start', description: 'Read a synthetic example.', prerequisites: [], placeable: true }],
  chapters: [{ id: 'chapter', title: 'Example', episodes: [{
    id: 'episode', title: 'Read', objectiveIds: ['start'], gateId: 'gate',
    blocks: [{ id: 'text', type: 'text', markdown: 'A synthetic example.' },
      { id: 'check', type: 'assessment', assessmentId: 'item' }],
  }] }],
  assessments: [{ id: 'item', type: 'choice', objectiveIds: ['start'], familyId: 'family',
    prompt: 'Synthetic item prompt: choose the first option.',
    options: [{ id: 'first', text: 'First' }, { id: 'second', text: 'Second' }],
    grading: { correctOptionId: 'first', explanation: 'Synthetic answer explanation.' } }],
  gates: [{ id: 'gate', objectiveIds: ['start'], assessmentIds: ['item'], minimumIndependentFamilies: 1, requireAllObjectives: true }],
  placement: { enabled: true, learnerMayDecline: true, objectiveIds: ['start'], assessmentIds: ['item'], protectedEpisodeIds: [], maxItems: 1 },
  extensions: [], visuals: [], media: [], sources: [],
  policy: { mode: 'bounded', work: { additionalEpisodes: 3 }, existingMaterialAccess: 'read_only' },
};

async function smokeConsumer(temp, tarball, manifest, env) {
  const consumer = path.join(temp, 'consumer');
  await mkdir(consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=true',
    `--registry=${registry}`, tarball], { cwd: consumer, env });
  const installed = path.join(consumer, 'node_modules/@course-core/sdk');
  check(!(await lstat(installed)).isSymbolicLink(), 'Consumer must install the tarball, not link the checkout');
  const consumerLock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
  // The SDK itself is the sole permitted local tarball; its transitive closure is public npm only.
  const publicPackages = { ...consumerLock.packages };
  delete publicPackages['node_modules/@course-core/sdk'];
  auditLock({ name: manifest.name, version: manifest.version, lockfileVersion: 3,
    packages: { ...publicPackages, '': manifest } }, manifest);
  await writeFile(path.join(consumer, 'fixture.json'), JSON.stringify(fixture));
  // Public JSON input only; all implementation imports below come from the installed tarball.
  await copyFile(path.join(root, 'fixtures/ordering.adaptation.json'), path.join(consumer, 'adaptation-fixture.json'));
  await writeFile(path.join(consumer, 'main-smoke.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, builtinModules } from 'node:module';
const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const adaptive = JSON.parse(readFileSync(new URL('./adaptation-fixture.json', import.meta.url)));
const builtins = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  assert.ok(!specifier.startsWith('node:') && !builtins.has(specifier), 'Main export imports a Node builtin: ' + specifier);
  const result = nextResolve(specifier, context);
  assert.ok(!/\\/sdk\\/dist\\/(?:compiler|cli)\\.js$/.test(result.url), 'Main export loads compiler or CLI');
  return result;
} });
const savedProcess = globalThis.process;
const savedBuffer = globalThis.Buffer;
try {
  globalThis.process = undefined;
  globalThis.Buffer = undefined;
  const sdk = await import('@course-core/sdk');
  assert.equal(typeof sdk.defineCourse, 'function');
  assert.equal(typeof sdk.validateCourse, 'function');
  assert.ok(!('compileCourse' in sdk) && !('verifyCompiledCourse' in sdk), 'Compiler must remain a separate export');
  const course = sdk.defineCourse(fixture);
  assert.deepEqual(course, fixture);
  const valid = await sdk.validateCourse(course);
  assert.equal(valid.valid, true, 'The synthetic course must validate');
  assert.deepEqual(valid.issues, []);
  assert.equal(sdk.getEpisodeRequirement(course.chapters[0].episodes[0]), 'required');
  assert.ok(!('requirement' in valid.course.chapters[0].episodes[0]));
  const optionalCourse = structuredClone(course);
  optionalCourse.chapters[0].episodes[0].requirement = 'optional';
  assert.equal(sdk.validateCourse(optionalCourse).valid, true);
  assert.equal(sdk.getEpisodeRequirement(optionalCourse.chapters[0].episodes[0]), 'optional');
  optionalCourse.objectives[0].critical = true;
  assert.ok(sdk.validateCourse(optionalCourse).issues.some(issue => issue.code === 'OPTIONAL_ONLY_OBJECTIVE'));
  const invalid = await sdk.validateCourse(null);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.length > 0);
  const dangling = structuredClone(course);
  dangling.chapters[0].episodes[0].objectiveIds.push('missing-objective');
  assert.equal((await sdk.validateCourse(dangling)).valid, false, 'Dangling references must fail');
  const adaptiveContext = { course: adaptive.course, baseCourseDigest: adaptive.baseCourseDigest,
    plan: adaptive.plan, registeredVerifiers: adaptive.registeredVerifiers };
  const proposal = await sdk.validateCourseAdaptation(adaptive.proposal, adaptiveContext);
  assert.equal(proposal.valid, true);
  assert.equal(proposal.proofAuthenticity, 'not_checked');
  assert.equal(proposal.applicationAuthority, 'not_checked');
  const recipe = await sdk.instantiateNumericalRecipe(adaptive.course.adaptation.numericalRecipes[0], { a: 7, b: 2 });
  assert.equal(recipe.value, 2);
  await assert.rejects(sdk.instantiateNumericalRecipe(adaptive.course.adaptation.numericalRecipes[0], { a: 1000, b: 2 }));
  const assignments = await sdk.validateAssignmentDecisions(adaptive.proposal, adaptiveContext, adaptive.assignments);
  assert.equal(assignments.valid, true);
  const researchCourse = structuredClone(course);
  researchCourse.research = { publicTopics: [{ id: 'public-reference', objectiveIds: [course.objectives[0].id],
    queryText: 'Public reference material', allowedDomains: ['reference.example'] }] };
  const research = sdk.resolvePublicResearchRequest(researchCourse, { topicId: 'public-reference' });
  assert.deepEqual(research, { valid: true, request: { queryText: 'Public reference material', allowedDomains: ['reference.example'] },
    authorityAuthenticity: 'not_checked', issues: [] });
  assert.equal(sdk.resolvePublicResearchRequest(researchCourse, { topicId: 'invented' }).valid, false);
  assert.equal(sdk.resolvePublicResearchRequest(researchCourse, { topicId: 'public-reference', history: ['PRIVATE_SENTINEL'] }).valid, false);
  assert.equal(sdk.resolvePublicResearchRequest(researchCourse, { topicId: 'public-reference', queryText: 'Unapproved query' }).valid, false);
} finally {
  hooks.deregister();
  globalThis.process = savedProcess;
  globalThis.Buffer = savedBuffer;
}
`);
  run(process.execPath, ['--disallow-code-generation-from-strings', '--conditions=browser', 'main-smoke.mjs'], { cwd: consumer, env });
  await writeFile(path.join(consumer, 'compiler-smoke.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileCourse, verifyCompiledCourse, compileCourseAdaptation, verifyCompiledCourseAdaptation } from '@course-core/sdk/compiler';
import schema from '@course-core/sdk/schema' with { type: 'json' };
import adaptationSchema from '@course-core/sdk/adaptation-schema' with { type: 'json' };
import eventExportSchema from '@course-core/sdk/event-export-schema' with { type: 'json' };
assert.equal(eventExportSchema.$ref, '#/$defs/learningEventExport');
assert.equal(typeof compileCourse, 'function');
assert.equal(typeof verifyCompiledCourse, 'function');
assert.equal(typeof schema, 'object');
assert.ok(schema.$schema);
assert.ok(adaptationSchema.$schema);
const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const compiled = compileCourse(fixture);
assert.equal(compiled.formatVersion, 1);
assert.match(compiled.digest, /^[a-f0-9]{64}$/);
assert.equal(verifyCompiledCourse(compiled), true);
assert.deepEqual(compiled.server, fixture);
for (const item of compiled.learner.assessments) {
  for (const key of ['prompt', 'options', 'grading', 'familyId']) assert.ok(!(key in item), 'Learner item exposes ' + key);
}
for (const gate of compiled.learner.gates) assert.ok(!('assessmentIds' in gate));
assert.ok(!('assessmentIds' in compiled.learner.placement));
assert.ok(!JSON.stringify(compiled.learner).includes(fixture.assessments[0].prompt));
const changed = structuredClone(compiled);
changed.learner.title = 'Tampered synthetic title';
assert.equal(verifyCompiledCourse(changed), false);
assert.throws(() => compileCourse(null));
assert.equal(schema.$defs.episode.properties.requirement.default, 'required');
const optionalCourse = structuredClone(fixture);
optionalCourse.chapters[0].episodes[0].requirement = 'optional';
const optionalCompiled = compileCourse(optionalCourse);
assert.equal(optionalCompiled.learner.chapters[0].episodes[0].requirement, 'optional');
assert.notEqual(optionalCompiled.digest, compiled.digest);
assert.equal(verifyCompiledCourse(optionalCompiled), true);
const researchCourse = structuredClone(fixture);
researchCourse.research = { publicTopics: [{ id: 'public-reference', objectiveIds: [fixture.objectives[0].id], queryText: 'Public reference material' }] };
assert.ok(schema.properties.research);
assert.ok(!('research' in compileCourse(researchCourse).learner));
assert.deepEqual(compileCourse(researchCourse).server.research, researchCourse.research);
const adaptive = JSON.parse(readFileSync(new URL('./adaptation-fixture.json', import.meta.url)));
const context = { course: adaptive.course, baseCourseDigest: adaptive.baseCourseDigest, plan: adaptive.plan, registeredVerifiers: adaptive.registeredVerifiers };
const plan = await compileCourseAdaptation(adaptive.proposal, context);
assert.equal(await verifyCompiledCourseAdaptation(plan, context), true);
assert.equal(plan.proposedPlan.baseCourseDigest, compileCourse(adaptive.course).digest);
assert.ok(!('adaptation' in compileCourse(adaptive.course).learner));
for (const secret of ['hiddenFixtures', 'grading', 'fixtureRef', 'promptTemplate', 'FIXTURE_NOT_FOR_LEARNER'])
  assert.ok(!JSON.stringify(plan.learner).includes(secret), 'Generated learner projection exposes server data');
assert.equal(plan.proofAuthenticity, 'not_checked');
const damaged = structuredClone(plan); damaged.proofAuthenticity = 'verified';
assert.equal(await verifyCompiledCourseAdaptation(damaged, context), false);
if (process.argv[2]) {
  const cliOutput = JSON.parse(readFileSync(process.argv[2]));
  assert.equal(verifyCompiledCourse(cliOutput), true);
  assert.deepEqual(cliOutput, compiled);
}
`);
  run(process.execPath, ['compiler-smoke.mjs'], { cwd: consumer, env });
  await writeFile(path.join(consumer, 'consumer.mts'), `
import { defineCourse, validateCourse, validateCourseAdaptation, getEpisodeRequirement, type EpisodeRequirement, type Episode, resolvePublicResearchRequest, type PublicResearchSelection, type PublicResearchRequest, type CourseManifest, type CourseAdaptation,
  type AdaptationValidationContext, type ExerciseGeneratorPort, type ArtifactVerifierPort } from '@course-core/sdk';
declare const input: CourseManifest;
const course: CourseManifest = defineCourse(input);
const result = validateCourse(course);
const valid: boolean = result.valid;
void valid;
declare const episode: Episode;
const requirement: EpisodeRequirement = getEpisodeRequirement(episode);
void requirement;
// @ts-expect-error Required/optional classification is a closed enum.
const unknownRequirement: EpisodeRequirement = 'skippable';
void unknownRequirement;
declare const proposal: CourseAdaptation;
declare const context: AdaptationValidationContext;
declare const generator: ExerciseGeneratorPort;
declare const verifier: ArtifactVerifierPort;
const checked = await validateCourseAdaptation(proposal, context);
if (checked.valid) { const trust: 'not_checked' = checked.proofAuthenticity; void trust; }
void generator; void verifier;
const selection: PublicResearchSelection = { topicId: 'public-reference' };
const research = resolvePublicResearchRequest(course, selection);
if (research.valid) { const request: PublicResearchRequest = research.request; void request; }
// @ts-expect-error Private context is not part of a research selection.
const privateSelection: PublicResearchSelection = { topicId: 'public-reference', history: [] };
void privateSelection;
`);
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    noEmit: true, skipLibCheck: false, types: [], lib: ['ES2022', 'DOM'],
  }, files: ['consumer.mts'] }));
  // Use the locked compiler, while resolving all consumer types from the isolated install.
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], { cwd: consumer, env });
  const cli = path.join(consumer, 'node_modules/.bin/course');
  check((await lstat(cli)).isSymbolicLink(), 'npm did not create the course executable');
  check(((await lstat(path.join(installed, 'dist/cli.js'))).mode & 0o111) !== 0, 'The installed CLI must be executable');
  const validation = JSON.parse(run(cli, ['validate', 'fixture.json'], { cwd: consumer, env }));
  check(validation.valid === true && validation.issues.length === 0, 'Installed CLI must validate the synthetic course');
  run(cli, ['compile', 'fixture.json', 'compiled.json'], { cwd: consumer, env });
  run(process.execPath, ['compiler-smoke.mjs', 'compiled.json'], { cwd: consumer, env });
  const original = await readFile(path.join(consumer, 'compiled.json'));
  const mustFail = (args, label) => {
    const result = spawnSync(cli, args, { cwd: consumer, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    check(!result.error && Number.isInteger(result.status) && result.status !== 0, label);
  };
  mustFail(['compile', 'fixture.json', 'compiled.json'], 'CLI must refuse to overwrite an existing output');
  assert.deepEqual(await readFile(path.join(consumer, 'compiled.json')), original, 'CLI changed an existing output');
  await writeFile(path.join(consumer, 'invalid.json'), '{}');
  mustFail(['validate', 'invalid.json'], 'CLI must reject an invalid manifest');
  mustFail(['compile', 'invalid.json', 'invalid-output.json'], 'CLI must not compile an invalid manifest');
  check(!(await readdir(consumer)).includes('invalid-output.json'), 'Invalid compilation created an output');
  mustFail(['--definitely-invalid-package-smoke-option'], 'Unknown CLI options must fail');
  // 0.5 commands: scaffold, conformance, lint, deterministic bundle and verification.
  run(cli, ['init', 'starter'], { cwd: consumer, env });
  mustFail(['init', 'starter'], 'init must refuse an existing directory');
  const conformance = JSON.parse(run(cli, ['test', 'starter/course.json'], { cwd: consumer, env }));
  check(conformance.status === 'passed', 'The scaffolded course must pass conformance');
  run(cli, ['lint', 'starter/course.json', '--strict'], { cwd: consumer, env });
  mustFail(['lint', 'fixture.json', '--strict'], 'Strict lint must flag a recognition-only legacy gate');
  run(cli, ['pack', 'starter/course.json', 'bundle'], { cwd: consumer, env });
  run(cli, ['pack', 'starter/course.json', 'bundle-again'], { cwd: consumer, env });
  for (const name of await readdir(path.join(consumer, 'bundle')))
    assert.deepEqual(await readFile(path.join(consumer, 'bundle', name)), await readFile(path.join(consumer, 'bundle-again', name)), `Bundle file ${name} is not deterministic`);
  mustFail(['pack', 'starter/course.json', 'bundle'], 'pack must refuse an existing output directory');
  check(JSON.parse(run(cli, ['verify', 'bundle'], { cwd: consumer, env })).valid === true, 'Installed CLI must verify its bundle');
  const licenses = path.join(consumer, 'bundle-again', 'licenses.json');
  await writeFile(licenses, (await readFile(licenses, 'utf8')).replace('"inventoryFormat": 1', '"inventoryFormat": 1 '));
  mustFail(['verify', 'bundle-again'], 'A tampered bundle must fail verification');
  run(cli, ['import', 'bundle', 'imported.json'], { cwd: consumer, env });
  // course-package v1: deterministic .course.tgz with a sha256sum sibling, verified by the installed CLI.
  run(cli, ['pack', 'starter', '--out', 'starter.course.tgz'], { cwd: consumer, env });
  run(cli, ['pack', 'starter/course.json', '--out', 'starter-again.course.tgz'], { cwd: consumer, env });
  assert.deepEqual(await readFile(path.join(consumer, 'starter.course.tgz')), await readFile(path.join(consumer, 'starter-again.course.tgz')), 'Course package is not deterministic');
  mustFail(['pack', 'starter', '--out', 'starter.course.tgz'], 'pack must refuse an existing package');
  const verifiedPackage = JSON.parse(run(cli, ['verify', 'starter.course.tgz'], { cwd: consumer, env }));
  check(verifiedPackage.valid === true && verifiedPackage.checksum === 'verified', 'Installed CLI must verify its course package');
  await writeFile(path.join(consumer, 'starter-again.course.tgz.sha256'), `${'0'.repeat(64)}  starter-again.course.tgz\n`);
  mustFail(['verify', 'starter-again.course.tgz'], 'A package with a wrong .sha256 must fail verification');
}

async function selfTest() {
  for (const name of requiredFiles) assert.ok(allowedFile(name), name);
  assert.ok(allowedFile('dist/generated/course-validator.js'));
  assert.ok(allowedFile('dist/generated/course-validator.d.ts'));
  for (const name of ['.env', '.npmrc', 'src/index.ts', 'dist/private.json', 'dist/index.js.map',
    'dist/tests.js', 'dist/fixtures/example.js', 'dist/../index.js', 'node_modules/a.js']) {
    assert.ok(!allowedFile(name), name);
  }
  for (const value of ['ghp_' + 'x'.repeat(36), 'npm_' + 'x'.repeat(36), '-----BEGIN PRIVATE KEY-----',
    'https://name:password@example.invalid/', '/Users/' + 'someone/work/']) {
    assert.throws(() => auditText('synthetic', Buffer.from(value)), /possible/);
  }
  const owner = 'roeehrl';
  const syntheticRepository = 'synthetic-internal-example';
  const repositoryUrls = (repository) => [
    `https://github.com/${owner}/${repository}`,
    `git+https://github.com/${owner}/${repository}.git`,
    `git@github.com:${owner}/${repository}.git`,
    `ssh://git@github.com:22/${owner}/${repository}.git`,
    `https://www.github.com/${owner}/${repository}/tree/main`,
    `https://raw.githubusercontent.com/${owner}/${repository}/main/example.json`,
    `https://api.github.com/repos/${owner}/${repository}/contents/example.json`,
    `https://codeload.github.com/${owner}/${repository}/tar.gz/refs/heads/main`,
    `https://github.com/${owner}/${repository}?tab=readme#example`,
    `https://github.com/${owner}/${repository}`.replaceAll('/', '\\/'),
    `https://github.com/${owner}/${repository}`.replaceAll('-', '%2D'),
    `https://github.com/${owner}/course-sdk/../${repository}`,
    `https://github.com/${owner}/course-core/%2E%2E/${repository}`,
    `https://github.com/${owner}/${repository}`.toUpperCase(),
  ];
  for (const repository of [syntheticRepository, 'course-sdk-internal', 'course-core-backup']) {
    for (const value of repositoryUrls(repository)) {
      assert.throws(() => auditText('synthetic', Buffer.from(value)), /public allowlist/);
    }
  }
  for (const repository of ['course-sdk', 'course-core']) {
    for (const value of repositoryUrls(repository)) {
      assert.doesNotThrow(() => auditText('synthetic', Buffer.from(value)));
      assert.doesNotThrow(() => auditText('synthetic', Buffer.from(`[public repository](${value}).`)));
    }
  }
  for (const value of [
    `https://github.com/${owner}`, `https://github.com/${owner}?tab=repositories`,
    `https://github.com/another-owner/${syntheticRepository}`,
    `https://notgithub.com/${owner}/${syntheticRepository}`,
    `https://example.invalid/github.com/${owner}/${syntheticRepository}`,
  ]) {
    assert.doesNotThrow(() => auditText('synthetic', Buffer.from(value)));
  }
  const sourceFixture = await mkdtemp(path.join(tmpdir(), 'course-sdk-source-policy-'));
  try {
    await mkdir(path.join(sourceFixture, 'src'));
    await writeFile(path.join(sourceFixture, 'README.md'), repositoryUrls('course-sdk')[0]);
    await writeFile(path.join(sourceFixture, 'src', 'example.ts'), repositoryUrls('course-core')[0]);
    await auditSourceRepositoryReferences(sourceFixture);
    await writeFile(path.join(sourceFixture, 'src', 'example.ts'), repositoryUrls(syntheticRepository)[0]);
    await assert.rejects(auditSourceRepositoryReferences(sourceFixture), /src\/example\.ts:.*public allowlist/);
    await rm(path.join(sourceFixture, 'src', 'example.ts'));
    await writeFile(path.join(sourceFixture, 'README.md'), repositoryUrls(syntheticRepository)[0]);
    await assert.rejects(auditSourceRepositoryReferences(sourceFixture), /README\.md:.*public allowlist/);
  } finally {
    await rm(sourceFixture, { recursive: true, force: true });
  }
  for (const spec of ['git+https://example.invalid/a', 'file:../private', 'workspace:*',
    'https://registry.npmjs.org/a.tgz', 'npm:other@1.0.0', 'latest']) {
    assert.throws(() => auditDependencyMap({ example: spec }, 'synthetic'), /public registry/);
  }
  assert.doesNotThrow(() => auditDependencyMap({ example: '^1.2.3 || >=2.0.0' }, 'synthetic'));
  const manifest = { name: packageName, version: '0.1.0' };
  const entry = { resolved: `${registry}example/-/example-1.0.0.tgz`, integrity: 'sha512-' + 'A'.repeat(86) + '==' };
  const lock = { ...manifest, lockfileVersion: 3, packages: { '': manifest, 'node_modules/example': entry } };
  assert.doesNotThrow(() => auditLock(lock, manifest));
  for (const resolved of ['https://example.invalid/a.tgz', 'https://token@registry.npmjs.org/a.tgz', 'file:../private']) {
    assert.throws(() => auditLock({ ...lock, packages: { '': manifest, 'node_modules/example': { ...entry, resolved } } }, manifest));
  }
  // Synthetic tar records exercise the parser's fail-closed cases, not SDK behavior.
  const tarRecord = (name, { type = '0', body = 'export {};', mode = 0o644 } = {}) => {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8);
    header.write(Buffer.byteLength(body).toString(8).padStart(11, '0') + '\0', 124, 12);
    header.write(type, 156, 1);
    header.write('ustar\0', 257, 6);
    header.fill(32, 148, 156);
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    const contents = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
    contents.write(body);
    return Buffer.concat([header, contents]);
  };
  const tarball = (...records) => gzipSync(Buffer.concat([...records, Buffer.alloc(1024)]));
  const valid = tarRecord('package/dist/index.js');
  assert.equal(readTarball(tarball(valid)).get('dist/index.js').bytes.toString(), 'export {};');
  for (const name of ['package/../outside.js', '/outside.js', 'package/dist/private.json', 'package/dist/.env']) {
    assert.throws(() => readTarball(tarball(tarRecord(name))));
  }
  for (const type of ['1', '2', '3', '4', '6', 'x', 'g', 'L']) {
    assert.throws(() => readTarball(tarball(tarRecord('package/dist/index.js', { type }))));
  }
  assert.throws(() => readTarball(tarball(valid, valid)), /Duplicate/);
  assert.throws(() => readTarball(tarball(tarRecord('package/dist/index.js', { mode: 0o4644 }))), /mode/);
  assert.throws(() => readTarball(gzipSync(valid)), /end marker/);
  const corrupt = Buffer.from(valid);
  corrupt[0] ^= 1;
  assert.throws(() => readTarball(tarball(corrupt)), /checksum/);
  console.log('Package checker self-tests passed (policy checks only; no SDK verification claimed).');
}

async function main() {
  check(Number(process.versions.node.split('.')[0]) >= 24, 'Node >=24 is required');
  const args = process.argv.slice(2);
  let sourceOnly = false;
  let expectedVersion;
  let outputDir;
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--audit-source') sourceOnly = true;
    else if (args[index] === '--expect-version') {
      expectedVersion = args[++index];
      check(expectedVersion && !expectedVersion.startsWith('-'), '--expect-version requires a version');
    } else if (args[index] === '--output-dir') {
      check(args[index + 1] && !args[index + 1].startsWith('-'), '--output-dir requires a directory');
      outputDir = path.resolve(args[++index]);
      check(outputDir !== root && !outputDir.startsWith(root + path.sep), 'Write verified output outside the checkout');
    } else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const manifest = await auditSource(expectedVersion);
  if (sourceOnly) {
    check(!outputDir, '--audit-source cannot produce a release artifact');
    console.log('Public package metadata, source repository references, and locked dependency sources passed. No build or consumer checks performed.');
    return;
  }
  for (const name of requiredFiles) {
    try { check((await lstat(path.join(root, name))).isFile(), `Not a regular file: ${name}`); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing ${name}. Finish the SDK implementation and run npm ci, npm run typecheck, npm test, npm run build, then this checker.`);
    }
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'course-sdk-package-'));
  try {
    const consumerHome = path.join(temp, 'consumer-config');
    await mkdir(consumerHome);
    await writeFile(path.join(consumerHome, 'user.npmrc'), `registry=${registry}\nignore-scripts=true\naudit=false\nfund=false\n`);
    await writeFile(path.join(consumerHome, 'global.npmrc'), '');
    // Do not inherit auth tokens, NODE_OPTIONS, NODE_PATH, npm config, or user caches.
    // Preserve the host HOME; npm isolation uses explicit configuration and cache paths.
    const env = {
      PATH: process.env.PATH, ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
      TMPDIR: temp, TMP: temp, TEMP: temp, CI: 'true',
      LANG: 'C.UTF-8', NPM_CONFIG_USERCONFIG: path.join(consumerHome, 'user.npmrc'),
      NPM_CONFIG_GLOBALCONFIG: path.join(consumerHome, 'global.npmrc'), NPM_CONFIG_CACHE: path.join(consumerHome, 'cache'),
      NPM_CONFIG_REGISTRY: registry, NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    };
    const reports = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], { env }));
    check(reports.length === 1, 'Expected exactly one package');
    const report = reports[0];
    check(typeof report.filename === 'string' && /^[a-zA-Z0-9_.-]+\.tgz$/.test(report.filename), 'Invalid package filename');
    const tarball = path.join(temp, report.filename);
    const compressed = await readFile(tarball);
    const integrity = 'sha512-' + createHash('sha512').update(compressed).digest('base64');
    check(integrity === report.integrity, 'npm pack integrity differs from the actual tarball');
    const entries = readTarball(compressed);
    const files = auditPackage(entries, manifest, report);
    await smokeConsumer(temp, tarball, manifest, env);
    const verification = {
      name: manifest.name, version: manifest.version, node: process.version, integrity,
      sha256: createHash('sha256').update(compressed).digest('hex'), files,
      checks: ['dependency-sources', 'tar-safety', 'file-allowlist', 'sensitive-content-patterns',
        'isolated-install', 'portable-main-runtime-no-code-generation', 'portable-main-types', 'compiler-integrity-and-learner-projection',
        'schema-export', 'adaptation-recipe-contracts', 'generated-grading-projection', 'public-research-boundary', 'episode-requirements', 'bundled-license-notices', 'cli-validation-compilation-exclusive-output',
        'cli-init-test-lint-pack-verify-import', 'cli-course-package-pack-verify'],
    };
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      check((await readdir(outputDir)).length === 0, 'Output directory must be empty to avoid stale release artifacts');
      await copyFile(tarball, path.join(outputDir, report.filename));
      await writeFile(path.join(outputDir, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
    }
    console.log(`Verified ${manifest.name}@${manifest.version}: ${files.length} packed files; isolated consumer, portable main/types, course/adaptation integrity and projections, bounded recipes, public research, episode requirements, bundled notices, schemas and CLI passed on ${process.version}.`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Package verification failed: ${error.message}`);
  process.exitCode = 1;
});
