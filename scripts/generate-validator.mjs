import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Ajv2020, _ } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { CONTRACT_DEFINITIONS, RECORD_DEFINITIONS } from './contract-map.mjs';

const root = new URL('../', import.meta.url);
const course = JSON.parse(await readFile(new URL('src/course.schema.json', root), 'utf8'));
const adaptation = JSON.parse(await readFile(new URL('src/adaptation.schema.json', root), 'utf8'));
const ajv = new Ajv2020({
  allErrors: true, strict: true, strictRequired: false, ownProperties: true,
  code: { source: true, formats: _`require("ajv-formats/dist/formats").fullFormats` },
});
ajv.addFormat('date-time', fullFormats['date-time']);
ajv.addFormat('uri', fullFormats.uri);
ajv.addSchema(course); ajv.addSchema(adaptation);
await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
const targets = [
  ['course', course.$id], ['adaptation', adaptation.$id],
  ['research-selection', `${course.$id}#/$defs/publicResearchSelection`],
  ...[['adaptation-context', 'validationContext'], ['numerical-recipe', 'numericalRecipe'],
    ['recipe-instance', 'recipeInstance'], ['assignment-decisions', 'assignmentDecisions']]
    .map(([name, definition]) => [name, `${adaptation.$id}#/$defs/${definition}`]),
];
// One module exports a static validator per public contract and runtime record.
const contractExports = {};
for (const [name, definition] of Object.entries(CONTRACT_DEFINITIONS)) contractExports[`contract_${name}`] = definition;
for (const [name, definition] of Object.entries(RECORD_DEFINITIONS)) contractExports[`record_${name}`] = definition;
for (const [exportName, definition] of Object.entries(contractExports)) {
  ajv.addSchema({ $id: `urn:course-core:contract:${exportName}`, $ref: `${course.$id}#/$defs/${definition}` });
}
const exportsWith = prefix => Object.fromEntries(Object.keys(contractExports).filter(name => name.startsWith(prefix)).map(name => [name, `urn:course-core:contract:${name}`]));
targets.push(['contracts', exportsWith('contract_')], ['records', exportsWith('record_')]);
const licensed = new Map(); const inventory = [];
function notice(packages) {
  return 'Bundled validator runtime notices\n\nOriginal SDK code is Apache-2.0; the following included runtime code retains its own license.\n\n'
    + packages.map(name => { const p = licensed.get(name); return `${name}@${p.version}\n${p.licenseText}\n`; }).join('\n');
}
for (const [name, ref] of targets) {
  // Build-time code generation only. Consumers load static CSP-safe functions.
  const code = typeof ref === 'string' ? standaloneCode(ajv, ajv.compile({ $ref: ref })) : standaloneCode(ajv, ref);
  const result = await build({
    stdin: { contents: code, resolveDir: root.pathname, sourcefile: `${name}-validator.cjs` },
    outfile: new URL(`src/generated/${name}-validator.js`, root).pathname,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'inline',
    metafile: true, write: false,
  });
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    const module = input.slice(input.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const packageName = module.startsWith('@') ? module.split('/').slice(0, 2).join('/') : module.split('/')[0];
    if (!['ajv', 'ajv-formats', 'fast-deep-equal'].includes(packageName)) throw new Error('Review licensing for a newly bundled dependency.');
    packages.set(packageName, [...(packages.get(packageName) ?? []), module]);
    if (!licensed.has(packageName)) {
      const packageRoot = new URL(`node_modules/${packageName}/`, root);
      const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
      const licenseText = (await readFile(new URL('LICENSE', packageRoot), 'utf8')).trim();
      if (metadata.license !== 'MIT' || !licenseText.includes('Copyright') || !licenseText.includes('Permission is hereby granted')) throw new Error('Review changed bundled license terms.');
      licensed.set(packageName, { version: metadata.version, licenseText, licenseSha256: createHash('sha256').update(licenseText).digest('hex') });
    }
  }
  const names = [...packages.keys()].sort();
  const banner = notice(names);
  if (banner.includes('*/')) throw new Error('License text requires safe comment encoding.');
  await writeFile(new URL(`src/generated/${name}-validator.js`, root), `/*!\n${banner}\n*/\n${result.outputFiles[0].text}`);
  inventory.push({ validator: name, dependencies: names.map(name => ({ name, version: licensed.get(name).version,
    license: 'MIT', licenseSha256: licensed.get(name).licenseSha256, modules: packages.get(name).sort() })) });
}
await writeFile(new URL('NOTICE', root), notice([...licensed.keys()].sort()));
await writeFile(new URL('src/generated/validator-dependencies.json', root), JSON.stringify(inventory, null, 2) + '\n');
