import {
  despawnManagedAgentSession,
  getManagedAgentRuntime,
  getManagedAgentSession,
  listManagedAgentSessions,
  speakManagedAgent,
  spawnManagedAgentSession,
  subscribeAgentManagerEvents,
} from '../agents/index.js'
import { uuid } from '../../core/utils.js'

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

function parsePositiveNumber(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

function parseIntegerMin(value, fallback, min = 0) {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, n)
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function roundArray3(arr) {
  if (!Array.isArray(arr)) return null
  return arr.map(v => round3(Number(v) || 0))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function formatPosForContext(pos) {
  if (!pos || typeof pos !== 'object') return null
  const x = Number(pos.x)
  const y = Number(pos.y)
  const z = Number(pos.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return `x=${round3(x)}, y=${round3(y)}, z=${round3(z)}`
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
      idleWander: {
        enabled:
          parseBool(process.env.OPENCLAW_GATEWAY_IDLE_WANDER) ||
          parseBool(process.env.HYPERFY_IDLE_WANDER),
        afterMs: Math.max(0, Number(process.env.OPENCLAW_GATEWAY_IDLE_AFTER_MS || process.env.HYPERFY_IDLE_AFTER_MS || 30000) || 30000),
        intervalMs: Math.max(1000, Number(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_INTERVAL_MS || process.env.HYPERFY_IDLE_WANDER_INTERVAL_MS || 20000) || 20000),
        jitterMs: Math.max(0, Number(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_JITTER_MS || process.env.HYPERFY_IDLE_WANDER_JITTER_MS || 12000) || 12000),
        minRadius: Math.max(0.5, Number(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_MIN_RADIUS || process.env.HYPERFY_IDLE_WANDER_MIN_RADIUS || 2) || 2),
        maxRadius: Math.max(1, Number(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_MAX_RADIUS || process.env.HYPERFY_IDLE_WANDER_MAX_RADIUS || 6) || 6),
        arrivalRadius: Math.max(0.5, Number(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_ARRIVAL_RADIUS || process.env.HYPERFY_IDLE_WANDER_ARRIVAL_RADIUS || 2.5) || 2.5),
        timeoutMs: Math.max(1000, Number(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_TIMEOUT_MS || process.env.HYPERFY_IDLE_WANDER_TIMEOUT_MS || 12000) || 12000),
        run:
          parseBool(process.env.OPENCLAW_GATEWAY_IDLE_WANDER_RUN) ||
          parseBool(process.env.HYPERFY_IDLE_WANDER_RUN),
      },
    },
    build: {
      enabled: true,
      maxCubes: parseIntegerMin(process.env.OPENCLAW_GATEWAY_BUILD_MAX_CUBES, 256, 1),
      maxStackHeight: 4,
      voxelSize: 1,
      gridOrigin: {
        x: 0,
        y: 0,
        z: 0,
      },
      defaultCollectionId: 'default',
      defaultCubeBlueprintName: 'Model',
      protectPinned: true,
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

async function sendToOpenClaw(config, logger, { from, fromId, body, id, createdAt, speakerPosition, gatewayAgentPosition, speakerDistance }) {
  const dynamicTarget =
    config.openclaw.dynamicPlayerTarget && config.openclaw.channelId === 'hyperfy-channel'
      ? buildHyperfyPlayerTarget({ from, fromId })
      : ''
  const deliveryTarget = dynamicTarget || config.openclaw.channelTarget
  const sessionKey =
    config.openclaw.hookSessionKeyMode === 'none'
      ? undefined
      : buildHyperfyHookSessionKey({ from, fromId })
  const contextParts = []
  const speakerPosText = formatPosForContext(speakerPosition)
  const gatewayPosText = formatPosForContext(gatewayAgentPosition)
  if (speakerPosText) contextParts.push(`speaker_position(${speakerPosText})`)
  if (gatewayPosText) contextParts.push(`gateway_bot_position(${gatewayPosText})`)
  if (Number.isFinite(speakerDistance)) contextParts.push(`speaker_distance=${round3(speakerDistance)}`)
  const inboundMessage =
    contextParts.length && typeof body === 'string'
      ? `[HyperfyContext ${contextParts.join('; ')}]\n${body}`
      : body
  const payload = {
    message: inboundMessage,
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
          position: speakerPosition || null,
          distanceToGatewayAgent: Number.isFinite(speakerDistance) ? round3(speakerDistance) : null,
        },
        gatewayAgent: {
          position: gatewayAgentPosition || null,
        },
        message: {
          id: id || null,
          createdAt: createdAt || null,
          bodyPreview: typeof body === 'string' ? body.slice(0, 200) : null,
          enrichedWithContext: contextParts.length > 0,
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

function getBuildCatalog(world, config) {
  if (!world?.collections?.get) return []
  const coll = world.collections.get(config.build.defaultCollectionId)
  if (!coll?.blueprints || !Array.isArray(coll.blueprints)) return []

  const defaultCubeBlueprint =
    coll.blueprints.find(bp => bp?.name === config.build.defaultCubeBlueprintName) || null

  const catalog = []
  if (defaultCubeBlueprint) {
    catalog.push({
      id: 'default-cube',
      label: 'Default Cube',
      source: {
        collectionId: coll.id,
        blueprintId: defaultCubeBlueprint.id,
        blueprintName: defaultCubeBlueprint.name,
      },
      voxel: {
        size: [config.build.voxelSize, config.build.voxelSize, config.build.voxelSize],
        stackable: true,
        maxStackHeight: config.build.maxStackHeight,
      },
      blueprintSignature: {
        model: defaultCubeBlueprint.model || null,
        script: defaultCubeBlueprint.script || null,
      },
    })
  }
  return catalog
}

function voxelKey(grid) {
  return `${grid.x}:${grid.y}:${grid.z}`
}

function columnKey(grid) {
  return `${grid.x}:${grid.z}`
}

function worldToGrid(position, config) {
  const { voxelSize, gridOrigin } = config.build
  return {
    x: Math.round((position.x - gridOrigin.x) / voxelSize),
    y: Math.round((position.y - gridOrigin.y) / voxelSize),
    z: Math.round((position.z - gridOrigin.z) / voxelSize),
  }
}

function gridToWorldPosition(grid, config) {
  const { voxelSize, gridOrigin } = config.build
  return {
    x: round3(gridOrigin.x + grid.x * voxelSize),
    y: round3(gridOrigin.y + grid.y * voxelSize),
    z: round3(gridOrigin.z + grid.z * voxelSize),
  }
}

function sameSignature(blueprint, signature) {
  if (!blueprint || !signature) return false
  if (signature.model && blueprint.model !== signature.model) return false
  if (signature.script && blueprint.script !== signature.script) return false
  return true
}

function getCanonicalDefaultCubeBlueprint(world, config) {
  const catalog = getBuildCatalog(world, config)
  const entry = catalog.find(item => item.id === 'default-cube')
  if (!entry) return null
  const coll = world?.collections?.get?.(entry.source.collectionId)
  if (!coll?.blueprints) return null
  return coll.blueprints.find(bp => bp?.id === entry.source.blueprintId) || null
}

function collectBuildSnapshot(world, config) {
  const catalog = getBuildCatalog(world, config)
  const defaultCubeCatalog = catalog.find(item => item.id === 'default-cube') || null
  const defaultCubeSignature = defaultCubeCatalog?.blueprintSignature || null
  const cubes = []
  const occupied = new Map()
  const columnCounts = new Map()

  if (!world?.entities?.items || !world?.blueprints?.get) {
    return {
      catalog,
      cubes,
      occupied,
      columnCounts,
      evictionCandidates: [],
      limits: {
        maxCubes: config.build.maxCubes,
        currentCubes: 0,
        remaining: config.build.maxCubes,
      },
    }
  }

  for (const [entityId, entity] of world.entities.items) {
    if (!entity?.isApp) continue
    const data = entity.data || {}
    const blueprint = world.blueprints.get(data.blueprint)
    if (!blueprint) continue
    if (!defaultCubeSignature || !sameSignature(blueprint, defaultCubeSignature)) continue

    const posArr = Array.isArray(data.position) ? data.position : [0, 0, 0]
    const position = {
      x: round3(Number(posArr[0]) || 0),
      y: round3(Number(posArr[1]) || 0),
      z: round3(Number(posArr[2]) || 0),
    }
    const grid = worldToGrid(position, config)
    const cube = {
      entityId,
      assetClassId: 'default-cube',
      blueprintId: blueprint.id,
      blueprintName: blueprint.name || null,
      position,
      grid,
      quaternion: roundArray3(data.quaternion) || [0, 0, 0, 1],
      scale: roundArray3(data.scale) || [1, 1, 1],
      pinned: !!data.pinned,
      mover: data.mover || null,
      uploader: data.uploader || null,
      createdAt: data.createdAt || null,
    }
    cubes.push(cube)
    occupied.set(voxelKey(grid), cube)
    columnCounts.set(columnKey(grid), (columnCounts.get(columnKey(grid)) || 0) + 1)
  }

  cubes.sort((a, b) => {
    if (a.grid.x !== b.grid.x) return a.grid.x - b.grid.x
    if (a.grid.z !== b.grid.z) return a.grid.z - b.grid.z
    if (a.grid.y !== b.grid.y) return a.grid.y - b.grid.y
    return a.entityId.localeCompare(b.entityId)
  })

  const evictionCandidates = cubes
    .filter(cube => !(config.build.protectPinned && cube.pinned))
    .map(cube => ({
      entityId: cube.entityId,
      assetClassId: cube.assetClassId,
      grid: cube.grid,
      position: cube.position,
      pinned: cube.pinned,
    }))

  return {
    catalog,
    cubes,
    occupied,
    columnCounts,
    evictionCandidates,
    limits: {
      maxCubes: config.build.maxCubes,
      currentCubes: cubes.length,
      remaining: Math.max(0, config.build.maxCubes - cubes.length),
    },
  }
}

function ensureBlueprintPublished(world, blueprint) {
  if (!world?.blueprints?.get || !world?.blueprints?.add) {
    throw new Error('World blueprints API unavailable')
  }
  const existing = world.blueprints.get(blueprint.id)
  if (existing) return existing
  const clone = cloneJson(blueprint)
  world.blueprints.add(clone)
  world.network?.send?.('blueprintAdded', clone)
  if (world.network?.dirtyBlueprints) {
    world.network.dirtyBlueprints.add(clone.id)
  }
  return clone
}

function addAppEntity(world, data) {
  const entity = world.entities.add(data)
  world.network?.send?.('entityAdded', data)
  if (world.network?.dirtyApps) {
    world.network.dirtyApps.add(data.id)
  }
  return entity
}

function modifyAppEntity(world, entityId, patch) {
  const entity = world?.entities?.get?.(entityId)
  if (!entity) return false
  entity.modify(patch)
  world.network?.send?.('entityModified', { id: entityId, ...patch })
  if (world.network?.dirtyApps) {
    world.network.dirtyApps.add(entityId)
  }
  return true
}

function removeAppEntity(world, entityId) {
  const entity = world?.entities?.get?.(entityId)
  if (!entity) return false
  world.entities.remove(entityId)
  world.network?.send?.('entityRemoved', entityId)
  if (world.network?.dirtyApps) {
    world.network.dirtyApps.add(entityId)
  }
  return true
}

function computeCarryPose(agentPos, agentYaw, carryConfig = {}) {
  const forward = Number.isFinite(carryConfig.forward) ? carryConfig.forward : 1.1
  const right = Number.isFinite(carryConfig.right) ? carryConfig.right : 0
  const up = Number.isFinite(carryConfig.up) ? carryConfig.up : 1.0
  const yaw = Number.isFinite(agentYaw) ? agentYaw : 0
  // Hyperfy yaw 0 tends to face -Z, so forward is -sin(yaw), -cos(yaw)
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  const rx = Math.cos(yaw)
  const rz = -Math.sin(yaw)
  return {
    x: round3(agentPos.x + fx * forward + rx * right),
    y: round3(agentPos.y + up),
    z: round3(agentPos.z + fz * forward + rz * right),
  }
}

function distanceSq3(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0)
  const dy = (a?.y || 0) - (b?.y || 0)
  const dz = (a?.z || 0) - (b?.z || 0)
  return dx * dx + dy * dy + dz * dz
}

export async function openClawGatewayPlugin(fastify, opts = {}) {
  const config = loadConfig()
  const logger = createLogger(config)
  const dedupe = new TtlDedupe()
  const world = opts?.world || null

  const state = {
    agentId: null,
    spawning: false,
    queue: [],
    reconnectTimer: null,
    reconnectDelayMs: config.reconnectMinMs,
    lastSpawnAt: null,
    lastForwardAt: null,
    lastError: null,
    lastInteractionAt: Date.now(),
    idleWanderTimer: null,
    idleWanderInFlight: false,
    buildMutationInFlight: false,
    autoRepositionInFlight: false,
    carry: null,
    shuttingDown: false,
  }

  const enqueueOutbound = text => {
    if (state.queue.length >= config.queueMax) state.queue.shift()
    state.queue.push(text)
  }

  const markInteraction = source => {
    state.lastInteractionAt = Date.now()
    logger.debug({ source, at: state.lastInteractionAt }, 'Gateway interaction activity')
  }

  const findVisiblePlayer = (runtimeSession, { playerId, playerName }) => {
    if (!runtimeSession?.agent || runtimeSession.agent.status !== 'connected') return null
    const players = runtimeSession.agent.getAllPlayers?.() || []
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
    if (state.autoRepositionInFlight) return
    if (!state.agentId) return
    const runtime = getManagedAgentRuntime(state.agentId)
    if (!runtime || runtime.agent.status !== 'connected') return
    const agent = runtime.agent
    const target = findVisiblePlayer(runtime, { playerId, playerName })
    if (!target?.position) {
      logger.debug({ source, playerId, playerName }, 'Could not resolve player to approach')
      return
    }
    const getTargetPos = () => {
      const fresh = findVisiblePlayer(getManagedAgentRuntime(state.agentId), { playerId, playerName })
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

  const randomBetween = (min, max) => {
    if (max <= min) return min
    return min + Math.random() * (max - min)
  }

  const scheduleIdleWander = reason => {
    if (!config.hyperfy.idleWander.enabled) return
    if (state.shuttingDown) return
    if (state.idleWanderTimer) return
    const delay = config.hyperfy.idleWander.intervalMs + Math.round(Math.random() * config.hyperfy.idleWander.jitterMs)
    state.idleWanderTimer = setTimeout(() => {
      state.idleWanderTimer = null
      void maybeIdleWander(`timer:${reason}`)
    }, delay)
  }

  const maybeIdleWander = async reason => {
    try {
      if (!config.hyperfy.idleWander.enabled) return
      if (state.shuttingDown || state.spawning || state.reconnectTimer) return
      if (state.autoRepositionInFlight || state.carry) return
      if (!state.agentId || state.idleWanderInFlight) return
      if (state.queue.length) return

      const idleForMs = Date.now() - state.lastInteractionAt
      if (idleForMs < config.hyperfy.idleWander.afterMs) {
        logger.debug({ reason, idleForMs }, 'Skipping idle wander; idle threshold not reached')
        return
      }

      const runtime = getManagedAgentRuntime(state.agentId)
      if (!runtime || runtime.agent.status !== 'connected') return
      const agent = runtime.agent
      const pos = agent.getPosition?.()
      if (!pos) return

      const minR = Math.min(config.hyperfy.idleWander.minRadius, config.hyperfy.idleWander.maxRadius)
      const maxR = Math.max(config.hyperfy.idleWander.minRadius, config.hyperfy.idleWander.maxRadius)
      const radius = randomBetween(minR, maxR)
      const angle = Math.random() * Math.PI * 2
      const x = pos.x + Math.cos(angle) * radius
      const z = pos.z + Math.sin(angle) * radius

      state.idleWanderInFlight = true
      logger.debug({ reason, from: pos, x, z, radius, idleForMs }, 'Starting idle wander')
      const result = await agent.navigateTo(x, z, {
        run: !!config.hyperfy.idleWander.run,
        arrivalRadius: config.hyperfy.idleWander.arrivalRadius,
        timeout: config.hyperfy.idleWander.timeoutMs,
      })
      logger.debug(
        {
          reason,
          arrived: !!result?.arrived,
          distance: result?.distance ?? null,
          error: result?.error ?? null,
        },
        'Idle wander finished'
      )
    } catch (err) {
      logger.debug({ reason, err: err?.message || String(err) }, 'Idle wander failed')
    } finally {
      state.idleWanderInFlight = false
      scheduleIdleWander('post_idle_wander')
    }
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
    if (sent) {
      logger.info({ chunks: sent, remaining: state.queue.length }, 'Flushed outbound queue to Hyperfy')
      markInteraction('flush_queue')
    }
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
      scheduleIdleWander('ensure_existing_connected')
      return
    }

    if (state.agentId) {
      const existing = getManagedAgentSession(state.agentId)
      if (existing?.status === 'connected') {
        flushQueue()
        scheduleIdleWander('ensure_current_connected')
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
      markInteraction('spawn_ready')
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
    scheduleIdleWander('ensure_done')
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
      markInteraction('inbound_chat')
      let speakerPosition = null
      let gatewayAgentPosition = null
      let speakerDistance = null
      if (state.agentId) {
        const runtime = getManagedAgentRuntime(state.agentId)
        if (runtime?.agent?.status === 'connected') {
          gatewayAgentPosition = runtime.agent.getPosition?.() || null
          const speaker = findVisiblePlayer(runtime, {
            playerId: event.fromId,
            playerName: event.from,
          })
          if (speaker?.position) {
            speakerPosition = speaker.position
            if (gatewayAgentPosition) {
              const dx = speaker.position.x - gatewayAgentPosition.x
              const dy = speaker.position.y - gatewayAgentPosition.y
              const dz = speaker.position.z - gatewayAgentPosition.z
              speakerDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)
            }
          }
        }
      }
      if (config.openclaw.approachSpeaker) {
        navigateAgentTowardPlayer({
          playerId: event.fromId,
          playerName: event.from,
          source: 'inbound_chat',
        })
      }
      await sendToOpenClaw(config, logger, {
        ...event,
        speakerPosition,
        gatewayAgentPosition,
        speakerDistance,
      })
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

  const requireOutboundAuth = (req, reply) => {
    if (!config.outboundToken) return true
    const token = parseAuthToken(req)
    if (token === config.outboundToken) return true
    reply.code(401).send({ error: 'UNAUTHORIZED' })
    return false
  }

  const requireBuildEnabled = reply => {
    if (config.build.enabled) return true
    reply.code(404).send({ error: 'BUILD_DISABLED' })
    return false
  }

  const requireBuildWorld = reply => {
    if (world?.entities && world?.blueprints && world?.collections) return true
    reply.code(503).send({ error: 'WORLD_UNAVAILABLE', message: 'Gateway build API requires server world context' })
    return false
  }

  const runBuildMutation = async (reply, fn) => {
    if (state.buildMutationInFlight || state.autoRepositionInFlight) {
      return reply.code(409).send({ error: 'BUILD_BUSY', message: 'Another build mutation is in progress' })
    }
    state.buildMutationInFlight = true
    try {
      return await fn()
    } finally {
      state.buildMutationInFlight = false
    }
  }

  const getGatewayAgentPose = () => {
    if (!state.agentId) return null
    const runtime = getManagedAgentRuntime(state.agentId)
    if (!runtime?.agent || runtime.agent.status !== 'connected') return null
    const position = runtime.agent.getPosition?.()
    if (!position) return null
    const yaw = runtime.agent.getYaw?.()
    return { position, yaw: Number.isFinite(yaw) ? yaw : 0, runtime }
  }

  const findNearestCubeToGatewayAgent = snapshot => {
    const pose = getGatewayAgentPose()
    if (!pose?.position) return null
    let best = null
    let bestD2 = Infinity
    for (const cube of snapshot?.cubes || []) {
      if (config.build.protectPinned && cube.pinned) continue
      const d2 = distanceSq3(cube.position, pose.position)
      if (d2 < bestD2) {
        bestD2 = d2
        best = cube
      }
    }
    return best
  }

  const stopCarryInternal = ({ snapToGrid = true, targetGrid = null } = {}) => {
    const carry = state.carry
    if (!carry) return { ok: true, carry: null, stopped: false }
    if (carry.timer) {
      clearInterval(carry.timer)
      carry.timer = null
    }

    const entity = world?.entities?.get?.(carry.entityId)
    if (!entity?.isApp) {
      state.carry = null
      return { ok: true, carry: null, stopped: true, missingEntity: true }
    }

    const currentPosArr = Array.isArray(entity.data?.position) ? entity.data.position : [0, 0, 0]
    const currentPos = {
      x: Number(currentPosArr[0]) || 0,
      y: Number(currentPosArr[1]) || 0,
      z: Number(currentPosArr[2]) || 0,
    }

    let patch
    if (snapToGrid) {
      const dropGrid =
        targetGrid &&
        Number.isInteger(targetGrid.x) &&
        Number.isInteger(targetGrid.y) &&
        Number.isInteger(targetGrid.z)
          ? targetGrid
          : worldToGrid(currentPos, config)
      const snapshot = collectBuildSnapshot(world, config)
      const occupied = snapshot.occupied.get(voxelKey(dropGrid))
      if (occupied && occupied.entityId !== carry.entityId) {
        // Keep the cube carried (mover=true) if target voxel is blocked.
        state.carry = carry
        carry.timer = setInterval(carry.tick, carry.intervalMs)
        return {
          ok: false,
          error: 'VOXEL_OCCUPIED',
          message: 'Cannot drop carried cube; target voxel is occupied',
          targetGrid: dropGrid,
          existing: occupied,
        }
      }
      const sourceGrid = worldToGrid(carry.lastPosition || currentPos, config)
      const targetColumn = columnKey(dropGrid)
      const sourceColumn = columnKey(sourceGrid)
      const targetColumnCount = snapshot.columnCounts.get(targetColumn) || 0
      const projectedTargetCount = sourceColumn === targetColumn ? targetColumnCount : targetColumnCount + 1
      if (projectedTargetCount > config.build.maxStackHeight) {
        state.carry = carry
        carry.timer = setInterval(carry.tick, carry.intervalMs)
        return {
          ok: false,
          error: 'MAX_STACK_HEIGHT_REACHED',
          message: `Cannot drop carried cube; target column exceeds max stack height (${config.build.maxStackHeight})`,
          targetGrid: dropGrid,
        }
      }
      const snapped = gridToWorldPosition(dropGrid, config)
      patch = {
        mover: null,
        position: [snapped.x, snapped.y, snapped.z],
        quaternion: [0, 0, 0, 1],
        state: {},
      }
    } else {
      patch = { mover: null }
    }

    modifyAppEntity(world, carry.entityId, patch)
    const result = {
      ok: true,
      stopped: true,
      entityId: carry.entityId,
      snapToGrid,
    }
    if (patch.position) {
      const p = patch.position
      result.position = { x: p[0], y: p[1], z: p[2] }
      result.grid = worldToGrid(result.position, config)
    }
    state.carry = null
    return result
  }

  const startCarryInternal = ({ cube, offset }) => {
    if (!cube) {
      return { ok: false, error: 'NOT_FOUND', message: 'Cube not found' }
    }
    if (config.build.protectPinned && cube.pinned) {
      return { ok: false, error: 'PINNED', message: 'Pinned cubes are protected' }
    }
    if (!state.agentId) {
      return { ok: false, error: 'AGENT_REQUIRED', message: 'Gateway agent is not available yet' }
    }
    const pose = getGatewayAgentPose()
    if (!pose) {
      return { ok: false, error: 'AGENT_NOT_READY', message: 'Gateway agent position is not available' }
    }

    if (state.carry?.entityId && state.carry.entityId !== cube.entityId) {
      const stopRes = stopCarryInternal({ snapToGrid: true })
      if (!stopRes.ok) return stopRes
    }
    if (state.carry?.entityId === cube.entityId) {
      return { ok: true, carry: state.carry, alreadyCarrying: true }
    }

    const intervalMs = 150
    const moverToken = `carry:${state.agentId}`
    const carry = {
      entityId: cube.entityId,
      moverToken,
      offset: {
        forward: Number.isFinite(offset?.forward) ? offset.forward : 1.1,
        right: Number.isFinite(offset?.right) ? offset.right : 0,
        up: Number.isFinite(offset?.up) ? offset.up : 1.0,
      },
      intervalMs,
      timer: null,
      lastPosition: cube.position ? { ...cube.position } : null,
      tick: null,
    }

    carry.tick = () => {
      if (state.buildMutationInFlight) return
      if (!state.carry || state.carry.entityId !== carry.entityId) return
      const liveEntity = world?.entities?.get?.(carry.entityId)
      if (!liveEntity?.isApp) {
        void stopCarryInternal({ snapToGrid: false })
        return
      }
      const livePose = getGatewayAgentPose()
      if (!livePose?.position) return
      const target = computeCarryPose(livePose.position, livePose.yaw, carry.offset)
      carry.lastPosition = target
      modifyAppEntity(world, carry.entityId, {
        mover: moverToken,
        position: [target.x, target.y, target.z],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      })
    }

    state.carry = carry
    modifyAppEntity(world, carry.entityId, { mover: moverToken })
    carry.tick()
    carry.timer = setInterval(carry.tick, intervalMs)
    return {
      ok: true,
      carry: {
        entityId: carry.entityId,
        moverToken: carry.moverToken,
        offset: carry.offset,
        intervalMs,
      },
    }
  }

  const getCarryStatus = () => {
    const carry = state.carry
    if (!carry) return null
    const entity = world?.entities?.get?.(carry.entityId)
    const posArr = Array.isArray(entity?.data?.position) ? entity.data.position : null
    return {
      entityId: carry.entityId,
      moverToken: carry.moverToken,
      offset: carry.offset,
      intervalMs: carry.intervalMs,
      position: posArr ? { x: round3(posArr[0]), y: round3(posArr[1]), z: round3(posArr[2]) } : null,
    }
  }

  const collectPlayersForPerception = () => {
    if (!world?.entities?.players) return []
    const managedByPlayerId = new Map()
    for (const s of listManagedAgentSessions()) {
      if (!s?.playerId) continue
      managedByPlayerId.set(s.playerId, s)
    }

    const players = []
    for (const [playerId, playerEntity] of world.entities.players) {
      const data = playerEntity?.data || {}
      const posArr = Array.isArray(data.position) ? data.position : [0, 0, 0]
      const position = {
        x: round3(Number(posArr[0]) || 0),
        y: round3(Number(posArr[1]) || 0),
        z: round3(Number(posArr[2]) || 0),
      }
      const managed = managedByPlayerId.get(playerId) || null
      const name = managed?.displayName || data.name || managed?.name || `Player:${playerId.slice?.(0, 6) || playerId}`
      players.push({
        id: playerId,
        name,
        position,
        grid: worldToGrid(position, config),
        isManagedAgent: !!managed,
        isGatewayAgent: !!managed && !!state.agentId && managed.id === state.agentId,
      })
    }

    players.sort((a, b) => {
      const aGateway = a.isGatewayAgent ? 1 : 0
      const bGateway = b.isGatewayAgent ? 1 : 0
      if (aGateway !== bGateway) return bGateway - aGateway
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    return players
  }

  fastify.get(`${config.routePrefix}/health`, async () => {
    const agent = state.agentId ? getManagedAgentSession(state.agentId) : null
    const buildSnapshot = config.build.enabled && world ? collectBuildSnapshot(world, config) : null
    return {
      status: 'ok',
      gateway: {
        enabled: true,
        spawning: state.spawning,
        queued: state.queue.length,
        lastSpawnAt: state.lastSpawnAt,
        lastForwardAt: state.lastForwardAt,
        lastError: state.lastError,
        lastInteractionAt: new Date(state.lastInteractionAt).toISOString(),
        idleWanderEnabled: !!config.hyperfy.idleWander.enabled,
        idleWanderInFlight: !!state.idleWanderInFlight,
      },
      build: buildSnapshot
        ? {
            enabled: true,
            maxCubes: buildSnapshot.limits.maxCubes,
            currentCubes: buildSnapshot.limits.currentCubes,
            remaining: buildSnapshot.limits.remaining,
            catalogSize: buildSnapshot.catalog.length,
            carry: getCarryStatus(),
            autoRepositionInFlight: !!state.autoRepositionInFlight,
          }
        : { enabled: !!config.build.enabled },
      hyperfyAgent: agent,
    }
  })

  fastify.get(`${config.routePrefix}/build/catalog`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    const catalog = getBuildCatalog(world, config)
    return {
      ok: true,
      catalog,
      limits: {
        maxCubes: config.build.maxCubes,
        maxStackHeight: config.build.maxStackHeight,
      },
      grid: {
        voxelSize: config.build.voxelSize,
        origin: config.build.gridOrigin,
      },
    }
  })

  fastify.get(`${config.routePrefix}/build/snapshot`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    const snapshot = collectBuildSnapshot(world, config)
    return {
      ok: true,
      catalog: snapshot.catalog,
      limits: snapshot.limits,
      grid: {
        voxelSize: config.build.voxelSize,
        origin: config.build.gridOrigin,
      },
      cubes: snapshot.cubes,
      evictionCandidates: snapshot.evictionCandidates,
    }
  })

  fastify.get(`${config.routePrefix}/build/perception`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    const snapshot = collectBuildSnapshot(world, config)
    const players = collectPlayersForPerception()
    return {
      ok: true,
      grid: {
        voxelSize: config.build.voxelSize,
        origin: config.build.gridOrigin,
        maxStackHeight: config.build.maxStackHeight,
      },
      limits: snapshot.limits,
      catalog: snapshot.catalog.map(item => ({
        id: item.id,
        voxel: item.voxel,
      })),
      voxels: snapshot.cubes.map(cube => ({
        x: cube.grid.x,
        y: cube.grid.y,
        z: cube.grid.z,
        assetClassId: cube.assetClassId,
      })),
      players,
      carrying: !!state.carry,
    }
  })

  fastify.get(`${config.routePrefix}/build/carry/status`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    return {
      ok: true,
      carrying: !!state.carry,
      carry: getCarryStatus(),
    }
  })

  fastify.post(`${config.routePrefix}/build/carry/start`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    return runBuildMutation(reply, async () => {
      const body = req.body || {}
      const snapshot = collectBuildSnapshot(world, config)

      let cube = null
      if (typeof body.entityId === 'string' && body.entityId.trim()) {
        cube = snapshot.cubes.find(c => c.entityId === body.entityId) || null
      } else if (body.grid && typeof body.grid === 'object') {
        const grid = {
          x: Number.parseInt(body.grid.x, 10),
          y: Number.parseInt(body.grid.y, 10),
          z: Number.parseInt(body.grid.z, 10),
        }
        if (![grid.x, grid.y, grid.z].every(Number.isInteger)) {
          return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'grid requires integer x,y,z' })
        }
        cube = snapshot.occupied.get(voxelKey(grid)) || null
      } else {
        cube = findNearestCubeToGatewayAgent(snapshot)
        if (!cube) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'No cube found to carry (agent may be unavailable or no cubes exist)' })
        }
      }

      const result = startCarryInternal({
        cube,
        offset: body.offset && typeof body.offset === 'object' ? body.offset : undefined,
      })
      if (!result.ok) {
        const code =
          result.error === 'NOT_FOUND' ? 404 :
          result.error === 'PINNED' ? 409 :
          result.error === 'VOXEL_OCCUPIED' ? 409 :
          409
        return reply.code(code).send(result)
      }
      return {
        ...result,
        carrying: true,
      }
    })
  })

  fastify.post(`${config.routePrefix}/build/carry/stop`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    return runBuildMutation(reply, async () => {
      if (!state.carry) {
        return { ok: true, carrying: false, carry: null }
      }
      const body = req.body || {}
      const snapToGrid = body.snapToGrid !== false
      let targetGrid = null
      if (body.targetGrid && typeof body.targetGrid === 'object') {
        targetGrid = {
          x: Number.parseInt(body.targetGrid.x, 10),
          y: Number.parseInt(body.targetGrid.y, 10),
          z: Number.parseInt(body.targetGrid.z, 10),
        }
        if (![targetGrid.x, targetGrid.y, targetGrid.z].every(Number.isInteger)) {
          return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'targetGrid requires integer x,y,z' })
        }
      }
      const result = stopCarryInternal({ snapToGrid, targetGrid })
      if (!result.ok) {
        return reply.code(409).send(result)
      }
      const snapshot = collectBuildSnapshot(world, config)
      return {
        ...result,
        carrying: false,
        limits: snapshot.limits,
      }
    })
  })

  fastify.post(`${config.routePrefix}/build/reposition-auto`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    if (state.buildMutationInFlight || state.autoRepositionInFlight) {
      return reply.code(409).send({ error: 'BUILD_BUSY', message: 'Another build mutation is in progress' })
    }

    const body = req.body || {}
    const targetGridRaw = body.targetGrid && typeof body.targetGrid === 'object' ? body.targetGrid : null
    const targetGrid = targetGridRaw
      ? {
          x: Number.parseInt(targetGridRaw.x, 10),
          y: Number.parseInt(targetGridRaw.y, 10),
          z: Number.parseInt(targetGridRaw.z, 10),
        }
      : null
    if (!targetGrid || ![targetGrid.x, targetGrid.y, targetGrid.z].every(Number.isInteger)) {
      return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'targetGrid with integer x,y,z is required' })
    }

    const navArrivalRadius =
      typeof body.arrivalRadius === 'number' && body.arrivalRadius > 0
        ? Math.min(Math.max(body.arrivalRadius, 0.5), 4)
        : 1.75
    const navTimeout =
      typeof body.timeoutMs === 'number' && body.timeoutMs > 0
        ? Math.min(Math.max(Math.round(body.timeoutMs), 1000), 60000)
        : 20000
    const navRun = body.run === true
    const approachSource = body.approachSource !== false

    state.autoRepositionInFlight = true
    markInteraction('build_reposition_auto')
    try {
      await ensureGatewayAgent('build_reposition_auto')

      const snapshot = collectBuildSnapshot(world, config)
      const existingAtTarget = snapshot.occupied.get(voxelKey(targetGrid))
      if (existingAtTarget) {
        return reply.code(409).send({
          error: 'VOXEL_OCCUPIED',
          message: 'Target voxel is already occupied',
          targetGrid,
          existing: {
            x: existingAtTarget.grid.x,
            y: existingAtTarget.grid.y,
            z: existingAtTarget.grid.z,
            assetClassId: existingAtTarget.assetClassId,
          },
          limits: snapshot.limits,
        })
      }

      const targetColumnCount = snapshot.columnCounts.get(columnKey(targetGrid)) || 0
      if (targetColumnCount >= config.build.maxStackHeight) {
        return reply.code(409).send({
          error: 'MAX_STACK_HEIGHT_REACHED',
          message: `Target column already has ${targetColumnCount} cubes (max ${config.build.maxStackHeight})`,
          targetGrid,
          limits: snapshot.limits,
        })
      }

      let selectedCube = null
      if (typeof body.entityId === 'string' && body.entityId.trim()) {
        selectedCube = snapshot.cubes.find(c => c.entityId === body.entityId) || null
      } else if (body.sourceGrid && typeof body.sourceGrid === 'object') {
        const sourceGrid = {
          x: Number.parseInt(body.sourceGrid.x, 10),
          y: Number.parseInt(body.sourceGrid.y, 10),
          z: Number.parseInt(body.sourceGrid.z, 10),
        }
        if (![sourceGrid.x, sourceGrid.y, sourceGrid.z].every(Number.isInteger)) {
          return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'sourceGrid requires integer x,y,z' })
        }
        selectedCube = snapshot.occupied.get(voxelKey(sourceGrid)) || null
      } else {
        selectedCube = findNearestCubeToGatewayAgent(snapshot)
      }

      if (!selectedCube) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'No cube available to reposition' })
      }
      if (
        selectedCube.grid.x === targetGrid.x &&
        selectedCube.grid.y === targetGrid.y &&
        selectedCube.grid.z === targetGrid.z
      ) {
        return {
          ok: true,
          unchanged: true,
          targetGrid,
          selected: {
            assetClassId: selectedCube.assetClassId,
            fromGrid: selectedCube.grid,
          },
          carrying: !!state.carry,
          limits: snapshot.limits,
        }
      }

      const pose = getGatewayAgentPose()
      if (!pose?.runtime?.agent) {
        return reply.code(409).send({
          error: 'AGENT_NOT_READY',
          message: 'Gateway agent pose unavailable',
          carrying: !!state.carry,
          carry: getCarryStatus(),
        })
      }

      let pickupNavigate = null
      if (approachSource) {
        pickupNavigate = await pose.runtime.agent.navigateTo(selectedCube.position.x, selectedCube.position.z, {
          arrivalRadius: navArrivalRadius,
          timeout: navTimeout,
          run: navRun,
        })
        if (!pickupNavigate?.arrived) {
          return reply.code(409).send({
            error: 'PICKUP_NAVIGATION_FAILED',
            message: pickupNavigate?.error || 'Failed to approach source cube',
            sourceGrid: selectedCube.grid,
            sourceWorld: selectedCube.position,
            navigate: pickupNavigate,
            carrying: !!state.carry,
            carry: getCarryStatus(),
          })
        }
      }

      const startCarry = startCarryInternal({
        cube: selectedCube,
        offset: body.carryOffset && typeof body.carryOffset === 'object' ? body.carryOffset : undefined,
      })
      if (!startCarry.ok) {
        const status = startCarry.error === 'NOT_FOUND' ? 404 : 409
        return reply.code(status).send(startCarry)
      }

      const poseAfterPickup = getGatewayAgentPose()
      if (!poseAfterPickup?.runtime?.agent) {
        return reply.code(409).send({
          error: 'AGENT_NOT_READY',
          message: 'Gateway agent pose unavailable after starting carry',
          carrying: !!state.carry,
          carry: getCarryStatus(),
        })
      }

      const targetWorld = gridToWorldPosition(targetGrid, config)
      const navigate = await poseAfterPickup.runtime.agent.navigateTo(targetWorld.x, targetWorld.z, {
        arrivalRadius: navArrivalRadius,
        timeout: navTimeout,
        run: navRun,
      })

      if (!navigate?.arrived) {
        return reply.code(409).send({
          error: 'NAVIGATION_FAILED',
          message: navigate?.error || 'Navigation failed',
          targetGrid,
          targetWorld,
          navigate,
          carrying: !!state.carry,
          carry: getCarryStatus(),
        })
      }

      const stopCarry = stopCarryInternal({ snapToGrid: true, targetGrid })
      if (!stopCarry.ok) {
        return reply.code(409).send({
          ...stopCarry,
          targetGrid,
          navigate,
          carrying: !!state.carry,
          carry: getCarryStatus(),
        })
      }

      const nextSnapshot = collectBuildSnapshot(world, config)
      const placed = nextSnapshot.occupied.get(voxelKey(targetGrid))
      return {
        ok: true,
        targetGrid,
        targetWorld,
        selected: {
          assetClassId: selectedCube.assetClassId,
          fromGrid: selectedCube.grid,
        },
        pickupNavigate,
        carryStarted: !!startCarry.carry,
        navigate,
        placed: placed
          ? {
              x: placed.grid.x,
              y: placed.grid.y,
              z: placed.grid.z,
              assetClassId: placed.assetClassId,
            }
          : null,
        limits: nextSnapshot.limits,
      }
    } finally {
      state.autoRepositionInFlight = false
    }
  })

  fastify.post(`${config.routePrefix}/build/remove`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    return runBuildMutation(reply, async () => {
      const body = req.body || {}
      const snapshot = collectBuildSnapshot(world, config)

      let targetCube = null
      if (typeof body.entityId === 'string' && body.entityId.trim()) {
        targetCube = snapshot.cubes.find(c => c.entityId === body.entityId) || null
      } else if (body.grid && typeof body.grid === 'object') {
        const grid = {
          x: Number.parseInt(body.grid.x, 10),
          y: Number.parseInt(body.grid.y, 10),
          z: Number.parseInt(body.grid.z, 10),
        }
        if (![grid.x, grid.y, grid.z].every(Number.isInteger)) {
          return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'grid requires integer x,y,z' })
        }
        targetCube = snapshot.occupied.get(voxelKey(grid)) || null
      } else {
        return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'entityId or grid is required' })
      }

      if (!targetCube) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cube not found' })
      }
      if (state.carry?.entityId === targetCube.entityId) {
        return reply.code(409).send({ error: 'CARRY_ACTIVE', message: 'Stop carry before removing this cube' })
      }
      if (config.build.protectPinned && targetCube.pinned) {
        return reply.code(409).send({ error: 'PINNED', message: 'Pinned cubes are protected' })
      }

      const ok = removeAppEntity(world, targetCube.entityId)
      if (!ok) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity no longer exists' })
      }

      const nextSnapshot = collectBuildSnapshot(world, config)
      return {
        ok: true,
        removed: targetCube,
        limits: nextSnapshot.limits,
      }
    })
  })

  fastify.post(`${config.routePrefix}/build/move`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    return runBuildMutation(reply, async () => {
      const body = req.body || {}
      const snapshot = collectBuildSnapshot(world, config)

      let cube = null
      if (typeof body.entityId === 'string' && body.entityId.trim()) {
        cube = snapshot.cubes.find(c => c.entityId === body.entityId) || null
      } else if (body.fromGrid && typeof body.fromGrid === 'object') {
        const fromGrid = {
          x: Number.parseInt(body.fromGrid.x, 10),
          y: Number.parseInt(body.fromGrid.y, 10),
          z: Number.parseInt(body.fromGrid.z, 10),
        }
        if (![fromGrid.x, fromGrid.y, fromGrid.z].every(Number.isInteger)) {
          return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'fromGrid requires integer x,y,z' })
        }
        cube = snapshot.occupied.get(voxelKey(fromGrid)) || null
      } else {
        return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'entityId or fromGrid is required' })
      }

      if (!cube) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cube not found' })
      }
      if (state.carry?.entityId === cube.entityId) {
        return reply.code(409).send({ error: 'CARRY_ACTIVE', message: 'Stop carry before moving this cube' })
      }
      if (config.build.protectPinned && cube.pinned) {
        return reply.code(409).send({ error: 'PINNED', message: 'Pinned cubes are protected' })
      }

      const to = body.toGrid && typeof body.toGrid === 'object' ? body.toGrid : null
      const toGrid = to
        ? { x: Number.parseInt(to.x, 10), y: Number.parseInt(to.y, 10), z: Number.parseInt(to.z, 10) }
        : null
      if (!toGrid || ![toGrid.x, toGrid.y, toGrid.z].every(Number.isInteger)) {
        return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'toGrid with integer x,y,z is required' })
      }

      const sameCell = cube.grid.x === toGrid.x && cube.grid.y === toGrid.y && cube.grid.z === toGrid.z
      if (sameCell) {
        return { ok: true, moved: cube, unchanged: true, limits: snapshot.limits }
      }

      const occupiedTarget = snapshot.occupied.get(voxelKey(toGrid))
      if (occupiedTarget) {
        return reply.code(409).send({
          error: 'VOXEL_OCCUPIED',
          message: 'Target voxel is already occupied',
          existing: occupiedTarget,
          limits: snapshot.limits,
        })
      }

      const sourceColumn = columnKey(cube.grid)
      const targetColumn = columnKey(toGrid)
      const targetColumnCount = snapshot.columnCounts.get(targetColumn) || 0
      const projectedTargetCount = sourceColumn === targetColumn ? targetColumnCount : targetColumnCount + 1
      if (projectedTargetCount > config.build.maxStackHeight) {
        return reply.code(409).send({
          error: 'MAX_STACK_HEIGHT_REACHED',
          message: `Target column would exceed max stack height (${config.build.maxStackHeight})`,
          limits: snapshot.limits,
        })
      }

      const worldPos = gridToWorldPosition(toGrid, config)
      const ok = modifyAppEntity(world, cube.entityId, {
        mover: null,
        position: [worldPos.x, worldPos.y, worldPos.z],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        state: {},
      })
      if (!ok) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity no longer exists' })
      }

      const nextSnapshot = collectBuildSnapshot(world, config)
      const moved = nextSnapshot.occupied.get(voxelKey(toGrid)) || null
      return {
        ok: true,
        moved,
        fromGrid: cube.grid,
        toGrid,
        limits: nextSnapshot.limits,
      }
    })
  })

  fastify.post(`${config.routePrefix}/build/place`, async (req, reply) => {
    if (!requireBuildEnabled(reply)) return
    if (!requireOutboundAuth(req, reply)) return
    if (!requireBuildWorld(reply)) return
    return runBuildMutation(reply, async () => {
      const body = req.body || {}
      const assetClassId = (body.assetClassId || 'default-cube').trim?.() || 'default-cube'
      if (assetClassId !== 'default-cube') {
        return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'Only assetClassId=default-cube is supported for now' })
      }

      const g = body.grid && typeof body.grid === 'object' ? body.grid : null
      const grid = g
        ? {
            x: Number.parseInt(g.x, 10),
            y: Number.parseInt(g.y, 10),
            z: Number.parseInt(g.z, 10),
          }
        : null
      if (!grid || ![grid.x, grid.y, grid.z].every(Number.isInteger)) {
        return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'grid with integer x,y,z is required' })
      }

      const snapshot = collectBuildSnapshot(world, config)
      const existingAtTarget = snapshot.occupied.get(voxelKey(grid))
      if (existingAtTarget) {
        return reply.code(409).send({
          error: 'VOXEL_OCCUPIED',
          message: 'Target voxel is already occupied',
          existing: existingAtTarget,
          limits: snapshot.limits,
        })
      }

      const colCount = snapshot.columnCounts.get(columnKey(grid)) || 0
      if (colCount >= config.build.maxStackHeight) {
        return reply.code(409).send({
          error: 'MAX_STACK_HEIGHT_REACHED',
          message: `Column already has ${colCount} cubes (max ${config.build.maxStackHeight})`,
          limits: snapshot.limits,
        })
      }

      if (snapshot.limits.currentCubes >= config.build.maxCubes) {
        return reply.code(409).send({
          error: 'MAX_CUBES_REACHED',
          message: `Cube limit reached (${config.build.maxCubes}); remove or move an existing cube first`,
          limits: snapshot.limits,
          evictionCandidates: snapshot.evictionCandidates,
        })
      }

      const canonicalBlueprint = getCanonicalDefaultCubeBlueprint(world, config)
      if (!canonicalBlueprint) {
        return reply.code(500).send({ error: 'DEFAULT_CUBE_NOT_FOUND', message: 'Could not resolve default cube blueprint from collections' })
      }

      const blueprint = ensureBlueprintPublished(world, canonicalBlueprint)
      const worldPos = gridToWorldPosition(grid, config)
      const data = {
        id: uuid(),
        type: 'app',
        blueprint: blueprint.id,
        position: [worldPos.x, worldPos.y, worldPos.z],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        mover: null,
        uploader: null,
        pinned: false,
        state: {},
      }
      addAppEntity(world, data)

      const nextSnapshot = collectBuildSnapshot(world, config)
      const placed = nextSnapshot.occupied.get(voxelKey(grid)) || {
        entityId: data.id,
        assetClassId: 'default-cube',
        grid,
        position: worldPos,
      }

      return {
        ok: true,
        placed,
        limits: nextSnapshot.limits,
      }
    })
  })

  fastify.post(`${config.routePrefix}/action`, async (req, reply) => {
    if (!requireOutboundAuth(req, reply)) return

    const body = req.body || {}
    const action =
      (body.action && typeof body.action === 'object' && !Array.isArray(body.action) && body.action) ||
      (body.hyperfyAction && typeof body.hyperfyAction === 'object' && !Array.isArray(body.hyperfyAction) && body.hyperfyAction) ||
      (body && typeof body === 'object' && !Array.isArray(body) && typeof body.type === 'string' ? body : null)

    if (!action || typeof action.type !== 'string' || !action.type.trim()) {
      return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'action.type is required' })
    }

    const type = action.type.trim()
    const input =
      (action.input && typeof action.input === 'object' && !Array.isArray(action.input) && action.input) ||
      (action.params && typeof action.params === 'object' && !Array.isArray(action.params) && action.params) ||
      {}

    const routeMap = {
      'build.catalog': { method: 'GET', path: `${config.routePrefix}/build/catalog` },
      'build.snapshot': { method: 'GET', path: `${config.routePrefix}/build/snapshot` },
      'build.perception': { method: 'GET', path: `${config.routePrefix}/build/perception` },
      'build.carry.status': { method: 'GET', path: `${config.routePrefix}/build/carry/status` },
      'build.carry.start': { method: 'POST', path: `${config.routePrefix}/build/carry/start` },
      'build.carry.stop': { method: 'POST', path: `${config.routePrefix}/build/carry/stop` },
      'build.reposition-auto': { method: 'POST', path: `${config.routePrefix}/build/reposition-auto` },
      'build.reposition_auto': { method: 'POST', path: `${config.routePrefix}/build/reposition-auto` },
      'build.move': { method: 'POST', path: `${config.routePrefix}/build/move` },
      'build.place': { method: 'POST', path: `${config.routePrefix}/build/place` },
      'build.remove': { method: 'POST', path: `${config.routePrefix}/build/remove` },
    }

    const target = routeMap[type]
    if (!target) {
      return reply.code(400).send({
        error: 'UNSUPPORTED_ACTION',
        message: `Unsupported action type: ${type}`,
        supported: Object.keys(routeMap),
      })
    }

    const headers = {}
    if (req.headers.authorization) headers.authorization = req.headers.authorization
    if (target.method === 'POST') headers['content-type'] = 'application/json'

    const injected = await fastify.inject({
      method: target.method,
      url: target.path,
      headers,
      payload: target.method === 'POST' ? input : undefined,
    })

    let data
    try {
      data = JSON.parse(injected.body)
    } catch {
      data = { raw: injected.body }
    }

    return reply.code(injected.statusCode).send({
      ok: injected.statusCode >= 200 && injected.statusCode < 300,
      action: type,
      result: data,
      statusCode: injected.statusCode,
    })
  })

  fastify.post(`${config.routePrefix}/outbound`, async (req, reply) => {
    if (!requireOutboundAuth(req, reply)) return

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
    markInteraction('outbound_reply')

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
    if (state.carry?.timer) {
      clearInterval(state.carry.timer)
      state.carry.timer = null
    }
    state.carry = null
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.idleWanderTimer) {
      clearTimeout(state.idleWanderTimer)
      state.idleWanderTimer = null
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
  scheduleIdleWander('startup')

  logger.info({ routePrefix: config.routePrefix }, 'OpenClaw gateway plugin registered')
}
