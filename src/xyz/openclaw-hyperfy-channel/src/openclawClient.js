export class OpenClawClient {
  constructor(config, logger) {
    this.config = config
    this.logger = logger
  }

  async sendChat({ from, fromId, body, id, createdAt }) {
    const payload = {
      agent: this.config.agent,
      text: body,
      user: {
        id: fromId || from || 'unknown',
        name: from || 'Unknown',
      },
      channel: {
        id: this.config.channelId,
        type: 'hyperfy',
        name: this.config.channelName,
      },
      metadata: {
        source: 'hyperfy',
        hyperfy: {
          messageId: id,
          fromId,
          from,
          createdAt,
        },
      },
    }

    const headers = { 'content-type': 'application/json' }
    if (this.config.bearerToken) headers.authorization = `Bearer ${this.config.bearerToken}`
    if (this.config.webhookSecret) headers['x-webhook-secret'] = this.config.webhookSecret

    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), this.config.timeoutMs)
    try {
      const res = await fetch(this.config.hookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      const raw = await res.text()
      if (!res.ok) {
        this.logger.error({ status: res.status, body: raw }, 'OpenClaw webhook rejected message')
        throw new Error(`OpenClaw webhook error ${res.status}`)
      }
      this.logger.debug({ status: res.status, body: raw.slice(0, 300) }, 'Forwarded Hyperfy chat to OpenClaw')
      return { ok: true, status: res.status }
    } finally {
      clearTimeout(timeout)
    }
  }
}
