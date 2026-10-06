import type { EvidenceResult } from '../src/shared/types';
import { crossrefSearchUrl, parseCrossref } from '../src/shared/crossref';
import { version } from '../package.json';
import { readLimited, type Fetch } from './platform';

export { parseCrossref };

const MAX_RESPONSE_BYTES = 2_000_000;

export type EvidenceSearch = (input: string, signal: AbortSignal) => Promise<EvidenceResult>;

/** Only calls the official Crossref host; result links are opened by the user separately. */
export const createEvidenceSearch =
  (fetch: Fetch): EvidenceSearch =>
  async (input, signal) => {
    const query = input.trim();
    if (query.length < 2 || query.length > 1_000)
      throw new Error('Enter a search query between 2 and 1,000 characters.');
    signal.throwIfAborted();
    const url = crossrefSearchUrl(query);
    const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    try {
      const response = await fetch(url, {
        signal: combined,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': `ResearchBot/${version} (local scholarly research workspace; +https://github.com/Srimi1/research------bot)`,
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new Error('Crossref is limiting requests. Wait a moment and try again.');
        throw new Error(`Crossref search failed (HTTP ${response.status}). Please try again later.`);
      }
      const body = await readLimited(response, MAX_RESPONSE_BYTES);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error('Crossref returned invalid JSON. Please try again later.');
      }
      return parseCrossref(payload, query);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (combined.aborted) throw new Error('Crossref search timed out. Please try again.');
      throw error;
    }
  };
