import { decideGate, type GateDecisionContext } from './gate-decision.js';
import { canonicalJson } from './json.js';
import type { ValidationIssue } from './types.js';
import type { GateDecision } from './record-types.js';

/**
 * 0.6: deterministic replay of recorded gate decisions. Each entry holds the evidence and context a
 * decision was made from and the decision that was recorded. Replaying runs the SDK reference
 * evaluator again, against the current (perhaps edited) course, and reports which decisions are
 * reproduced exactly and which fields changed. Replay is pure: it writes nothing, grants nothing and
 * contacts nothing, so it is safe on exported records; it never replaces the recorded decision.
 */
export interface GateReplayEntry {
  gateId: string;
  evidence: unknown[];
  context: GateDecisionContext;
  /** The decision as it was recorded. */
  decision: GateDecision;
}
export interface GateReplayFile { gateReplayFormat: 1; decisions: GateReplayEntry[] }
export interface GateReplayOutcome {
  decisionId: string | null;
  gateId: string | null;
  status: 'reproduced' | 'changed' | 'invalid';
  /** Top-level decision fields whose replayed value differs from the recording. */
  changedFields: string[];
  recorded: { status: string } | null;
  replayed: { status: string } | null;
  issues: ValidationIssue[];
}
export interface GateReplayReport {
  gateReplayFormat: 1;
  status: 'reproduced' | 'changed' | 'invalid';
  summary: { decisions: number; reproduced: number; changed: number; invalid: number };
  decisions: GateReplayOutcome[];
  issues: ValidationIssue[];
}
export const GATE_REPLAY_LIMITS = Object.freeze({ decisions: 1000, evidencePerDecision: 500 });

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function replayGateDecisions(courseInput: unknown, replayInput: unknown): GateReplayReport {
  const fail = (issues: ValidationIssue[]): GateReplayReport =>
    ({ gateReplayFormat: 1, status: 'invalid', summary: { decisions: 0, reproduced: 0, changed: 0, invalid: 0 }, decisions: [], issues });
  if (!isObject(replayInput) || replayInput.gateReplayFormat !== 1 || !Array.isArray(replayInput.decisions))
    return fail([{ code: 'INVALID_REPLAY', path: '', message: 'A replay file is { "gateReplayFormat": 1, "decisions": [...] }.' }]);
  if (!replayInput.decisions.length || replayInput.decisions.length > GATE_REPLAY_LIMITS.decisions)
    return fail([{ code: 'INVALID_REPLAY', path: '/decisions', message: `List 1 to ${GATE_REPLAY_LIMITS.decisions} recorded decisions.` }]);
  const decisions = replayInput.decisions.map((entry, i): GateReplayOutcome => {
    const at = `/decisions/${i}`;
    const invalid = (issues: ValidationIssue[], decisionId: string | null = null, gateId: string | null = null): GateReplayOutcome =>
      ({ decisionId, gateId, status: 'invalid', changedFields: [], recorded: null, replayed: null, issues });
    if (!isObject(entry) || typeof entry.gateId !== 'string' || !Array.isArray(entry.evidence) || !isObject(entry.context) || !isObject(entry.decision))
      return invalid([{ code: 'INVALID_REPLAY', path: at, message: 'Each entry has gateId, evidence[], context and the recorded decision.' }]);
    const recorded = entry.decision as unknown as GateDecision;
    const decisionId = typeof recorded.decisionId === 'string' ? recorded.decisionId : null;
    if (entry.evidence.length > GATE_REPLAY_LIMITS.evidencePerDecision)
      return invalid([{ code: 'INVALID_REPLAY', path: `${at}/evidence`, message: `At most ${GATE_REPLAY_LIMITS.evidencePerDecision} evidence records per decision.` }], decisionId, entry.gateId);
    const result = decideGate(courseInput, entry.gateId, entry.evidence, entry.context as unknown as GateDecisionContext);
    if (!result.valid) return invalid(result.issues.map(issue => ({ ...issue, path: `${at}${issue.path}` })), decisionId, entry.gateId);
    const replayed = result.decision as unknown as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(replayed), ...Object.keys(recorded)])].sort();
    const changedFields = keys.filter(key => {
      const [a, b] = [replayed[key], (recorded as unknown as Record<string, unknown>)[key]];
      if (a === undefined || b === undefined) return a !== b;
      try { return canonicalJson(a) !== canonicalJson(b); } catch { return true; }
    });
    return { decisionId, gateId: entry.gateId, status: changedFields.length ? 'changed' : 'reproduced', changedFields,
      recorded: { status: String(recorded.status) }, replayed: { status: result.decision.status }, issues: [] };
  });
  const tally = (status: GateReplayOutcome['status']) => decisions.filter(d => d.status === status).length;
  const summary = { decisions: decisions.length, reproduced: tally('reproduced'), changed: tally('changed'), invalid: tally('invalid') };
  return { gateReplayFormat: 1, status: summary.invalid ? 'invalid' : summary.changed ? 'changed' : 'reproduced', summary, decisions, issues: [] };
}
