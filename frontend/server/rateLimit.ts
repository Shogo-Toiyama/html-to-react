// Requests per device. Everyone in the workshop shares one Wi-Fi (one IP), so
// limits are per device: Launchpad sends a random id it keeps in localStorage.
// Counts live in a KV namespace bound as RATE_LIMIT_KV; without it there is no limit.

const WINDOW_SECONDS = 10 * 60

/** Requests per device per 10 minutes, per endpoint. */
export const LIMITS = {
  /** Step suggestions (/api/suggest). */
  suggest: 20,
  /** Chat messages (/api/chat). */
  chat: 30,
}

export async function allowRequest(
  kv: KVNamespace | undefined,
  deviceId: string,
  bucket: keyof typeof LIMITS = 'suggest',
): Promise<boolean> {
  // Not bound (or set as a plain text variable by mistake): no limit.
  if (typeof kv?.get !== 'function') return true
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS)
  // The suggest bucket keeps its original key.
  const key = bucket === 'suggest' ? `rl:${deviceId}:${window}` : `rl:${bucket}:${deviceId}:${window}`
  const count = Number((await kv.get(key)) ?? 0)
  if (count >= LIMITS[bucket]) return false
  // KV is eventually consistent, so this is a soft limit, which is fine for a workshop.
  await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS * 2 })
  return true
}
