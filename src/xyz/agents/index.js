import { uuid } from '../../core/utils'
import { AgentConnection } from './AgentConnection.js'
import { avatarLibrary, resolveAvatarRef } from './avatarLibrary.js'
import { EventBuffer } from './EventBuffer.js'

const INACTIVITY_TTL = 2 * 60 * 1000
const MAX_CHAT_LENGTH = 500
const MAX_NAME_LENGTH = 32
const PROXIMITY_RADIUS = 5
const MAX_AGENTS = 100

const agentSessions = new Map()
const tokenIndex = new Map()
const proximityState = new Map()

const round2 = n => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function destroySession(agentId) {
  const session = agentSessions.get(agentId)
  if (!session) return
  if (session.token) tokenIndex.delete(session.token)
  if (session.agent) {
    try { session.agent.disconnect() } catch {}
  }
  const nearbySet = proximityState.get(agentId)
  if (nearbySet) {
    for (const otherId of nearbySet) {
      const otherSet = proximityState.get(otherId)
      if (otherSet) otherSet.delete(agentId)
      const otherSession = agentSessions.get(otherId)
      if (otherSession) {
        pushEvent(otherSession, {
          type: 'proximity',
          entered: [],
          exited: [{ displayName: session.displayName, id: agentId }],
        })
      }
    }
    proximityState.delete(agentId)
  }
  agentSessions.delete(agentId)
  console.log(`[agents] Session destroyed: ${agentId}`)
}

function resolveDisplayName(name, agentId) {
  for (const [id, session] of agentSessions) {
    if (id !== agentId && session.agent.name === name) {
      return `${name}#${agentId.substring(0, 3)}`
    }
  }
  return name
}

function resolveFromName(fromId, fallback) {
  for (const [, session] of agentSessions) {
    if (session.agent.getPlayerId() === fromId) return session.displayName
  }
  return fallback
}

function pushEvent(session, event) {
  if (session.transport === 'ws' && session.ws) {
    if (session.ws.readyState === 1) {
      session.ws.send(JSON.stringify(event))
    }
  } else if (session.eventBuffer) {
    session.eventBuffer.push(event)
  }
}

function resolveAgentByName(name) {
  const clean = name.startsWith('@') ? name.slice(1) : name
  const lower = clean.toLowerCase()
  // 1. Search agent sessions first
  for (const [id, session] of agentSessions) {
    if (session.agent.status === 'connected' && session.displayName.toLowerCase() === lower) {
      return { id, session, type: 'agent' }
    }
  }
  for (const [id, session] of agentSessions) {
    if (session.agent.status === 'connected' && session.agent.name.toLowerCase() === lower) {
      return { id, session, type: 'agent' }
    }
  }
  return null
}

/** Search all world players (browser + agents) using any connected agent's world view */
function resolveWorldPlayerByName(name) {
  const clean = name.startsWith('@') ? name.slice(1) : name
  // First check agent sessions
  const agentResult = resolveAgentByName(clean)
  if (agentResult) {
    const pos = agentResult.session.agent.getPosition()
    return { name: agentResult.session.displayName, position: pos, type: 'agent', agentId: agentResult.id }
  }
  // Then search world players via any connected agent's world
  for (const [, session] of agentSessions) {
    if (session.agent.status === 'connected') {
      const found = session.agent.findPlayerByName(clean)
      if (found && !found.isLocal) {
        return { name: found.name, position: found.position, type: 'player', playerId: found.id }
      }
    }
  }
  return null
}

function validateSpeakText(text) {
  if (/^\s*\{?\s*"?type"?\s*[:=]/i.test(text) || /^\s*type\s*:\s*\w+/i.test(text)) {
    return 'Text looks like a malformed command. Send commands as proper JSON messages, not as speak text.'
  }
  return null
}

function validateName(name) {
  if (!name || typeof name !== 'string') return 'spawn requires { name: string }'
  if (name.length > MAX_NAME_LENGTH) return `Name too long (max ${MAX_NAME_LENGTH} characters)`
  if (/<|>/.test(name)) return 'Name cannot contain < or > characters'
  return null
}

// ---------------------------------------------------------------------------
// Plaintext command parser
// ---------------------------------------------------------------------------

function parseTextCommand(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed === 'say') return { action: 'speak', text: '' }
  if (trimmed.startsWith('say ')) return { action: 'speak', text: trimmed.slice(4) }
  if (trimmed === 'move') return { action: 'move', direction: '', duration: 1000 }
  if (trimmed === 'run') return { action: 'move', direction: '', duration: 1000, run: true }

  const moveMatch = trimmed.match(/^move\s+(\w+)(?:\s+(\S+))?$/)
  if (moveMatch) {
    if (!moveMatch[2]) return { action: 'move', direction: moveMatch[1], duration: 1000 }
    const parsed = Number(moveMatch[2])
    if (!Number.isInteger(parsed)) return { action: 'move_error', error: 'Duration must be a whole number in milliseconds' }
    return { action: 'move', direction: moveMatch[1], duration: parsed }
  }

  const runMatch = trimmed.match(/^run\s+(\w+)(?:\s+(\S+))?$/)
  if (runMatch) {
    if (!runMatch[2]) return { action: 'move', direction: runMatch[1], duration: 1000, run: true }
    const parsed = Number(runMatch[2])
    if (!Number.isInteger(parsed)) return { action: 'move_error', error: 'Duration must be a whole number in milliseconds' }
    return { action: 'move', direction: runMatch[1], duration: parsed, run: true }
  }

  if (trimmed === 'face' || trimmed === 'look') return { action: 'face', direction: '' }
  const faceMatch = trimmed.match(/^(?:face|look)\s+(.+)$/)
  if (faceMatch) {
    const val = faceMatch[1].trim()
    if (val === 'auto') return { action: 'face', direction: null }
    const num = parseFloat(val)
    if (!isNaN(num)) return { action: 'face', yaw: num }
    return { action: 'face', direction: val }
  }

  if (trimmed === 'who') return { action: 'who' }
  if (trimmed === 'ping') return { action: 'ping' }
  if (trimmed === 'despawn') return { action: 'despawn' }
  if (trimmed === 'position' || trimmed === 'pos') return { action: 'position' }
  if (trimmed === 'stop') return { action: 'stop' }

  const nearbyMatch = trimmed.match(/^nearby(?:\s+(\S+))?$/)
  if (nearbyMatch) {
    const radius = nearbyMatch[1] ? parseFloat(nearbyMatch[1]) : 10
    if (isNaN(radius) || radius <= 0) return { action: 'nearby_error', error: 'Radius must be a positive number' }
    return { action: 'nearby', radius }
  }

  const gotoMatch = trimmed.match(/^goto\s+(.+)$/)
  if (gotoMatch) {
    let val = gotoMatch[1].trim()
    let run = false
    if (/\s+run$/i.test(val)) {
      run = true
      val = val.replace(/\s+run$/i, '')
    }
    const coordMatch = val.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/)
    if (coordMatch) {
      const result = { action: 'goto', x: parseFloat(coordMatch[1]), z: parseFloat(coordMatch[2]) }
      if (run) result.run = true
      return result
    }
    const result = { action: 'goto', target: val }
    if (run) result.run = true
    return result
  }
  if (trimmed === 'goto') return { action: 'goto_error', error: 'goto requires coordinates (goto x z) or agent name (goto @Name)' }

  return { action: 'unknown', raw: trimmed }
}

// ---------------------------------------------------------------------------
// Command executor
// ---------------------------------------------------------------------------

const SESSION_COMMANDS = [
  'say <text>', 'move forward|backward|left|right|jump [ms]', 'run forward|backward|left|right|jump [ms]',
  'face <direction|auto|@Name>', 'look <direction|auto|@Name>', 'position', 'nearby [radius]',
  'goto <x> <z> [run]', 'goto @<Name> [run]', 'stop', 'who', 'ping', 'despawn',
]

function executeCommand(session, cmd) {
  const agent = session.agent

  switch (cmd.action) {
    case 'speak': {
      if (!cmd.text) return { ok: false, error: 'say requires text' }
      if (cmd.text.length > MAX_CHAT_LENGTH) return { ok: false, error: `Message too long (max ${MAX_CHAT_LENGTH} characters)` }
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      const warning = validateSpeakText(cmd.text)
      agent.speak(cmd.text)
      const result = { ok: true, action: 'say' }
      if (warning) result.warning = warning
      return result
    }
    case 'move_error':
      return { ok: false, error: cmd.error }
    case 'move': {
      if (!cmd.direction) return { ok: false, error: 'move requires a direction (forward, backward, left, right, jump)' }
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      if (cmd.duration <= 0) return { ok: false, error: 'Duration must be positive (1-10000ms)' }
      if (cmd.duration > 10000) return { ok: false, error: 'Duration cannot exceed 10000ms' }
      try {
        agent.move(cmd.direction, cmd.duration, !!cmd.run)
      } catch (err) {
        return { ok: false, error: err.message }
      }
      const result = { ok: true, action: cmd.run ? 'run' : 'move', direction: cmd.direction, duration: cmd.duration }
      if (cmd.run) result.run = true
      return result
    }
    case 'face': {
      if (cmd.direction === '') return { ok: false, error: 'face requires a direction, auto, or @Name' }
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      try {
        if (typeof cmd.direction === 'string' && cmd.direction.startsWith('@')) {
          const resolved = resolveWorldPlayerByName(cmd.direction)
          if (!resolved) return { ok: false, error: `Player not found: ${cmd.direction}` }
          return { ok: true, action: 'face', target: resolved.name }
        } else {
          return { ok: true, action: 'face', direction: cmd.direction ?? 'auto' }
        }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    }
    case 'who': {
      const agents = []
      const seenIds = new Set()
      // Get all world players from any connected agent's world view
      for (const [, s] of agentSessions) {
        if (s.agent.status === 'connected') {
          const allPlayers = s.agent.getAllPlayers()
          for (const p of allPlayers) {
            if (!seenIds.has(p.id)) {
              seenIds.add(p.id)
              agents.push({ displayName: p.name, id: p.id, position: p.position, isLocal: p.isLocal })
            }
          }
          break // one agent's view is enough
        }
      }
      return { ok: true, action: 'who', agents }
    }
    case 'ping':
      return { ok: true, action: 'pong', agentStatus: agent.status }
    case 'position': {
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      const pos = agent.getPosition()
      if (!pos) return { ok: false, error: 'Position not available' }
      const yaw = agent.getYaw()
      return { ok: true, action: 'position', x: pos.x, y: pos.y, z: pos.z, yaw }
    }
    case 'nearby_error':
      return { ok: false, error: cmd.error }
    case 'nearby': {
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      const myPos = agent.getPosition()
      if (!myPos) return { ok: false, error: 'Position not available' }
      const radius = cmd.radius || 10
      const nearby = []
      const seenIds = new Set()
      // Get all world players (browser + agents)
      const allPlayers = agent.getAllPlayers()
      for (const p of allPlayers) {
        if (p.isLocal) continue
        if (seenIds.has(p.id)) continue
        seenIds.add(p.id)
        const dx = p.position.x - myPos.x
        const dz = p.position.z - myPos.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist <= radius) {
          nearby.push({ displayName: p.name, id: p.id, position: p.position, distance: round2(dist) })
        }
      }
      nearby.sort((a, b) => a.distance - b.distance)
      return { ok: true, action: 'nearby', radius, agents: nearby }
    }
    case 'goto_error':
      return { ok: false, error: cmd.error }
    case 'goto': {
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      const myPos = agent.getPosition()
      if (!myPos) return { ok: false, error: 'Position not available' }

      let navX, navZ, targetName = null, getTargetPos = null
      if (cmd.target) {
        const resolved = resolveWorldPlayerByName(cmd.target)
        if (!resolved) return { ok: false, error: `Player not found: ${cmd.target}` }
        targetName = resolved.name
        if (!resolved.position) return { ok: false, error: `Cannot get position of ${targetName}` }
        navX = resolved.position.x
        navZ = resolved.position.z
        if (resolved.type === 'agent') {
          const targetId = resolved.agentId
          getTargetPos = () => {
            const s = agentSessions.get(targetId)
            if (!s || s.agent.status !== 'connected') return null
            return s.agent.getPosition()
          }
        } else {
          // For browser players, re-lookup position each tick via the world
          const playerName = resolved.name
          getTargetPos = () => {
            for (const [, s] of agentSessions) {
              if (s.agent.status === 'connected') {
                const found = s.agent.findPlayerByName(playerName)
                if (found) return found.position
              }
            }
            return null
          }
        }
      } else {
        navX = cmd.x
        navZ = cmd.z
      }

      const dx = navX - myPos.x
      const dz = navZ - myPos.z
      const startDistance = round2(Math.sqrt(dx * dx + dz * dz))
      const agentId = session.agent.id
      const navRun = !!cmd.run

      agent.navigateTo(navX, navZ, { getTargetPos, run: navRun }).then(result => {
        const s = agentSessions.get(agentId)
        if (!s) return
        const event = { type: 'navigate', status: result.arrived ? 'arrived' : 'failed', position: result.position, distance: result.distance }
        if (result.error && !result.arrived) event.error = result.error
        if (targetName) event.target = targetName
        if (navRun) event.run = true
        pushEvent(s, event)
      })

      const startEvent = { type: 'navigate', status: 'started', distance: startDistance }
      if (targetName) startEvent.target = targetName
      else startEvent.target = { x: navX, z: navZ }
      if (navRun) startEvent.run = true
      return { ok: true, action: 'goto', ...startEvent }
    }
    case 'stop': {
      if (agent.status !== 'connected') return { ok: false, error: `Agent not connected (${agent.status})` }
      agent.cancelNavigation()
      return { ok: true, action: 'stop' }
    }
    case 'despawn':
      return { ok: true, action: 'despawn', _despawn: true }
    case 'unknown':
    default:
      return { ok: false, error: `Unknown command: ${cmd.raw || cmd.action}` }
  }
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function authenticate(req) {
  const auth = req.headers['authorization']
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const agentId = tokenIndex.get(token)
  if (!agentId) return null
  const session = agentSessions.get(agentId)
  if (!session) return null
  session.lastActivity = Date.now()
  return session
}

// ---------------------------------------------------------------------------
// Spawn helper
// ---------------------------------------------------------------------------

function getWsUrl() {
  const port = process.env.PORT || 3000
  return `ws://localhost:${port}/ws`
}

async function spawnAgent(name, avatarRef) {
  const nameError = validateName(name)
  if (nameError) throw new Error(nameError)

  let resolvedAvatar = null
  if (avatarRef) {
    if (typeof avatarRef !== 'string') throw new Error('avatar must be a string')
    resolvedAvatar = resolveAvatarRef(avatarRef)
    if (!resolvedAvatar) throw new Error(`Unknown avatar reference: ${avatarRef}`)
  }

  if (agentSessions.size >= MAX_AGENTS) throw new Error(`Agent limit reached (${MAX_AGENTS})`)

  const id = uuid()
  const token = uuid()
  const agent = new AgentConnection(id, name, resolvedAvatar)
  const displayName = resolveDisplayName(name, id)

  await agent.connect(getWsUrl())

  return { id, token, agent, displayName }
}

// ---------------------------------------------------------------------------
// Fastify Plugin
// ---------------------------------------------------------------------------

export async function agentManagerPlugin(fastify, opts) {
  const serverWorld = opts.world
  // Accept text/plain and urlencoded bodies as raw strings for the session endpoint
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
    done(null, body)
  })
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    done(null, body)
  })

  // Background intervals
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of agentSessions) {
      if (now - session.lastActivity > INACTIVITY_TTL) {
        console.log(`[agents] Inactivity timeout: ${id} (${session.agent.name})`)
        if (session.transport === 'ws' && session.ws) {
          try { session.ws.send(JSON.stringify({ type: 'kicked', code: 'INACTIVITY_TIMEOUT' })) } catch {}
          session.ws.close()
        } else {
          destroySession(id)
        }
      }
    }
  }, 60_000)

  const proximityInterval = setInterval(() => {
    const connected = []
    for (const [id, session] of agentSessions) {
      if (session.agent.status === 'connected') {
        const pos = session.agent.getPosition()
        if (pos) connected.push({ id, session, pos })
      }
    }
    for (let i = 0; i < connected.length; i++) {
      for (let j = i + 1; j < connected.length; j++) {
        const a = connected[i]
        const b = connected[j]
        const dx = a.pos.x - b.pos.x
        const dz = a.pos.z - b.pos.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const aSet = proximityState.get(a.id) || new Set()
        const bSet = proximityState.get(b.id) || new Set()
        if (!proximityState.has(a.id)) proximityState.set(a.id, aSet)
        if (!proximityState.has(b.id)) proximityState.set(b.id, bSet)
        if (dist <= PROXIMITY_RADIUS && !aSet.has(b.id)) {
          aSet.add(b.id)
          bSet.add(a.id)
          pushEvent(a.session, { type: 'proximity', entered: [{ displayName: b.session.displayName, id: b.id, position: b.pos, distance: round2(dist) }], exited: [] })
          pushEvent(b.session, { type: 'proximity', entered: [{ displayName: a.session.displayName, id: a.id, position: a.pos, distance: round2(dist) }], exited: [] })
        } else if (dist > PROXIMITY_RADIUS && aSet.has(b.id)) {
          aSet.delete(b.id)
          bSet.delete(a.id)
          pushEvent(a.session, { type: 'proximity', entered: [], exited: [{ displayName: b.session.displayName, id: b.id }] })
          pushEvent(b.session, { type: 'proximity', entered: [], exited: [{ displayName: a.session.displayName, id: a.id }] })
        }
      }
    }
  }, 1000)

  fastify.addHook('onClose', () => {
    clearInterval(cleanupInterval)
    clearInterval(proximityInterval)
    for (const [id] of agentSessions) {
      destroySession(id)
    }
  })

  // ---- Health ----
  fastify.get('/agents/health', async () => {
    const players = serverWorld.network.sockets.size
    return { status: 'ok', agents: agentSessions.size, players, maxAgents: MAX_AGENTS }
  })

  // ---- List avatars ----
  fastify.get('/api/avatars', async () => {
    return { avatars: avatarLibrary }
  })

  // ---- Spawn (HTTP) ----
  fastify.post('/api/spawn', async (req, reply) => {
    const { name, avatar } = req.body || {}
    let spawnResult
    try {
      spawnResult = await spawnAgent(name, avatar)
    } catch (err) {
      return reply.code(400).send({ error: 'SPAWN_FAILED', message: err.message })
    }

    const { id, token, agent, displayName } = spawnResult
    const eventBuffer = new EventBuffer()

    agent.onWorldChat = chatMsg => {
      const playerId = agent.getPlayerId()
      if (chatMsg.fromId === playerId) return
      eventBuffer.push({
        type: 'chat',
        from: resolveFromName(chatMsg.fromId, chatMsg.from),
        fromId: chatMsg.fromId,
        body: chatMsg.body,
        id: chatMsg.id,
        createdAt: chatMsg.createdAt,
      })
    }
    agent.onKick = code => eventBuffer.push({ type: 'kicked', code })
    agent.onDisconnect = () => eventBuffer.push({ type: 'disconnected' })

    const session = { agent, transport: 'http', token, ws: null, eventBuffer, lastActivity: Date.now(), displayName }
    agentSessions.set(id, session)
    tokenIndex.set(token, id)

    console.log(`[agents] HTTP spawned: ${name} (${id}) displayName=${displayName}`)

    const host = req.headers.host || `localhost:${process.env.PORT || 3000}`
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    reply.code(201)
    return { id, token, session: `${protocol}://${host}/s/${token}`, name: agent.name, displayName, avatar: agent.avatar }
  })

  // ---- Session endpoint: /s/:token ----
  fastify.get('/s/:token', async (req, reply) => {
    const { token } = req.params
    const agentId = tokenIndex.get(token)
    if (!agentId) return reply.code(401).send({ ok: false, error: 'Invalid session token' })
    const session = agentSessions.get(agentId)
    if (!session) return reply.code(401).send({ ok: false, error: 'Session expired' })
    session.lastActivity = Date.now()
    const events = session.eventBuffer ? session.eventBuffer.drainSince(0) : []
    return { ok: true, events, commands: SESSION_COMMANDS }
  })

  fastify.post('/s/:token', { config: { rawBody: true } }, async (req, reply) => {
    const { token } = req.params
    const agentId = tokenIndex.get(token)
    if (!agentId) return reply.code(401).send({ ok: false, error: 'Invalid session token' })
    const session = agentSessions.get(agentId)
    if (!session) return reply.code(401).send({ ok: false, error: 'Session expired' })
    session.lastActivity = Date.now()

    let body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    const results = []
    let shouldDespawn = false

    if (body) {
      const lines = body.split('\n')
      for (const line of lines) {
        const cmd = parseTextCommand(line)
        if (!cmd) continue
        const result = executeCommand(session, cmd)
        results.push(result)
        if (result._despawn) {
          shouldDespawn = true
          delete result._despawn
          break
        }
        delete result._despawn
      }
    }

    const events = session.eventBuffer ? session.eventBuffer.drainSince(0) : []
    const response = { ok: results.length === 0 || results.every(r => r.ok), events, commands: SESSION_COMMANDS }
    if (results.length === 1) Object.assign(response, results[0])
    else if (results.length > 1) response.results = results

    if (shouldDespawn) {
      setTimeout(() => destroySession(agentId), 0)
    }
    return response
  })

  // ---- Agent REST endpoints ----
  fastify.delete('/api/agents/:id', async (req, reply) => {
    const session = authenticate(req)
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (session.agent.id !== req.params.id) return reply.code(403).send({ error: 'FORBIDDEN' })
    destroySession(req.params.id)
    return { status: 'despawned' }
  })

  fastify.get('/api/agents/:id/events', async (req, reply) => {
    const session = authenticate(req)
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (session.agent.id !== req.params.id) return reply.code(403).send({ error: 'FORBIDDEN' })
    const since = req.query.since
    let sinceMs = 0
    if (since) {
      const parsed = Number(since) || Date.parse(since)
      if (!isNaN(parsed)) sinceMs = parsed
    }
    const events = session.eventBuffer ? session.eventBuffer.drainSince(sinceMs) : []
    return { events, agentStatus: session.agent.status }
  })

  fastify.post('/api/agents/:id/speak', async (req, reply) => {
    const session = authenticate(req)
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (session.agent.id !== req.params.id) return reply.code(403).send({ error: 'FORBIDDEN' })
    if (session.agent.status !== 'connected') return reply.code(409).send({ error: 'NOT_CONNECTED' })
    const { text } = req.body || {}
    if (!text || typeof text !== 'string') return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'speak requires { text: string }' })
    if (text.length > MAX_CHAT_LENGTH) return reply.code(400).send({ error: 'INVALID_PARAMS', message: `Message too long (max ${MAX_CHAT_LENGTH})` })
    const warning = validateSpeakText(text)
    session.agent.speak(text)
    const response = { status: 'sent' }
    if (warning) response.warning = warning
    return response
  })

  fastify.post('/api/agents/:id/move', async (req, reply) => {
    const session = authenticate(req)
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (session.agent.id !== req.params.id) return reply.code(403).send({ error: 'FORBIDDEN' })
    if (session.agent.status !== 'connected') return reply.code(409).send({ error: 'NOT_CONNECTED' })
    const { direction, duration, run } = req.body || {}
    if (!direction || typeof direction !== 'string') return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'move requires { direction: string }' })
    const durationMs = typeof duration === 'number' ? duration : 1000
    if (durationMs <= 0 || durationMs > 10000) return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'Duration must be 1-10000ms' })
    try {
      session.agent.move(direction, durationMs, !!run)
    } catch (err) {
      return reply.code(400).send({ error: 'INVALID_PARAMS', message: err.message })
    }
    const response = { status: run ? 'running' : 'moving', direction, duration: durationMs }
    if (run) response.run = true
    return response
  })

  fastify.post('/api/agents/:id/face', async (req, reply) => {
    const session = authenticate(req)
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (session.agent.id !== req.params.id) return reply.code(403).send({ error: 'FORBIDDEN' })
    if (session.agent.status !== 'connected') return reply.code(409).send({ error: 'NOT_CONNECTED' })
    const { direction } = req.body || {}
    if (direction === null) return { status: 'facing', direction: 'auto' }
    if (typeof direction === 'string') return { status: 'facing', direction }
    return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'face requires { direction: string } or { direction: null }' })
  })

  fastify.post('/api/agents/:id/ping', async (req, reply) => {
    const session = authenticate(req)
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (session.agent.id !== req.params.id) return reply.code(403).send({ error: 'FORBIDDEN' })
    return { status: 'pong', agentStatus: session.agent.status }
  })

  // ---- WebSocket for agents ----
  fastify.get('/ws/agents', { websocket: true }, (ws) => {
    let agentId = null

    ws.on('message', async raw => {
      if (agentId) {
        const session = agentSessions.get(agentId)
        if (session) session.lastActivity = Date.now()
      }

      let msg
      try { msg = JSON.parse(raw) } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'INVALID_COMMAND', message: 'Message must be valid JSON' }))
        return
      }

      const { type } = msg
      const sendWs = (t, payload = {}) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: t, ...payload }))
      }
      const sendErr = (code, message) => sendWs('error', { code, message })

      switch (type) {
        case 'spawn': {
          if (agentId) { sendErr('ALREADY_SPAWNED', 'Agent already spawned'); return }
          const { name, avatar } = msg
          let spawnResult
          try {
            spawnResult = await spawnAgent(name, avatar)
          } catch (err) {
            sendErr('SPAWN_FAILED', err.message)
            return
          }
          const { id, agent, displayName } = spawnResult
          agentId = id

          agent.onWorldChat = chatMsg => {
            const playerId = agent.getPlayerId()
            if (chatMsg.fromId === playerId) return
            sendWs('chat', { from: resolveFromName(chatMsg.fromId, chatMsg.from), fromId: chatMsg.fromId, body: chatMsg.body, id: chatMsg.id, createdAt: chatMsg.createdAt })
          }
          agent.onKick = code => { sendWs('kicked', { code }); ws.close() }
          agent.onDisconnect = () => { sendWs('disconnected'); ws.close() }

          const session = { agent, transport: 'ws', token: null, ws, eventBuffer: null, lastActivity: Date.now(), displayName }
          agentSessions.set(id, session)

          console.log(`[agents] WS spawned: ${name} (${id}) displayName=${displayName}`)
          sendWs('spawned', { id: agent.id, name: agent.name, displayName, avatar: agent.avatar })
          break
        }

        case 'speak': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', s?.agent ? 'Agent not connected' : 'Send spawn first'); return }
          const { text } = msg
          if (!text || typeof text !== 'string') { sendErr('INVALID_PARAMS', 'speak requires { text }'); return }
          if (text.length > MAX_CHAT_LENGTH) { sendErr('INVALID_PARAMS', `Message too long (max ${MAX_CHAT_LENGTH})`); return }
          const warning = validateSpeakText(text)
          if (warning) sendWs('warning', { message: warning })
          s.agent.speak(text)
          sendWs('speak', { text })
          break
        }

        case 'move': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', 'Send spawn first'); return }
          const { direction, duration, run: moveRun } = msg
          if (!direction || typeof direction !== 'string') { sendErr('INVALID_PARAMS', 'move requires { direction }'); return }
          const durationMs = typeof duration === 'number' ? duration : 1000
          if (durationMs <= 0 || durationMs > 10000) { sendErr('INVALID_PARAMS', 'Duration must be 1-10000ms'); return }
          try {
            s.agent.move(direction, durationMs, !!moveRun)
            const ack = { direction, duration: durationMs }
            if (moveRun) ack.run = true
            sendWs('move', ack)
          } catch (err) { sendErr('INVALID_PARAMS', err.message) }
          break
        }

        case 'face': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', 'Send spawn first'); return }
          const { direction: faceDir, target: faceTarget } = msg
          if (faceTarget) {
            const resolved = resolveWorldPlayerByName(faceTarget)
            if (!resolved) { sendErr('INVALID_PARAMS', `Player not found: ${faceTarget}`); return }
            sendWs('face', { target: resolved.name })
          } else if (faceDir === null) {
            sendWs('face', { direction: 'auto' })
          } else if (typeof faceDir === 'string') {
            sendWs('face', { direction: faceDir })
          } else {
            sendErr('INVALID_PARAMS', 'face requires { direction }, { target }, or { direction: null }')
          }
          break
        }

        case 'position': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', 'Send spawn first'); return }
          const pos = s.agent.getPosition()
          if (!pos) { sendErr('NOT_CONNECTED', 'Position not available'); return }
          sendWs('position', { x: pos.x, y: pos.y, z: pos.z, yaw: s.agent.getYaw() })
          break
        }

        case 'nearby': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', 'Send spawn first'); return }
          const myPos = s.agent.getPosition()
          if (!myPos) { sendErr('NOT_CONNECTED', 'Position not available'); return }
          const radius = (typeof msg.radius === 'number' && msg.radius > 0) ? msg.radius : 10
          const nearbyAgents = []
          const seenIds = new Set()
          const allPlayers = s.agent.getAllPlayers()
          for (const p of allPlayers) {
            if (p.isLocal) continue
            if (seenIds.has(p.id)) continue
            seenIds.add(p.id)
            const dx = p.position.x - myPos.x
            const dz = p.position.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist <= radius) nearbyAgents.push({ displayName: p.name, id: p.id, position: p.position, distance: round2(dist) })
          }
          nearbyAgents.sort((a, b) => a.distance - b.distance)
          sendWs('nearby', { radius, agents: nearbyAgents })
          break
        }

        case 'navigate': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', 'Send spawn first'); return }
          const myPos = s.agent.getPosition()
          if (!myPos) { sendErr('NOT_CONNECTED', 'Position not available'); return }

          let navX, navZ, targetName = null, getTargetPos = null
          const navRun = !!msg.run

          if (msg.target) {
            const resolved = resolveWorldPlayerByName(msg.target)
            if (!resolved) { sendErr('INVALID_PARAMS', `Player not found: ${msg.target}`); return }
            targetName = resolved.name
            if (!resolved.position) { sendErr('INVALID_PARAMS', `Cannot get position of ${targetName}`); return }
            navX = resolved.position.x
            navZ = resolved.position.z
            if (resolved.type === 'agent') {
              const targetId = resolved.agentId
              getTargetPos = () => { const ts = agentSessions.get(targetId); if (!ts || ts.agent.status !== 'connected') return null; return ts.agent.getPosition() }
            } else {
              const playerName = resolved.name
              getTargetPos = () => { for (const [, ts] of agentSessions) { if (ts.agent.status === 'connected') { const f = ts.agent.findPlayerByName(playerName); if (f) return f.position } } return null }
            }
          } else if (typeof msg.x === 'number' && typeof msg.z === 'number') {
            navX = msg.x
            navZ = msg.z
          } else {
            sendErr('INVALID_PARAMS', 'navigate requires { x, z } or { target }')
            return
          }

          const dx = navX - myPos.x
          const dz = navZ - myPos.z
          const startDistance = round2(Math.sqrt(dx * dx + dz * dz))
          const currentAgentId = agentId

          s.agent.navigateTo(navX, navZ, { getTargetPos, run: navRun }).then(result => {
            const ts = agentSessions.get(currentAgentId)
            if (!ts || !ts.ws || ts.ws.readyState !== 1) return
            const event = { type: 'navigate', status: result.arrived ? 'arrived' : 'failed', position: result.position, distance: result.distance }
            if (result.error && !result.arrived) event.error = result.error
            if (targetName) event.target = targetName
            if (navRun) event.run = true
            ts.ws.send(JSON.stringify(event))
          })

          const startPayload = { status: 'started', distance: startDistance }
          if (targetName) startPayload.target = targetName
          else startPayload.target = { x: navX, z: navZ }
          if (navRun) startPayload.run = true
          sendWs('navigate', startPayload)
          break
        }

        case 'stop': {
          const s = agentSessions.get(agentId)
          if (!s?.agent || s.agent.status !== 'connected') { sendErr(s?.agent ? 'NOT_CONNECTED' : 'SPAWN_REQUIRED', 'Send spawn first'); return }
          s.agent.cancelNavigation()
          sendWs('stop', {})
          break
        }

        case 'who': {
          const agents = []
          const seenIds = new Set()
          const s = agentSessions.get(agentId)
          if (s?.agent?.status === 'connected') {
            const allPlayers = s.agent.getAllPlayers()
            for (const p of allPlayers) {
              if (!seenIds.has(p.id)) {
                seenIds.add(p.id)
                agents.push({ displayName: p.name, id: p.id, position: p.position, isLocal: p.isLocal })
              }
            }
          }
          sendWs('who', { agents })
          break
        }

        case 'list_avatars':
          sendWs('avatar_library', { avatars: avatarLibrary })
          break

        case 'ping':
          sendWs('pong')
          break

        default:
          sendErr('INVALID_COMMAND', `Unknown command: ${type}`)
      }
    })

    ws.on('close', () => {
      if (agentId) { destroySession(agentId); agentId = null }
    })

    ws.on('error', () => {
      if (agentId) { destroySession(agentId); agentId = null }
    })
  })

  console.log('[agents] Agent manager plugin registered')
}
