import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { createSlackPoster } from '../createSlackPoster'

vi.mock('../postSlackMessage', () => ({
  postSlackMessage: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../postSlackMessageViaWebhook', () => ({
  postSlackMessageViaWebhook: vi.fn().mockResolvedValue({ ok: true }),
}))

import { postSlackMessage } from '../postSlackMessage'
import { postSlackMessageViaWebhook } from '../postSlackMessageViaWebhook'

describe('createSlackPoster', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.TEST_SLACK_TOKEN
    delete process.env.TEST_SLACK_CHANNEL
    delete process.env.TEST_SLACK_WEBHOOK_URL
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

  test('throws with either-or message when webhook is supported but nothing is configured', () => {
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })
    expect(() => poster({ message: 'test' })).toThrow(
      'Slack configuration is required: set TEST_SLACK_WEBHOOK_URL (preferred) or both TEST_SLACK_TOKEN and TEST_SLACK_CHANNEL.'
    )
  })

  test('throws with either-or message when webhook is supported and only token is set', () => {
    process.env.TEST_SLACK_TOKEN = 'token'
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })
    expect(() => poster({ message: 'test' })).toThrow(
      'Slack configuration is required: set TEST_SLACK_WEBHOOK_URL (preferred) or both TEST_SLACK_TOKEN and TEST_SLACK_CHANNEL.'
    )
  })

  test('posts via webhook when only webhook is configured', () => {
    process.env.TEST_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/x'
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })

    poster({ message: 'Hello' })

    expect(postSlackMessageViaWebhook).toHaveBeenCalledWith({
      webhookUrl: 'https://hooks.slack.com/services/x',
      message: 'Hello',
    })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('webhook takes precedence when both webhook and token+channel are configured', () => {
    process.env.TEST_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/x'
    process.env.TEST_SLACK_TOKEN = 'token'
    process.env.TEST_SLACK_CHANNEL = 'channel'
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })

    poster({ message: 'Hello' })

    expect(postSlackMessageViaWebhook).toHaveBeenCalledWith({
      webhookUrl: 'https://hooks.slack.com/services/x',
      message: 'Hello',
    })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('falls back to token+channel when webhook is supported but not set', () => {
    process.env.TEST_SLACK_TOKEN = 'token'
    process.env.TEST_SLACK_CHANNEL = 'channel'
    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })

    poster({ message: 'Hello' })

    expect(postSlackMessage).toHaveBeenCalledWith({
      slackToken: 'token',
      slackChannel: 'channel',
      message: 'Hello',
    })
    expect(postSlackMessageViaWebhook).not.toHaveBeenCalled()
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

  test('skips posting in DEV mode with webhook config', () => {
    process.env.TEST_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/x'
    process.env.NODE_ENV = 'DEV'

    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })

    expect(poster({ message: 'test' })).toBeUndefined()
    expect(postSlackMessageViaWebhook).not.toHaveBeenCalled()
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

  test('skips posting in CI mode when message is "success" with webhook config', () => {
    process.env.TEST_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/x'
    process.env.NODE_ENV = 'CI'

    const poster = createSlackPoster({
      tokenEnvVar: 'TEST_SLACK_TOKEN',
      channelEnvVar: 'TEST_SLACK_CHANNEL',
      webhookUrlEnvVar: 'TEST_SLACK_WEBHOOK_URL',
    })

    expect(poster({ message: 'success' })).toBeUndefined()
    expect(postSlackMessageViaWebhook).not.toHaveBeenCalled()
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
