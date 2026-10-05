import { randomUUID } from 'node:crypto';
import type { EvidenceResult, Source } from '../src/shared/types';
import { fetchNetwork, readLimited } from './network';
import { normalizeDoi } from './store';

const MAX_RESPONSE_BYTES = 2_000_000;
const LIMITATIONS = 'These are bibliographic records retrieved from Crossref, not a completed literature review. Relevance ranking is approximate; coverage depends on publisher deposits, and metadata may be incomplete or outdated. Long titles and author lists may be shortened for display. Read each linked source before recording its methods, findings, or limitations. Reports: also search the relevant government, university, or organization website with your keywords and filetype:pdf. Forums: search a relevant community directly, check the author and date, and treat posts as perspectives rather than scholarly evidence. No report or forum page has been independently inspected by this search.';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function plainText(value: unknown, max = 100_000): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, max).replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|#39|#34);/g, entity => {
    const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#34;': '"' };
    return entities[entity] ?? entity;
  }).replace(/\s+/g, ' ').trim();
}

function publishedYear(work: Record<string, unknown>): string {
  for (const name of ['published', 'published-print', 'published-online', 'issued']) {
    const parts = record(work[name])?.['date-parts'];
    if (!Array.isArray(parts) || !Array.isArray(parts[0])) continue;
    const year: unknown = parts[0][0];
    if (typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 3000) return String(year);
  }
  return '';
}

/** Parse publisher-deposited metadata only. Never infer findings from titles or abstracts. */
export function parseCrossref(payload: unknown, query: string, retrievedAt = new Date().toISOString()): EvidenceResult {
  const envelope = record(payload); const message = record(envelope?.message);
  if (envelope?.status !== 'ok' || !Array.isArray(message?.items)) throw new Error('Crossref returned an unexpected metadata response. Please try again.');
  const sources: Source[] = []; const seen = new Set<string>();
  for (const item of message.items.slice(0, 50)) {
    const work = record(item);
    if (!work || !Array.isArray(work.title) || typeof work.DOI !== 'string') continue;
    const title = plainText(work.title[0], 2_000);
    let doi: string;
    try { doi = normalizeDoi(work.DOI); } catch { continue; }
    if (!title || !doi || doi.length > 500 || /[<>\u0000-\u001f]/.test(doi) || seen.has(doi)) continue;
    const url = `https://doi.org/${doi.split('/').map(part => encodeURIComponent(part)).join('/')}`;
    if (url.length > 3_000) continue;
    seen.add(doi);
    const authors = Array.isArray(work.author) ? work.author.slice(0, 200).map(author => {
      const person = record(author);
      return person ? ([plainText(person.given, 1_000), plainText(person.family, 1_000)].filter(Boolean).join(' ') || plainText(person.name, 1_000)).slice(0, 1_000) : '';
    }).filter(Boolean) : [];
    const category = work.type === 'report' ? 'report' : ['journal-article', 'proceedings-article', 'book-chapter'].includes(String(work.type)) ? 'article' : 'document';
    sources.push({
      id: randomUUID(), title, authors, year: publishedYear(work),
      url,
      doi, category, inspected: 'metadata', retrievedAt, abstract: plainText(work.abstract), query,
      method: '', findings: '', limitations: '', notes: '',
    });
  }
  return { kind: 'evidence', sources, query, cached: false, limitations: LIMITATIONS };
}

/** Only calls the official Crossref host; result links are opened by the user separately. */
export async function searchEvidence(input: string, signal: AbortSignal): Promise<EvidenceResult> {
  const query = input.trim();
  if (query.length < 2 || query.length > 1_000) throw new Error('Enter a search query between 2 and 1,000 characters.');
  signal.throwIfAborted();
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.bibliographic', query);
  url.searchParams.set('rows', '12');
  url.searchParams.set('select', 'DOI,title,author,published,published-print,published-online,issued,type,abstract');
  const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  try {
    const response = await fetchNetwork(url, {
      signal: combined, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'ResearchBot/0.1 (local scholarly research workspace)' },
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
