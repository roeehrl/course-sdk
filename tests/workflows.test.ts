import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../.github/workflows/', import.meta.url);
const workflows = Object.fromEntries(readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)).sort()
  .map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]));
const header = (text: string) => text.slice(0, text.indexOf('\njobs:\n'));

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

  it('keeps every token read-only and never uses privileged pull-request triggers or secrets', () => {
    for (const [name, text] of Object.entries(workflows)) {
      expect(header(text), name).toMatch(/\npermissions:\n {2}contents: read\n/);
      expect(text, name).not.toMatch(/: write\s*$|pull_request_target|continue-on-error|secrets\./m);
    }
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
