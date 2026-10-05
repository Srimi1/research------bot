import { MAX_AGENT_INPUT, MAX_SEARCH_QUERY } from './limits';
import type { Role } from './types';

export interface AgentDraft {
  question: string;
  notes: string;
  taskInput: string;
}
export interface AgentInput {
  text: string;
  /** Shown to the researcher when part of their notes was not shared. */
  notice?: string;
}

const count = (value: number) => value.toLocaleString('en-US');
const FALLBACK_QUERY = 500;
const NOTES_LABEL = "Researcher's notes:\n";
const MIN_NOTES = 500;

function truncationMarker(kept: number, total: number): string {
  return `\n[Notes truncated: only the first ${count(kept)} of ${count(total)} characters were shared.]`;
}

/** Cut at a word boundary where possible, and never inside a surrogate pair. */
function cutAt(value: string, max: number): string {
  let end = Math.min(max, value.length);
  if (end < value.length) {
    const boundary = value.lastIndexOf(' ', end);
    if (boundary > end * 0.8) end = boundary;
  }
  const last = value.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end--;
  return value.slice(0, end);
}

/**
 * Decide exactly what text one assistant request carries, so an oversized notes field produces
 * a clear message (or a disclosed excerpt) instead of a validation failure deep in the backend.
 */
export function buildAgentInput(role: Role, draft: AgentDraft): AgentInput {
  const question = draft.question.trim();
  const instruction = draft.taskInput.trim();
  const notes = draft.notes;

  if (role === 'grammar') {
    if (!notes.trim()) throw new Error('Write a few sentences in your notes before reviewing grammar.');
    // A grammar review rewrites the notes from the reviewed text, so it must never see a partial copy.
    if (notes.length > MAX_AGENT_INPUT) {
      throw new Error(
        `Your notes are ${count(notes.length)} characters long, and grammar review can check up to ${count(MAX_AGENT_INPUT)} at a time. Trim or split your notes, then try again.`,
      );
    }
    return { text: notes };
  }

  if (role === 'evidence') {
    const explicit = instruction || question;
    if (explicit.length > MAX_SEARCH_QUERY) {
      throw new Error(
        `Search queries can be up to ${count(MAX_SEARCH_QUERY)} characters. Shorten your search or your research question.`,
      );
    }
    const query = explicit || cutAt(notes.replace(/\s+/g, ' ').trim(), FALLBACK_QUERY);
    if (!query) throw new Error('Add a question, rough notes, or an instruction to begin.');
    return { text: query };
  }

  const head = [instruction, question ? `Research question: ${question}` : ''].filter(Boolean).join('\n\n');
  if (!head && !notes.trim()) throw new Error('Add a question, rough notes, or an instruction to begin.');
  const full = [head, notes ? `${NOTES_LABEL}${notes}` : ''].filter(Boolean).join('\n\n');
  if (full.length <= MAX_AGENT_INPUT) return { text: full };

  const reserved =
    (head ? head.length + 2 : 0) + NOTES_LABEL.length + 2 + truncationMarker(MAX_AGENT_INPUT, notes.length).length;
  const room = MAX_AGENT_INPUT - reserved;
  if (room < MIN_NOTES) {
    throw new Error(
      `Your instruction and research question are too long to share with your notes. Keep them under ${count(MAX_AGENT_INPUT - MIN_NOTES - 1_000)} characters in total.`,
    );
  }
  const kept = cutAt(notes, room);
  return {
    text: [head, `${NOTES_LABEL}${kept}${truncationMarker(kept.length, notes.length)}`].filter(Boolean).join('\n\n'),
    notice: `Your notes are long, so only the first ${count(kept.length)} of ${count(notes.length)} characters were shared with the assistant.`,
  };
}
