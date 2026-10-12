import { canonicalJson } from './json.js';
import type { CourseAdaptation, TeachingArtifact, TeachingArtifactDraft } from './adaptation-types.js';

/** Portable Web Crypto. Integrity is not authenticity, authorization or correctness. */
export async function digestJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required by this runtime.');
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function digestTeachingArtifact(artifact: TeachingArtifact | TeachingArtifactDraft): Promise<string> {
  canonicalJson(artifact);
  const { digest: _digest, ...payload } = artifact as TeachingArtifact;
  return digestJson(payload);
}
export async function digestAdaptationProposal(proposal: CourseAdaptation): Promise<string> {
  canonicalJson(proposal);
  const { proofReceipts: _receipts, ...payload } = proposal;
  return digestJson(payload);
}
