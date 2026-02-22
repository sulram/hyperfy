import {
  despawnManagedAgentSession,
  getManagedAgentSession,
  listManagedAgentSessions,
  speakManagedAgent,
  spawnManagedAgentSession,
  subscribeAgentManagerEvents,
} from '../agents/index.js'

const MAX_CHAT_LENGTH = 500

class TtlDedupe {
  constructor(ttlMs = 120000, maxEntries = 5000) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.map = new Map()
  }

  has(key) {
    this.sweep()
    return this.map.has(key)
  }

  add(key) {
    this.sweep()
    this.map.set(key, Date.now())
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey) this.map.delete(oldestKey)
    }
  }

  sweep() {
    const now = Date.now()
    for (const [key, ts] of this.map) {
      if (now - ts > this.ttlMs) this.map.delete(key)
    }
  }
}

function chunkText(text, maxLen = MAX_CHAT_LENGTH) {
  if (typeof text !== 'string') return []
  const normalized = text.trim()
  if (!normalized) return []
  if (normalized.length <= maxLen) return [normalized]

  const chunks = []
  let remaining = normalized
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf(' ', maxLen)
    if (splitAt < Math.floor(maxLen * 0.6)) splitAt = maxLen
    const piece = remaining.slice(0, splitAt).trim()
    if (piece) chunks.push(piece)
    remaining = remaining.slice(splitAt).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function parseAuthToken(req) {
  const auth = req.headers.authorization
  if (!auth) return ''
  const [scheme, token] = auth.split(' ')
  if (!token) return ''
  if (scheme.toLowerCase() !== 'bearer') return ''
  return token
}

function parseBool(val) {
  if (val == null) return false
  return ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase())
}

function compileRegex(val) {
  const raw = typeof val === 'string' ? val.trim() : ''
  if (!raw) return null
  try {
    return new RegExp(raw, 'i')
  } catch {
    return null
  }
}

function encodeTargetPart(value) {
  return encodeURIComponent(String(value || '').trim())
}

function decodeTargetPart(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch {
    return String(value || '')
  }
}

function buildHyperfyPlayerTarget({ from, fromId }) {
  if (!fromId || !from) return ''
  return `hyperfy:player:${encodeTargetPart(fromId)}:${encodeTargetPart(from)}`
}

function sanitizeSessionKeyPart(value) {
  if (value == null) return ''
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildHyperfyHookSessionKey({ from, fromId }) {
  const idPart = sanitizeSessionKeyPart(fromId)
  const namePart = sanitizeSessionKeyPart(from)
  if (idPart) return `hook:hyperfy:player:${idPart}`
  if (namePart) return `hook:hyperfy:name:${namePart}`
  return 'hook:hyperfy:default'
}

function parseHyperfyPlayerTarget(to) {
  if (typeof to !== 'string') return null
  if (!to.startsWith('hyperfy:player:')) return null
  const rest = to.slice('hyperfy:player:'.length)
  const [idPart, ...nameParts] = rest.split(':')
  if (!idPart) return null
  return {
    playerId: decodeTargetPart(idPart),
    playerName: decodeTargetPart(nameParts.join(':')),
  }
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function loadConfig() {
  const timeoutMs = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS || 15000)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid OPENCLAW_GATEWAY_TIMEOUT_MS: ${process.env.OPENCLAW_GATEWAY_TIMEOUT_MS}`)
  }

  return {
    routePrefix: process.env.OPENCLAW_GATEWAY_PREFIX || '/openclaw-gateway',
    logDebug: parseBool(process.env.OPENCLAW_GATEWAY_DEBUG),
    outboundToken: process.env.OPENCLAW_GATEWAY_OUTBOUND_TOKEN || process.env.BRIDGE_OUTBOUND_TOKEN || '',
    reconnectMinMs: 1000,
    reconnectMaxMs: 15000,
    queueMax: 200,
    hyperfy: {
      agentName: process.env.OPENCLAW_GATEWAY_AGENT_NAME || process.env.HYPERFY_AGENT_NAME || 'OpenClawBot',
      agentAvatar: process.env.OPENCLAW_GATEWAY_AGENT_AVATAR || process.env.HYPERFY_AGENT_AVATAR || undefined,
      maxChatLength: MAX_CHAT_LENGTH,
      tag: 'openclaw-gateway',
    },
    openclaw: {
      hookUrl: required('OPENCLAW_HOOK_URL'),
      agent: required('OPENCLAW_AGENT'),
      bearerToken: process.env.OPENCLAW_HOOK_BEARER_TOKEN || '',
      webhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET || '',
      timeoutMs,
      hookTimeoutSeconds: Number.parseInt(process.env.OPENCLAW_HOOK_TIMEOUT_SECONDS || '', 10) || undefined,
      hookThinking:
        (process.env.OPENCLAW_HOOK_THINKING || '').trim() || undefined,
      hookModel:
        (process.env.OPENCLAW_HOOK_MODEL || '').trim() || undefined,
      hookSessionKeyMode:
        (process.env.OPENCLAW_HOOK_SESSION_KEY_MODE || 'player').trim().toLowerCase(),
      // OpenClaw /hooks/agent accepts "last" for POC routing to the last active channel.
      channelId: process.env.OPENCLAW_GATEWAY_CHANNEL_ID || process.env.HYPERFY_CHANNEL_ID || 'last',
      // For direct channels (e.g. custom Hyperfy channel), hooks also need a delivery target.
      channelTarget:
        process.env.OPENCLAW_GATEWAY_CHANNEL_TARGET ||
        process.env.HYPERFY_CHANNEL_TARGET ||
        'hyperfy:default',
      dynamicPlayerTarget:
        parseBool(process.env.OPENCLAW_GATEWAY_DYNAMIC_PLAYER_TARGET ?? '1') ||
        parseBool(process.env.HYPERFY_DYNAMIC_PLAYER_TARGET),
      approachSpeaker:
        parseBool(process.env.OPENCLAW_GATEWAY_APPROACH_SPEAKER ?? '1') ||
        parseBool(process.env.HYPERFY_APPROACH_SPEAKER),
      approachOnOutbound:
        parseBool(process.env.OPENCLAW_GATEWAY_APPROACH_ON_OUTBOUND ?? '1') ||
        parseBool(process.env.HYPERFY_APPROACH_ON_OUTBOUND),
      channelName: process.env.OPENCLAW_GATEWAY_CHANNEL_NAME || process.env.HYPERFY_CHANNEL_NAME || 'Hyperfy Global',
      ignoreSpeakerRegex:
        compileRegex(process.env.OPENCLAW_GATEWAY_IGNORE_SPEAKER_REGEX) ||
        compileRegex(process.env.HYPERFY_IGNORE_SPEAKER_REGEX) ||
        compileRegex(`^${(process.env.OPENCLAW_GATEWAY_AGENT_NAME || process.env.HYPERFY_AGENT_NAME || 'Lulu').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#|\\b)`),
    },
  }
}

function createLogger(config) {
  return {
    debug(fields, msg) {
      if (!config.logDebug) return
      console.log('[openclaw-gateway]', msg, fields || {})
    },
    info(fields, msg) {
      console.log('[openclaw-gateway]', msg, fields || {})
    },
    warn(fields, msg) {
      console.warn('[openclaw-gateway]', msg, fields || {})
    },
    error(fields, msg) {
      console.error('[openclaw-gateway]', msg, fields || {})
    },
  }
}

async function sendToOpenClaw(config, logger, { from, fromId, body, id, createdAt }) {
  const dynamicTarget =
    config.openclaw.dynamicPlayerTarget && config.openclaw.channelId === 'hyperfy-channel'
      ? buildHyperfyPlayerTarget({ from, fromId })
      : ''
  const deliveryTarget = dynamicTarget || config.openclaw.channelTarget
  const sessionKey =
    config.openclaw.hookSessionKeyMode === 'none'
      ? undefined
      : buildHyperfyHookSessionKey({ from, fromId })
  const payload = {
    message: body,
    name: from || 'Hyperfy',
    agentId: config.openclaw.agent,
    channel: config.openclaw.channelId,
    to: deliveryTarget,
    sessionKey,
    ...(config.openclaw.hookThinking ? { thinking: config.openclaw.hookThinking } : {}),
    ...(config.openclaw.hookModel ? { model: config.openclaw.hookModel } : {}),
    ...(config.openclaw.hookTimeoutSeconds ? { timeoutSeconds: config.openclaw.hookTimeoutSeconds } : {}),
    metadata: {
      source: 'hyperfy',
      channelName: config.openclaw.channelName,
      hyperfy: {
        speaker: {
          id: fromId || null,
          name: from || null,
        },
        message: {
          id: id || null,
          createdAt: createdAt || null,
          bodyPreview: typeof body === 'string' ? body.slice(0, 200) : null,
        },
      },
    },
  }

  const headers = { 'content-type': 'application/json' }
  if (config.openclaw.bearerToken) headers.authorization = `Bearer ${config.openclaw.bearerToken}`
  if (config.openclaw.webhookSecret) headers['x-webhook-secret'] = config.openclaw.webhookSecret

  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), config.openclaw.timeoutMs)
  try {
    const res = await fetch(config.openclaw.hookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    const raw = await res.text()
    if (!res.ok) {
      logger.error({ status: res.status, body: raw }, 'OpenClaw webhook rejected message')
      throw new Error(`OpenClaw webhook error ${res.status}`)
    }
    logger.debug(
      {
        status: res.status,
        sessionKey: sessionKey || null,
        body: raw.slice(0, 200),
      },
      'Forwarded Hyperfy chat to OpenClaw'
    )
    return { ok: true, status: res.status }
  } finally {
    clearTimeout(timeout)
  }
}

export async function openClawGatewayPlugin(fastify) {
  const config = loadConfig()
  const logger = createLogger(config)
  const dedupe = new TtlDedupe()

  const state = {
    agentId: null,
    spawning: false,
    queue: [],
    reconnectTimer: null,
    reconnectDelayMs: config.reconnectMinMs,
    lastSpawnAt: null,
    lastForwardAt: null,
    lastError: null,
    shuttingDown: false,
  }

  const enqueueOutbound = text => {
    if (state.queue.length >= config.queueMax) state.queue.shift()
    state.queue.push(text)
  }

  const findVisiblePlayer = (session, { playerId, playerName }) => {
    if (!session?.agent || session.agent.status !== 'connected') return null
    const players = session.agent.getAllPlayers?.() || []
    if (playerId) {
      const foundById = players.find(p => !p.isLocal && p.id === playerId)
      if (foundById) return foundById
    }
    if (playerName) {
      const lower = playerName.toLowerCase()
      const foundByName = players.find(p => !p.isLocal && p.name?.toLowerCase() === lower)
      if (foundByName) return foundByName
    }
    return null
  }

  const navigateAgentTowardPlayer = ({ playerId, playerName, source }) => {
    if (!state.agentId) return
    const session = getManagedAgentSession(state.agentId)
    if (!session || session.status !== 'connected') return
    const agent = session.agent
    const target = findVisiblePlayer(session, { playerId, playerName })
    if (!target?.position) {
      logger.debug({ source, playerId, playerName }, 'Could not resolve player to approach')
      return
    }
    const getTargetPos = () => {
      const fresh = findVisiblePlayer(getManagedAgentSession(state.agentId), { playerId, playerName })
      return fresh?.position || null
    }
    agent.navigateTo(target.position.x, target.position.z, {
      getTargetPos,
      run: false,
      arrivalRadius: 2.5,
      timeout: 15000,
    }).then(result => {
      logger.debug(
        {
          source,
          playerId,
          playerName,
          arrived: !!result?.arrived,
          distance: result?.distance ?? null,
          error: result?.error ?? null,
        },
        'Speaker approach finished'
      )
    }).catch(err => {
      logger.debug({ source, playerId, playerName, err: err?.message || String(err) }, 'Speaker approach failed')
    })
    logger.debug({ source, playerId, playerName }, 'Approaching speaker')
  }

  const scheduleReconnect = reason => {
    if (state.shuttingDown) return
    if (state.reconnectTimer) return
    const delay = state.reconnectDelayMs
    logger.warn({ reason, delayMs: delay }, 'Scheduling OpenClaw gateway agent reconnect')
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null
      void ensureGatewayAgent(`reconnect:${reason}`)
    }, delay)
    state.reconnectDelayMs = Math.min(Math.round(delay * 1.8), config.reconnectMaxMs)
  }

  const flushQueue = () => {
    if (!state.agentId || state.spawning) return
    const session = getManagedAgentSession(state.agentId)
    if (!session || session.status !== 'connected') return

    let sent = 0
    while (state.queue.length) {
      const text = state.queue[0]
      const result = speakManagedAgent(state.agentId, text)
      if (!result.ok) {
        logger.warn({ code: result.code, error: result.error }, 'Could not flush outbound queue to Hyperfy')
        break
      }
      state.queue.shift()
      sent += 1
    }
    if (sent) logger.info({ chunks: sent, remaining: state.queue.length }, 'Flushed outbound queue to Hyperfy')
  }

  const reconcileGatewayAgents = reason => {
    const all = listManagedAgentSessions()
      .filter(session => session?.tag === config.hyperfy.tag)
      .sort((a, b) => {
        // Prefer connected, then most recently active.
        const aConnected = a.status === 'connected' ? 1 : 0
        const bConnected = b.status === 'connected' ? 1 : 0
        if (aConnected !== bConnected) return bConnected - aConnected
        return (b.lastActivity || 0) - (a.lastActivity || 0)
      })

    if (!all.length) return null

    const primary = all[0]
    if (state.agentId !== primary.id) {
      logger.warn(
        { reason, previousAgentId: state.agentId || null, adoptedAgentId: primary.id, duplicates: all.length - 1 },
        'Adopting existing OpenClaw gateway agent session'
      )
      state.agentId = primary.id
    }

    for (const dup of all.slice(1)) {
      const ok = despawnManagedAgentSession(dup.id, 'duplicate_gateway_tag')
      logger.warn(
        { reason, duplicateAgentId: dup.id, status: dup.status, despawned: ok },
        'Removed duplicate OpenClaw gateway agent session'
      )
    }

    return primary
  }

  const ensureGatewayAgent = async reason => {
    if (state.shuttingDown) return
    if (state.spawning) return

    const reconciled = reconcileGatewayAgents(reason)
    if (reconciled?.status === 'connected') {
      flushQueue()
      return
    }

    if (state.agentId) {
      const existing = getManagedAgentSession(state.agentId)
      if (existing?.status === 'connected') {
        flushQueue()
        return
      }
      if (!existing) state.agentId = null
    }

    state.spawning = true
    try {
      logger.info({ reason, name: config.hyperfy.agentName }, 'Spawning OpenClaw gateway agent')
      const spawned = await spawnManagedAgentSession({
        name: config.hyperfy.agentName,
        avatar: config.hyperfy.agentAvatar,
        tag: config.hyperfy.tag,
        onKick: code => {
          if (state.agentId === spawned.id) state.agentId = null
          state.lastError = `kicked:${code}`
          scheduleReconnect(`kicked:${code}`)
        },
        onDisconnect: () => {
          if (state.agentId === spawned.id) state.agentId = null
          state.lastError = 'disconnected'
          scheduleReconnect('disconnected')
        },
      })
      state.agentId = spawned.id
      state.lastSpawnAt = new Date().toISOString()
      state.lastError = null
      state.reconnectDelayMs = config.reconnectMinMs
      logger.info({ agentId: spawned.id, displayName: spawned.displayName }, 'OpenClaw gateway agent ready')
    } catch (err) {
      state.lastError = err.message
      logger.error({ err: err.message }, 'Failed to spawn OpenClaw gateway agent')
      scheduleReconnect('spawn_failed')
    } finally {
      state.spawning = false
    }
    flushQueue()
  }

  const forwardChatEvent = async event => {
    if (event?.from && config.openclaw.ignoreSpeakerRegex?.test(event.from)) {
      logger.debug({ from: event.from, fromId: event.fromId }, 'Ignoring chat from filtered speaker')
      return
    }
    const key = event.id || `${event.fromId}:${event.createdAt}:${event.body}`
    if (dedupe.has(key)) {
      logger.debug({ key }, 'Skipping duplicate Hyperfy chat event')
      return
    }
    dedupe.add(key)
    try {
      if (config.openclaw.approachSpeaker) {
        navigateAgentTowardPlayer({
          playerId: event.fromId,
          playerName: event.from,
          source: 'inbound_chat',
        })
      }
      await sendToOpenClaw(config, logger, event)
      state.lastForwardAt = new Date().toISOString()
    } catch (err) {
      state.lastError = err.message
      logger.error({ err: err.message, key }, 'Failed to forward Hyperfy chat to OpenClaw')
    }
  }

  const unsubscribe = subscribeAgentManagerEvents(event => {
    if (event.type !== 'chat') return
    if (!state.agentId || event.agentId !== state.agentId) return
    void forwardChatEvent(event)
  })

  fastify.get(`${config.routePrefix}/health`, async () => {
    const agent = state.agentId ? getManagedAgentSession(state.agentId) : null
    return {
      status: 'ok',
      gateway: {
        enabled: true,
        spawning: state.spawning,
        queued: state.queue.length,
        lastSpawnAt: state.lastSpawnAt,
        lastForwardAt: state.lastForwardAt,
        lastError: state.lastError,
      },
      hyperfyAgent: agent,
    }
  })

  fastify.post(`${config.routePrefix}/outbound`, async (req, reply) => {
    if (config.outboundToken) {
      const token = parseAuthToken(req)
      if (token !== config.outboundToken) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }
    }

    const body = req.body || {}
    const payloadKeys =
      body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : []
    logger.info(
      {
        keys: payloadKeys,
        textLength: typeof body.text === 'string' ? body.text.length : 0,
        textPreview: typeof body.text === 'string' ? body.text.slice(0, 200) : null,
        metadata:
          body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata
            : null,
      },
      'Received OpenClaw outbound payload'
    )
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'text is required' })
    }

    if (config.openclaw.approachOnOutbound) {
      const target = parseHyperfyPlayerTarget(body?.metadata?.to)
      if (target) {
        navigateAgentTowardPlayer({
          playerId: target.playerId,
          playerName: target.playerName,
          source: 'outbound_reply',
        })
      }
    }

    const parts = chunkText(text, config.hyperfy.maxChatLength)
    for (const part of parts) enqueueOutbound(part)

    void ensureGatewayAgent('outbound')
    flushQueue()

    return {
      ok: true,
      queued: parts.length,
      queueDepth: state.queue.length,
      truncatedByChunking: parts.length > 1,
    }
  })

  fastify.addHook('onClose', async () => {
    state.shuttingDown = true
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    unsubscribe()
    if (state.agentId) {
      despawnManagedAgentSession(state.agentId, 'server_shutdown')
      state.agentId = null
    }
  })

  setTimeout(() => {
    void ensureGatewayAgent('startup')
  }, 0)

  logger.info({ routePrefix: config.routePrefix }, 'OpenClaw gateway plugin registered')
}
