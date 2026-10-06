import { ArrowRight, BookOpen, Check, FileText, Lightbulb, ListChecks, Search, Sparkles } from 'lucide-react';
import type { Role } from './shared/types';

/** A small paper illustration, rather than pretend projects or fabricated research results. */
export function WelcomeArtwork() {
  return (
    <div className="welcome-art" aria-hidden="true">
      <div className="art-orbit art-orbit-outer" />
      <div className="art-orbit art-orbit-inner" />
      <span className="art-star art-star-one">
        <Sparkles size={22} />
      </span>
      <span className="art-star art-star-two">
        <PlusMark />
      </span>
      <div className="art-paper art-paper-back">
        <span />
        <span />
        <span />
      </div>
      <div className="art-paper art-paper-front">
        <span className="art-paper-label">
          <Lightbulb size={15} /> A little curiosity
        </span>
        <strong>What if?</strong>
        <div className="art-paper-lines">
          <span />
          <span />
        </div>
        <span className="art-paper-tag">
          <Search size={12} /> Follow the question
        </span>
      </div>
      <span className="art-bubble art-bubble-book">
        <BookOpen size={21} />
      </span>
      <span className="art-bubble art-bubble-idea">
        <Lightbulb size={21} />
      </span>
      <span className="art-caption">
        <Check size={13} /> Your ideas. Your discoveries.
      </span>
    </div>
  );
}

function PlusMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1v13M1 7.5h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ProjectOverview({
  wordCount,
  sourceCount,
  stepCount,
  completed,
  onNotes,
  onSources,
  onPlan,
  onAsk,
}: {
  wordCount: number;
  sourceCount: number;
  stepCount: number;
  completed: number;
  onNotes: () => void;
  onSources: () => void;
  onPlan: () => void;
  onAsk: (role: Role) => void;
}) {
  const next = !wordCount
    ? {
        title: 'Start with what you know',
        description: 'An observation or a rough idea is enough.',
        action: 'Write a first note',
        onClick: onNotes,
      }
    : !sourceCount
      ? {
          title: 'Follow your first lead',
          description: 'Find an article that helps you understand your question.',
          action: 'Discover sources',
          onClick: () => onAsk('evidence'),
        }
      : !stepCount
        ? {
            title: 'Give your ideas a direction',
            description: 'Turn what you have learned into a few practical steps.',
            action: 'Explore methods',
            onClick: () => onAsk('methods'),
          }
        : completed < stepCount
          ? {
              title: 'Keep your research moving',
              description: `${stepCount - completed} step${stepCount - completed === 1 ? '' : 's'} left in your plan. Take them one at a time.`,
              action: 'See your plan',
              onClick: onPlan,
            }
          : {
              title: 'Make room for the next insight',
              description: 'Your planned steps are complete. Reflect on what you learned.',
              action: 'Return to notes',
              onClick: onNotes,
            };
  return (
    <section className="mobile-overview" aria-label="Project overview">
      <div className="research-stats">
        <button onClick={onNotes} aria-label={`${wordCount} words in your notes`}>
          <FileText size={17} />
          <strong>{wordCount}</strong>
          <span>words</span>
        </button>
        <button onClick={onSources} aria-label={`${sourceCount} saved sources`}>
          <BookOpen size={17} />
          <strong>{sourceCount}</strong>
          <span>sources</span>
        </button>
        <button onClick={onPlan} aria-label={`${completed} of ${stepCount} steps complete`}>
          <ListChecks size={17} />
          <strong>
            {completed}
            <small>/{stepCount}</small>
          </strong>
          <span>steps done</span>
        </button>
      </div>
      <div className="next-move">
        <span className="next-move-icon">
          <Sparkles size={18} />
        </span>
        <div>
          <span className="eyebrow">A good next move</span>
          <h2>{next.title}</h2>
          <p>{next.description}</p>
          <button onClick={next.onClick}>
            {next.action}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
