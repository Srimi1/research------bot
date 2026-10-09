import { useState } from 'react';
import { BookOpen, Check, Copy, ExternalLink } from 'lucide-react';
import type { LiteratureResult, Source } from './shared/types';
import {
  hasLiteratureEvidence,
  LITERATURE_LIMITATION,
  literatureMarkdown,
  literatureSourcesUnchanged,
  MAX_REVIEW_SOURCES,
  reviewMaterialLabel,
} from './shared/literature';

export function LiteratureSources({
  sources,
  selected,
  disabled,
  onChange,
  onLibrary,
}: {
  sources: Source[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onLibrary: () => void;
}) {
  return (
    <fieldset className="literature-picker" disabled={disabled}>
      <legend>Choose papers for this review</legend>
      <p className="help">
        {selected.length} selected · up to {MAX_REVIEW_SOURCES}. The selected sources’ references, abstracts and saved
        matrix notes are shared with ChatGPT, along with your focus and research question.
      </p>
      {sources.length ? (
        sources.map(source => {
          const checked = selected.includes(source.id);
          const eligible = hasLiteratureEvidence(source);
          return (
            <label key={source.id} className={`literature-source ${!eligible ? 'without-evidence' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!eligible || (!checked && selected.length >= MAX_REVIEW_SOURCES)}
                onChange={() => onChange(checked ? selected.filter(id => id !== source.id) : [...selected, source.id])}
              />
              <span>
                <strong>{source.title}</strong>
                <small>
                  {source.authors.slice(0, 2).join(', ') || 'Author not listed'} · {source.year || 'Undated'}
                </small>
                <small>
                  {eligible
                    ? 'Saved evidence available'
                    : 'Add an abstract or reading notes before including this paper.'}
                </small>
              </span>
            </label>
          );
        })
      ) : (
        <p>No saved papers yet. Add sources and reading notes to begin your review.</p>
      )}
      <button type="button" className="text-button" onClick={onLibrary}>
        <BookOpen size={15} /> Open source library
      </button>
    </fieldset>
  );
}

export function LiteratureReview({
  result,
  sources,
  currentNotes,
  onAccept,
  onOpen,
}: {
  result: LiteratureResult;
  sources: Source[];
  currentNotes: string;
  onAccept: (text: string) => Promise<void>;
  onOpen: (url: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const markdown = literatureMarkdown(result);
  const added = currentNotes.includes(markdown);
  const stale = !literatureSourcesUnchanged(result.references, sources);
  const number = (id: string) => result.references.findIndex(source => source.id === id) + 1;
  return (
    <article className="literature-review" aria-label="Literature review draft">
      <h3>{result.title}</h3>
      <p className="evidence-disclaimer">{LITERATURE_LIMITATION}</p>
      <p className="help">
        {result.references.length} saved paper{result.references.length === 1 ? '' : 's'} · citations include supporting
        excerpts
      </p>
      {stale && (
        <p className="callout">Sources changed after this draft. Run a new review before adding it to your notes.</p>
      )}
      {result.sections.map((section, index) => (
        <section key={index}>
          <h4>{section.heading}</h4>
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <div className="literature-paragraph" key={paragraphIndex}>
              <p>
                {paragraph.text}{' '}
                {[...new Set(paragraph.citations.map(citation => citation.sourceId))].map(id => (
                  <a key={id} className="literature-citation" href={`#literature-reference-${id}`}>
                    [{number(id)}]
                  </a>
                ))}
              </p>
              <details className="literature-evidence">
                <summary>Supporting evidence for this paragraph</summary>
                {paragraph.citations.map((citation, citationIndex) => (
                  <blockquote key={citationIndex}>
                    <p>“{citation.quote}”</p>
                    <cite>
                      [{number(citation.sourceId)}] · {citation.field === 'notes' ? 'reading notes' : citation.field}
                    </cite>
                  </blockquote>
                ))}
              </details>
            </div>
          ))}
        </section>
      ))}
      <section>
        <h4>Review limitations</h4>
        <ul>
          {result.limitations.map((value, index) => (
            <li key={index}>{value}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>References</h4>
        <ol className="literature-references">
          {result.references.map(reference => (
            <li key={reference.id} id={`literature-reference-${reference.id}`}>
              <button className="text-button" onClick={() => void onOpen(reference.url)}>
                {reference.title} <ExternalLink size={13} />
              </button>
              <p>
                {reference.authors.join(', ') || 'Author not listed'}
                {reference.authorCount > reference.authors.length ? ', et al.' : ''} ({reference.year || 'undated'})
              </p>
              <small>
                {reviewMaterialLabel(reference)}
                {reference.truncatedFields.length ? ' · excerpts used' : ''}
              </small>
            </li>
          ))}
        </ol>
      </section>
      <div className="literature-actions">
        <button
          className="button primary"
          disabled={busy || added || stale}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              await onAccept(markdown);
              setMessage('Review added to your notes. Use Export to save it with its references.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'The review could not be added. Try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {added ? <Check size={16} /> : <BookOpen size={16} />}
          {busy ? 'Saving review…' : added ? 'Added to notes' : 'Add reviewed draft to notes'}
        </button>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(markdown);
              setMessage('Draft copied with its references and limitations.');
            } catch {
              setMessage('Copy is unavailable. Add the reviewed draft to notes, then use Export.');
            }
          }}
        >
          <Copy size={15} /> Copy draft
        </button>
      </div>
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
    </article>
  );
}
