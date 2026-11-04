// Requests per device. Everyone in the workshop shares one Wi-Fi (one IP), so
// limits are per device: Launchpad sends a random id it keeps in localStorage.
// Counts live in a KV namespace bound as RATE_LIMIT_KV; without it there is no limit.

const WINDOW_SECONDS = 10 * 60
const MAX_REQUESTS = 20

export async function allowRequest(kv: KVNamespace | undefined, deviceId: string): Promise<boolean> {
  // Not bound (or set as a plain text variable by mistake): no limit.
  if (typeof kv?.get !== 'function') return true
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS)
  const key = `rl:${deviceId}:${window}`
  const count = Number((await kv.get(key)) ?? 0)
  if (count >= MAX_REQUESTS) return false
  // KV is eventually consistent, so this is a soft limit, which is fine for a workshop.
  await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS * 2 })
  return true
}
