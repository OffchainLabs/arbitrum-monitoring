import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { createSlackPoster } from '../createSlackPoster'

vi.mock('../postSlackMessage', () => ({
  postSlackMessage: vi.fn().mockResolvedValue({ ok: true }),
}))

import { postSlackMessage } from '../postSlackMessage'

describe('createSlackPoster', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.TEST_SLACK_TOKEN
    delete process.env.TEST_SLACK_CHANNEL
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('throws when token missing', () => {
    process.env.TEST_SLACK_CHANNEL = 'channel'
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
    })
    expect(() => poster({ message: 'test' })).toThrow('Slack token is required.')
  })

  test('throws when channel missing', () => {
    process.env.TEST_SLACK_TOKEN = 'token'
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
    })
    expect(() => poster({ message: 'test' })).toThrow('Slack channel is required.')
  })

  test('skips posting in DEV mode', () => {
    process.env.TEST_SLACK_TOKEN = 'token'
    process.env.TEST_SLACK_CHANNEL = 'channel'
    process.env.NODE_ENV = 'DEV'

    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
    })

    expect(poster({ message: 'test' })).toBeUndefined()
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('skips posting in CI mode when message is "success"', () => {
    process.env.TEST_SLACK_TOKEN = 'token'
    process.env.TEST_SLACK_CHANNEL = 'channel'
    process.env.NODE_ENV = 'CI'

    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
    })

    expect(poster({ message: 'success' })).toBeUndefined()
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('posts in CI mode when message is not "success"', () => {
    process.env.TEST_SLACK_TOKEN = 'token'
    process.env.TEST_SLACK_CHANNEL = 'channel'
    process.env.NODE_ENV = 'CI'

    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
    })

    poster({ message: 'error' })
    expect(postSlackMessage).toHaveBeenCalledWith({
      slackToken: 'token',
      slackChannel: 'channel',
      message: 'error',
    })
  })

  test('posts with correct params', () => {
    process.env.TEST_SLACK_TOKEN = 'my-token'
    process.env.TEST_SLACK_CHANNEL = 'my-channel'

    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
    })

    poster({ message: 'Hello' })

    expect(postSlackMessage).toHaveBeenCalledWith({
      slackToken: 'my-token',
      slackChannel: 'my-channel',
      message: 'Hello',
    })
  })
})
