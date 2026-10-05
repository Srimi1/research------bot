import type { EvidenceResult } from '../src/shared/types';
import { crossrefSearchUrl, parseCrossref } from '../src/shared/crossref';
import { fetchNetwork, readLimited } from './network';

export { parseCrossref };

const MAX_RESPONSE_BYTES = 2_000_000;

/** Only calls the official Crossref host; result links are opened by the user separately. */
export async function searchEvidence(input: string, signal: AbortSignal): Promise<EvidenceResult> {
  const query = input.trim();
  if (query.length < 2 || query.length > 1_000) throw new Error('Enter a search query between 2 and 1,000 characters.');
  signal.throwIfAborted();
  const url = crossrefSearchUrl(query);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  try {
    const response = await fetchNetwork(url, {
      signal: combined, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'ResearchBot/0.1 (local scholarly research workspace; +https://github.com/Srimi1/research------bot)' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new Error('Crossref is limiting requests. Wait a moment and try again.');
      throw new Error(`Crossref search failed (HTTP ${response.status}). Please try again later.`);
    }
    const body = await readLimited(response, MAX_RESPONSE_BYTES);
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new Error('Crossref returned invalid JSON. Please try again later.'); }
    return parseCrossref(payload, query);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (combined.aborted) throw new Error('Crossref search timed out. Please try again.');
    throw error;
  }
}
