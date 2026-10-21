import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../.github/workflows/', import.meta.url);
const workflows = Object.fromEntries(readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)).sort()
  .map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]));
const header = (text: string) => text.slice(0, text.indexOf('\njobs:\n'));
/** Top-level job blocks: two-space-indented keys under `jobs:`. */
function jobs(text: string) {
  const result: Record<string, string> = {};
  let name: string | undefined;
  for (const line of text.slice(text.indexOf('\njobs:\n') + 7).split('\n')) {
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (match) { name = match[1]!; result[name] = ''; } else if (name) result[name] += `${line}\n`;
  }
  return result;
}

describe('workflow policy', () => {
  it('uses only official actions pinned to full commit SHAs', () => {
    expect(Object.keys(workflows)).toEqual(expect.arrayContaining(['ci.yml', 'nightly.yml', 'release.yml', 'verify.yml']));
    for (const [name, text] of Object.entries(workflows)) {
      for (const [, ref] of text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)) {
        if (ref!.startsWith('./.github/workflows/')) continue;
        expect(ref, name).toMatch(/^actions\/[a-z0-9-]+@[a-f0-9]{40}$/);
      }
    }
  });

  it('keeps tokens read-only except OIDC and attestation access on the release-only provenance job', () => {
    for (const [name, text] of Object.entries(workflows)) {
      expect(header(text), name).toMatch(/\npermissions:\n {2}contents: read\n/);
      expect(header(text), name).not.toMatch(/: write/);
      expect(text, name).not.toMatch(/pull_request_target|continue-on-error|secrets\./);
      for (const [job, body] of Object.entries(jobs(text))) {
        const writes = [...body.matchAll(/^\s+([a-z-]+): write\s*$/gm)].map((m) => m[1]).sort();
        expect(writes, `${name} ${job}`).toEqual(name === 'release.yml' && job === 'provenance' ? ['attestations', 'id-token'] : []);
      }
    }
  });

  it('attests only the retained verified tarball after generating its SBOM, outside reusable PR verification', () => {
    const release = jobs(workflows['release.yml']!);
    expect(Object.keys(release)).toEqual(['verify', 'provenance']);
    const provenance = release.provenance!;
    expect(provenance).toMatch(/\n {4}needs: verify\n/);
    expect(provenance).toMatch(/\n {4}if: github\.repository == 'roeehrl\/course-sdk' && github\.ref_type == 'tag'\n/);
    const order = ['actions/download-artifact@', 'scripts/release-sbom.mjs', 'actions/attest-build-provenance@', 'actions/upload-artifact@'].map((step) => provenance.indexOf(step));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(provenance).toContain('digest-mismatch: error');
    expect(provenance).not.toMatch(/npm (publish|ci|install)|gh release/);
    expect(workflows['verify.yml']).not.toMatch(/id-token|attestations|attest-build-provenance/);
    expect(workflows['ci.yml']).not.toMatch(/release\.yml|id-token/);
  });

  it('verifies pull requests with types, lint, tests (including property tests), build, docs examples, API compatibility and the packed install', () => {
    const steps = [...workflows['verify.yml']!.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1]!.trim());
    const order = ['npm run typecheck', 'npm run lint', 'npm test', 'npm run build', 'npm run docs:examples', 'node scripts/api-compat.mjs',
      'node scripts/check-packed.mjs --output-dir "$RUNNER_TEMP/verified-sdk"'].map((step) => steps.indexOf(step));
    expect(order.every((at) => at >= 0), JSON.stringify(steps)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(readdirSync(new URL('./', import.meta.url))).toEqual(expect.arrayContaining(['properties.test.ts', 'api-compat.test.ts']));
    expect(workflows['ci.yml']).toMatch(/pull_request:/);
  });

  it('runs dependency scans only on a schedule or by dispatch, failing on findings', () => {
    const nightly = workflows['nightly.yml']!;
    const on = header(nightly).slice(header(nightly).indexOf('\non:\n'));
    expect(on).toMatch(/\n {2}schedule:\n {4}- cron: '[^']+'\n {2}workflow_dispatch:\n/);
    expect(on).not.toMatch(/pull_request|push:/);
    expect(nightly).toContain('npm audit --package-lock-only --audit-level=high');
    expect(nightly).toContain('echo "${OSV_SCANNER_SHA256}  ${scanner}" | sha256sum -c -');
    expect(nightly).toContain('scan source --lockfile=package-lock.json');
    expect(workflows['ci.yml']).not.toMatch(/schedule:/);
  });
});
