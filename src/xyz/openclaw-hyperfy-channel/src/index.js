import { loadConfig } from './config.js'
import { TtlDedupe } from './dedupe.js'
import { HyperfyWsClient } from './hyperfyWsClient.js'
import { createHttpServer } from './httpServer.js'
import { OpenClawClient } from './openclawClient.js'

function createLogger(level = 'info') {
  const priorities = { debug: 10, info: 20, warn: 30, error: 40 }
  const min = priorities[level] ?? priorities.info
  const log = (lvl, obj, msg) => {
    if ((priorities[lvl] ?? 100) < min) return
    const rec = {
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...(obj || {}),
    }
    const line = JSON.stringify(rec)
    if (lvl === 'error' || lvl === 'warn') console.error(line)
    else console.log(line)
  }
  return {
    debug(obj, msg) {
      if (typeof obj === 'string') return log('debug', null, obj)
      return log('debug', obj, msg)
    },
    info(obj, msg) {
      if (typeof obj === 'string') return log('info', null, obj)
      return log('info', obj, msg)
    },
    warn(obj, msg) {
      if (typeof obj === 'string') return log('warn', null, obj)
      return log('warn', obj, msg)
    },
    error(obj, msg) {
      if (typeof obj === 'string') return log('error', null, obj)
      return log('error', obj, msg)
    },
  }
}

async function main() {
  const config = loadConfig()
  const logger = createLogger(config.logLevel)
  const statusRef = { connected: false, spawned: false, agent: null }
  const dedupe = new TtlDedupe()

  const openclaw = new OpenClawClient(config.openclaw, logger)
  const hyperfy = new HyperfyWsClient(config.hyperfy, logger)

  hyperfy.on('status', status => {
    statusRef.connected = !!status.connected
    statusRef.spawned = !!status.spawned
    statusRef.agent = status.agent || statusRef.agent
  })

  hyperfy.on('chat', async msg => {
    const key = msg.id || `${msg.fromId}:${msg.createdAt}:${msg.body}`
    if (dedupe.has(key)) {
      logger.debug({ key }, 'Skipping duplicate Hyperfy chat event')
      return
    }
    dedupe.add(key)
    try {
      await openclaw.sendChat(msg)
    } catch (err) {
      logger.error({ err: err.message, key }, 'Failed to forward Hyperfy chat to OpenClaw')
    }
  })

  hyperfy.on('event', msg => {
    logger.debug({ type: msg.type }, 'Hyperfy event')
  })

  const app = createHttpServer({ config, logger, hyperfyClient: hyperfy, statusRef })

  app.addHook('onRequest', async req => {
    logger.debug({ method: req.method, url: req.url }, 'HTTP request')
  })

  app.addHook('onError', async (_req, _reply, err) => {
    logger.error({ err: err.message }, 'HTTP server error')
  })

  await app.listen({ port: config.port, host: '0.0.0.0' })
  logger.info({ port: config.port }, 'Bridge HTTP server listening')

  hyperfy.start()

  const shutdown = async signal => {
    logger.info({ signal }, 'Shutting down')
    hyperfy.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(err => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'Startup failed', err: err.message }))
  process.exit(1)
})
