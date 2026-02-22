import Fastify from 'fastify'
import { chunkText } from './text.js'

function parseAuthToken(req) {
  const auth = req.headers.authorization
  if (!auth) return ''
  const [scheme, token] = auth.split(' ')
  if (!token) return ''
  if (scheme.toLowerCase() !== 'bearer') return ''
  return token
}

export function createHttpServer({ config, logger, hyperfyClient, statusRef }) {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return {
      status: 'ok',
      hyperfy: {
        connected: !!statusRef.connected,
        spawned: !!statusRef.spawned,
        agent: statusRef.agent || null,
      },
    }
  })

  app.post('/outbound', async (req, reply) => {
    const expectedToken = config.bridge.outboundToken
    if (expectedToken) {
      const received = parseAuthToken(req)
      if (received !== expectedToken) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }
    }

    const body = req.body || {}
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return reply.code(400).send({ error: 'INVALID_PARAMS', message: 'text is required' })
    }

    const parts = chunkText(text, config.hyperfy.maxChatLength)
    for (const part of parts) {
      hyperfyClient.speak(part)
    }

    logger.info({ parts: parts.length }, 'Queued outbound text to Hyperfy')
    return {
      ok: true,
      queued: parts.length,
      truncatedByChunking: parts.length > 1,
    }
  })

  app.post('/inbound/test', async (req, reply) => {
    const body = req.body || {}
    logger.info({ body }, 'Test inbound request received')
    return reply.send({ ok: true })
  })

  return app
}
