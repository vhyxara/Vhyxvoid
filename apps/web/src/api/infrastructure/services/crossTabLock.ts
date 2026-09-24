// Serializes a critical section across every tab of this origin with the
// Web Locks API (navigator.locks). Used for the token refresh (audit H10):
// each tab keeps its access token in memory and refreshes on its own, and two
// tabs refreshing at the same moment sent the same refresh cookie. Under the
// lock they refresh one after another, each sending the cookie the previous
// refresh just rotated to. Falls back to running fn directly where the API is
// missing (older browsers, SSR); the api's rotation grace window still makes
// that case safe.

export async function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined

  if (!locks?.request) return fn()

  return locks.request(name, { mode: 'exclusive' }, fn) as Promise<T>
}
