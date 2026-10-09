import type { LiteratureField, LiteratureReference, LiteratureResult, Source } from './types';

export const MAX_REVIEW_SOURCES = 12;
export const MAX_REVIEW_CONTEXT = 100_000;
export const LITERATURE_FIELDS: LiteratureField[] = ['abstract', 'method', 'findings', 'limitations', 'notes'];
export const LITERATURE_LIMITATION =
  'Draft based on the selected saved abstracts and reading notes. Check each claim against its source. This is not a systematic review or a full-text assessment.';

export function hasLiteratureEvidence(source: Source): boolean {
  return LITERATURE_FIELDS.some(field => source[field].replace(/\s+/gu, ' ').trim().length >= 12);
}

/** Preserve Unicode characters when bounding the material shared with the assistant. */
function excerpt(value: string, max: number): string {
  const text = value.trim();
  let end = Math.min(max, text.length);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end);
}

/** Keep a stable, bounded evidence snapshot with the draft and its citations. */
export function literatureReferences(sources: Source[], sourceIds: string[]): LiteratureReference[] {
  if (!sourceIds.length || sourceIds.length > MAX_REVIEW_SOURCES)
    throw new Error(`Choose between 1 and ${MAX_REVIEW_SOURCES} saved sources for your review.`);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('Each review source must be selected once.');
  return sourceIds.map((sourceId, index) => {
    const source = sources.find(item => item.id === sourceId);
    if (!source) throw new Error('A selected source is no longer in this project. Choose your sources again.');
    if (!hasLiteratureEvidence(source))
      throw new Error(`Add an abstract or reading notes for “${source.title.slice(0, 100)}” before reviewing it.`);
    const excerpts = Object.fromEntries(
      LITERATURE_FIELDS.map(field => [
        field,
        excerpt(source[field], field === 'abstract' || field === 'notes' ? 2_000 : 800),
      ]),
    ) as Record<LiteratureField, string>;
    const hasNotes = LITERATURE_FIELDS.some(field => field !== 'abstract' && Boolean(excerpts[field]));
    return {
      id: `S${index + 1}`,
      sourceId,
      title: source.title,
      authors: source.authors.slice(0, 5),
      authorCount: source.authors.length,
      year: source.year,
      url: source.url,
      doi: source.doi,
      material: excerpts.abstract ? (hasNotes ? 'abstract-and-notes' : 'abstract') : 'reading-notes',
      excerpts,
      truncatedFields: LITERATURE_FIELDS.filter(field => source[field].trim().length > excerpts[field].length),
    };
  });
}

export function reviewMaterialLabel(reference: LiteratureReference): string {
  return reference.material === 'abstract'
    ? 'Supplied abstract'
    : reference.material === 'reading-notes'
      ? 'Your reading notes'
      : 'Supplied abstract and your reading notes';
}

export function literatureSourcesUnchanged(references: LiteratureReference[], sources: Source[]): boolean {
  return references.every(reference => {
    const current = sources.find(source => source.id === reference.sourceId);
    if (!current) return false;
    if (
      JSON.stringify([
        current.title,
        current.authors.slice(0, 5),
        current.authors.length,
        current.year,
        current.url,
        current.doi,
      ]) !==
      JSON.stringify([
        reference.title,
        reference.authors,
        reference.authorCount,
        reference.year,
        reference.url,
        reference.doi,
      ])
    )
      return false;
    return LITERATURE_FIELDS.every(field =>
      reference.truncatedFields.includes(field)
        ? current[field].trim().startsWith(reference.excerpts[field])
        : current[field].trim() === reference.excerpts[field],
    );
  });
}

export function literatureMarkdown(result: LiteratureResult): string {
  const number = (sourceId: string) => result.references.findIndex(reference => reference.id === sourceId) + 1;
  const sections = result.sections
    .map(
      section =>
        `### ${section.heading}\n\n${section.paragraphs
          .map(
            paragraph =>
              `${paragraph.text} ${[...new Set(paragraph.citations.map(citation => number(citation.sourceId)))].map(n => `[${n}]`).join(' ')}`,
          )
          .join('\n\n')}`,
    )
    .join('\n\n');
  const references = result.references
    .map(
      (reference, index) =>
        `${index + 1}. ${reference.authors.join(', ') || 'Author not listed'}${reference.authorCount > reference.authors.length ? ', et al.' : ''} (${reference.year || 'undated'}). ${reference.title}. ${reference.url}\n   Material used: ${reviewMaterialLabel(reference)}${reference.truncatedFields.length ? ' (excerpts)' : ''}.`,
    )
    .join('\n\n');
  const limitations = [LITERATURE_LIMITATION, ...result.limitations].map(value => `- ${value}`).join('\n');
  return `## ${result.title}\n\n${sections}\n\n### Review limitations\n\n${limitations}\n\n### References\n\n${references}`;
}
