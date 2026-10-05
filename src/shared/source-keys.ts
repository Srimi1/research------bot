/** Keys that decide when two saved sources are the same work. Shared by the desktop store and the browser preview. */
export function normalizeDoi(value: string): string {
  const doi = value
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .toLowerCase();
  if (!doi) return '';
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 2_000) throw new Error('The DOI is invalid.');
  return doi;
}

export function canonicalSourceUrl(value: string): string {
  if (!value.trim()) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The source URL is invalid.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Source URLs must be public HTTP or HTTPS links without credentials.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}
