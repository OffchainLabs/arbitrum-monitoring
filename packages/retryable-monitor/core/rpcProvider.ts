import { providers } from 'ethers'

type RpcStats = {
  calls: number
  totalMs: number
  slowCalls: number
  throttled: number
}

const SLOW_CALL_MS = 5000
const PROGRESS_EVERY_CALLS = 1000

const statsByHost = new Map<string, RpcStats>()

const formatStats = (host: string, stats: RpcStats) =>
  `[rpc] ${host}: ${stats.calls} calls, avg ${Math.round(
    stats.totalMs / Math.max(stats.calls, 1)
  )}ms, ${stats.slowCalls} slower than ${SLOW_CALL_MS / 1000}s, ${
    stats.throttled
  } rate-limited (429)`

// JsonRpcProvider sends eth_chainId before nearly every request; the static
// variant caches it. ethers retries 429s silently, so they are counted here,
// and progress is logged periodically since a run killed by the job timeout
// never reaches the final summary.
export const createRpcProvider = (url: string) => {
  const host = new URL(url).host
  const stats = statsByHost.get(host) ?? {
    calls: 0,
    totalMs: 0,
    slowCalls: 0,
    throttled: 0,
  }
  statsByHost.set(host, stats)

  const provider = new providers.StaticJsonRpcProvider({
    url,
    throttleCallback: async () => {
      if (stats.throttled === 0) {
        console.warn(`[rpc] ${host} is rate limiting requests (429)`)
      }
      stats.throttled++
      return true
    },
  })

  const send = provider.send.bind(provider)
  provider.send = async (method: string, params: Array<unknown>) => {
    const start = Date.now()
    try {
      return await send(method, params)
    } finally {
      const ms = Date.now() - start
      stats.calls++
      stats.totalMs += ms
      if (ms >= SLOW_CALL_MS) stats.slowCalls++
      if (stats.calls % PROGRESS_EVERY_CALLS === 0) {
        console.log(formatStats(host, stats))
      }
    }
  }

  return provider
}

export const logRpcStats = () => {
  for (const [host, stats] of statsByHost) {
    console.log(formatStats(host, stats))
  }
}
