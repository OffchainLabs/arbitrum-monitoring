import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { StaticJsonRpcProvider, JsonRpcProvider, send } = vi.hoisted(() => {
  const send = vi.fn()
  const StaticJsonRpcProvider = vi.fn(function (this: any, connection: any) {
    this.connection = connection
    this.send = send
  })
  return { StaticJsonRpcProvider, JsonRpcProvider: vi.fn(), send }
})

vi.mock('ethers', async importOriginal => {
  const actual = await importOriginal<typeof import('ethers')>()
  return {
    ...actual,
    providers: { ...actual.providers, StaticJsonRpcProvider, JsonRpcProvider },
  }
})

const URL = 'https://rpc.example.com/v2/secret-key'

const load = async () => {
  vi.resetModules()
  return import('../core/rpcProvider')
}

describe('createRpcProvider', () => {
  let log: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    send.mockResolvedValue('0x1')
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('uses the static provider so the chain id is not re-fetched', async () => {
    const { createRpcProvider } = await load()
    createRpcProvider(URL)

    expect(StaticJsonRpcProvider).toHaveBeenCalledWith(
      expect.objectContaining({ url: URL })
    )
    expect(JsonRpcProvider).not.toHaveBeenCalled()
  })

  test('passes calls through and returns their result', async () => {
    const { createRpcProvider } = await load()
    const provider = createRpcProvider(URL)

    await expect(provider.send('eth_blockNumber', [])).resolves.toBe('0x1')
    expect(send).toHaveBeenCalledWith('eth_blockNumber', [])
  })

  test('counts failed calls and rethrows the error', async () => {
    const { createRpcProvider, logRpcStats } = await load()
    const provider = createRpcProvider(URL)
    send.mockRejectedValueOnce(new Error('boom'))

    await expect(provider.send('eth_call', [])).rejects.toThrow('boom')
    logRpcStats()

    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 calls'))
  })

  test('counts 429s, keeps retrying, and warns only once', async () => {
    const { createRpcProvider, logRpcStats } = await load()
    createRpcProvider(URL)
    const { throttleCallback } = StaticJsonRpcProvider.mock.calls[0][0]

    await expect(throttleCallback(1, URL)).resolves.toBe(true)
    await expect(throttleCallback(2, URL)).resolves.toBe(true)
    logRpcStats()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('2 rate-limited (429)')
    )
  })

  test('tracks average latency and slow calls', async () => {
    const { createRpcProvider, logRpcStats } = await load()
    const provider = createRpcProvider(URL)
    const now = vi.spyOn(Date, 'now')

    now.mockReturnValueOnce(0).mockReturnValueOnce(1_000)
    await provider.send('eth_call', [])
    now.mockReturnValueOnce(0).mockReturnValueOnce(6_000)
    await provider.send('eth_call', [])
    logRpcStats()

    expect(log).toHaveBeenCalledWith(
      '[rpc] rpc.example.com: 2 calls, avg 3500ms, 1 slower than 5s, 0 rate-limited (429)'
    )
  })

  test('logs progress every 1000 calls', async () => {
    const { createRpcProvider } = await load()
    const provider = createRpcProvider(URL)

    for (let i = 0; i < 999; i++) await provider.send('eth_call', [])
    expect(log).not.toHaveBeenCalled()

    await provider.send('eth_call', [])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1000 calls'))
  })

  test('aggregates providers on the same host and never logs the url path', async () => {
    const { createRpcProvider, logRpcStats } = await load()
    await createRpcProvider(URL).send('eth_call', [])
    await createRpcProvider(URL).send('eth_call', [])
    await createRpcProvider('https://other.example.org').send('eth_call', [])
    logRpcStats()

    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('rpc.example.com: 2 calls')
    )
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('other.example.org: 1 calls')
    )
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret-key')
  })
})
