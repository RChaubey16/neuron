const KNOWN_SERVICE_LABELS: Record<string, string> = {
  'url-shortener': 'URL shortener',
};

/** Maps a `UsageLog.service` slug to a display label, title-casing anything unrecognized. */
export function serviceLabel(slug: string): string {
  return (
    KNOWN_SERVICE_LABELS[slug] ??
    slug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
  );
}
