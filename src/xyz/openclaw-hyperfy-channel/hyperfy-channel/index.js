/**
 * OpenClaw custom channel plugin that routes outbound replies to the Hyperfy bridge.
 *
 * This plugin is intentionally minimal:
 * - registers a real ChannelPlugin (`id: hyperfy-channel`)
 * - exposes outbound.sendText/sendPayload
 * - reads config from api.pluginConfig (plugins.entries.hyperfy-channel.config.*)
 */

const CHANNEL_ID = 'hyperfy-channel'
const DEFAULT_TARGET = 'hyperfy:default'

async function postJson(url, token, payload) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Hyperfy bridge outbound failed: ${res.status} ${text}`)
  }
  return res.json().catch(() => ({ ok: true }))
}

function getString(obj, key) {
  if (!obj || typeof obj !== 'object') return ''
  const value = obj[key]
  return typeof value === 'string' ? value : ''
}

function resolveBridgeSettings(api) {
  const pluginConfig = api?.pluginConfig && typeof api.pluginConfig === 'object' ? api.pluginConfig : {}
  const bridgeUrl =
    getString(pluginConfig, 'bridgeUrl') ||
    getString(pluginConfig, 'url')
  const bridgeToken =
    getString(pluginConfig, 'bridgeToken') ||
    getString(pluginConfig, 'token')
  if (!bridgeUrl) {
    throw new Error('OpenClaw plugin config missing bridgeUrl (set plugins.entries.hyperfy-channel.config.bridgeUrl)')
  }
  return {
    bridgeUrl: bridgeUrl.replace(/\/$/, ''),
    bridgeToken,
  }
}

function extractTextFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.text === 'string') return payload.text
  if (payload.message && typeof payload.message === 'object' && typeof payload.message.text === 'string') {
    return payload.message.text
  }
  if (typeof payload.content === 'string') return payload.content
  if (payload.content && typeof payload.content === 'object' && typeof payload.content.text === 'string') {
    return payload.content.text
  }
  if (payload.channelData && typeof payload.channelData === 'object') {
    if (typeof payload.channelData.text === 'string') return payload.channelData.text
    if (typeof payload.channelData.caption === 'string') return payload.channelData.caption
  }
  if (typeof payload.summary === 'string') return payload.summary
  if (typeof payload.result === 'string') return payload.result
  if (Array.isArray(payload.parts)) {
    const parts = payload.parts
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join('\n')
  }
  return ''
}

function extractHyperfyActionFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.hyperfyAction && typeof payload.hyperfyAction === 'object') return payload.hyperfyAction
  if (payload.channelData && typeof payload.channelData === 'object') {
    const action = payload.channelData.hyperfyAction
    if (action && typeof action === 'object') return action
  }
  if (payload.action && typeof payload.action === 'object' && typeof payload.action.type === 'string') {
    return payload.action
  }
  return null
}

function createHyperfyChannelPlugin(api) {
  const { bridgeUrl, bridgeToken } = resolveBridgeSettings(api)

  const normalizeOutboundCtx = (firstArg, secondArg) => {
    if (typeof firstArg === 'string') {
      return {
        text: firstArg,
        replyToId: secondArg?.replyToId ?? null,
        threadId: secondArg?.threadId ?? null,
        to: DEFAULT_TARGET,
      }
    }
    if (firstArg && typeof firstArg === 'object') {
      return firstArg
    }
    return {}
  }

  const sendOutbound = async ctx => {
    console.log('[hyperfy-channel] outbound send called', {
      hasText: typeof ctx?.text === 'string' && ctx.text.length > 0,
      to: ctx?.to ?? null,
      accountId: ctx?.accountId ?? null,
      replyToId: ctx?.replyToId ?? null,
      threadId: ctx?.threadId ?? null,
      payloadKeys: ctx?.payload && typeof ctx.payload === 'object' ? Object.keys(ctx.payload) : null,
    })
    const hyperfyAction =
      (ctx?.hyperfyAction && typeof ctx.hyperfyAction === 'object' && ctx.hyperfyAction) ||
      extractHyperfyActionFromPayload(ctx?.payload)

    if (hyperfyAction && typeof hyperfyAction.type === 'string' && hyperfyAction.type.trim()) {
      console.log('[hyperfy-channel] outbound action posting', {
        type: hyperfyAction.type,
        to: ctx?.to ?? null,
      })
      const actionResponse = await postJson(`${bridgeUrl}/action`, bridgeToken, {
        action: hyperfyAction,
        metadata: {
          source: 'openclaw',
          channel: CHANNEL_ID,
          to: ctx?.to ?? null,
          accountId: ctx?.accountId ?? null,
          replyToId: ctx?.replyToId ?? null,
          threadId: ctx?.threadId ?? null,
        },
      })
      return {
        channel: CHANNEL_ID,
        messageId: `hyperfy-action-${Date.now()}`,
        meta: {
          bridgeUrl,
          actionType: hyperfyAction.type,
          actionResponse,
        },
      }
    }

    const text = typeof ctx?.text === 'string' && ctx.text.trim()
      ? ctx.text
      : extractTextFromPayload(ctx?.payload)
    if (!text || typeof text !== 'string') {
      console.log('[hyperfy-channel] outbound skipped (no text)', {
        to: ctx?.to ?? null,
        payload: ctx?.payload ?? null,
      })
      return {
        channel: CHANNEL_ID,
        messageId: `hyperfy-skip-${Date.now()}`,
      }
    }

    console.log('[hyperfy-channel] outbound posting', {
      to: ctx?.to ?? null,
      textPreview: text.slice(0, 200),
      textLength: text.length,
    })
    await postJson(`${bridgeUrl}/outbound`, bridgeToken, {
      text,
      metadata: {
        source: 'openclaw',
        channel: CHANNEL_ID,
        to: ctx?.to ?? null,
        accountId: ctx?.accountId ?? null,
        replyToId: ctx?.replyToId ?? null,
        threadId: ctx?.threadId ?? null,
      },
    })

    return {
      channel: CHANNEL_ID,
      messageId: `hyperfy-${Date.now()}`,
      meta: {
        bridgeUrl,
      },
    }
  }

  const sendMedia = async ctx => {
    const caption = typeof ctx?.text === 'string' ? ctx.text.trim() : ''
    const mediaUrl = typeof ctx?.mediaUrl === 'string' ? ctx.mediaUrl.trim() : ''
    const text = [caption, mediaUrl].filter(Boolean).join('\n').trim()
    return sendOutbound({
      ...ctx,
      text: text || '[media]',
    })
  }

  return {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: 'Hyperfy',
      selectionLabel: 'Hyperfy (Bridge)',
      detailLabel: 'Hyperfy Bridge',
      docsPath: '/channels/hyperfy',
      docsLabel: 'hyperfy',
      blurb: 'Custom bridge channel that posts replies to the Hyperfy embedded gateway.',
      aliases: ['hyperfy'],
    },
    capabilities: {
      chatTypes: ['direct'],
      reactions: false,
      threads: false,
      media: false,
      nativeCommands: false,
    },
    config: {
      listAccountIds: () => [],
      resolveAccount: () => ({
        bridgeUrl,
        configured: true,
      }),
      resolveDefaultTo: () => DEFAULT_TARGET,
      isConfigured: () => true,
      describeAccount: () => ({
        accountId: 'default',
        name: 'Hyperfy Bridge',
        enabled: true,
        configured: true,
      }),
    },
    outbound: {
      deliveryMode: 'direct',
      resolveTarget: ({ to }) => ({ ok: true, to: (typeof to === 'string' && to.trim()) || DEFAULT_TARGET }),
      sendText: async (textOrCtx, overrides) => sendOutbound(normalizeOutboundCtx(textOrCtx, overrides)),
      sendPayload: async (payloadOrCtx, overrides) => {
        if (payloadOrCtx && typeof payloadOrCtx === 'object' && 'payload' in payloadOrCtx) {
          return sendOutbound(payloadOrCtx)
        }
        return sendOutbound(normalizeOutboundCtx({ payload: payloadOrCtx, ...(overrides || {}) }))
      },
      sendMedia,
    },
  }
}

const plugin = {
  id: 'hyperfy-channel',
  name: 'Hyperfy Channel',
  description: 'OpenClaw custom channel adapter for Hyperfy bridge',
  version: '0.1.0',
  register(api) {
    api.registerChannel({ plugin: createHyperfyChannelPlugin(api) })
  },
}

export function createHyperfyChannelPluginDefinition() {
  return plugin
}

export default plugin
