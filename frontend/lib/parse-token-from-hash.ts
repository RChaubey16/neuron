/** Extracts the `token` param from a URL fragment like `#token=<jwt>`. Returns null if absent. */
export function parseTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get('token');
}
