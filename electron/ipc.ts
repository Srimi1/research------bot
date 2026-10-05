import { ZodError, type ZodIssue } from 'zod';
import type { IpcResult } from './ipc-protocol';

export { unwrap, type IpcResult } from './ipc-protocol';

const FALLBACK = 'Something went wrong. Please try again.';

function label(issue: ZodIssue): string {
  const name = [...issue.path].reverse().find((part): part is string => typeof part === 'string');
  if (!name) return 'This value';
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeIssue(issue: ZodIssue): string {
  const field = label(issue);
  const detail = issue as ZodIssue & { origin?: string; maximum?: number | bigint; minimum?: number | bigint; format?: string };
  switch (issue.code) {
    case 'too_big':
      if (detail.origin === 'string') return `${field} is too long. The limit is ${detail.maximum} characters.`;
      if (detail.origin === 'array') return `${field} has too many items. The limit is ${detail.maximum}.`;
      return `${field} must be at most ${detail.maximum}.`;
    case 'too_small':
      if (detail.origin === 'string') return Number(detail.minimum) <= 1 ? `${field} cannot be empty.` : `${field} must be at least ${detail.minimum} characters.`;
      if (detail.origin === 'array') return `${field} needs at least ${detail.minimum} item${Number(detail.minimum) === 1 ? '' : 's'}.`;
      return `${field} must be at least ${detail.minimum}.`;
    case 'invalid_format':
      return detail.format === 'uuid' ? 'That item is no longer valid. Reload the project and try again.' : `${field} is not in a valid format.`;
    case 'invalid_type':
      return `${field} is missing or has the wrong type.`;
    case 'custom':
      return issue.message;
    default:
      return `${field}: ${issue.message}`;
  }
}

/** A message safe and readable enough to show directly to the researcher. */
export function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    const lines = [...new Set(error.issues.map(describeIssue))];
    return lines.length ? lines.slice(0, 3).join(' ') : FALLBACK;
  }
  if (error instanceof Error && error.message) return error.message;
  return FALLBACK;
}

export async function toResult<T>(action: () => T | Promise<T>): Promise<IpcResult<T>> {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, message: describeError(error) }; }
}
