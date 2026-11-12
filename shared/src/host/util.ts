/** Random hex token using Web Crypto (available in browsers and Node 20+). */
export function randomToken(bytes = 16): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
