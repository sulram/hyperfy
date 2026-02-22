import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

export class HyperfyWsClient extends EventEmitter {
  constructor(config, logger) {
    super()
    this.config = config
    this.logger = logger
    this.ws = null
    this.connected = false
    this.spawned = false
    this.closedExplicitly = false
    this.reconnectDelayMs = config.reconnectMinMs
    this.pingTimer = null
    this.reconnectTimer = null
    this.queue = []
  }

  start() {
    this.closedExplicitly = false
    this._connect()
  }

  stop() {
    this.closedExplicitly = true
    this._clearTimers()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  speak(text) {
    this.send({ type: 'speak', text })
  }

  send(message) {
    if (this.spawned && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
      return
    }
    if (this.queue.length >= 200) this.queue.shift()
    this.queue.push(message)
  }

  _connect() {
    if (this.closedExplicitly) return
    this.logger.info({ wsUrl: this.config.wsUrl }, 'Connecting to Hyperfy agents websocket')
    const ws = new WebSocket(this.config.wsUrl)
    this.ws = ws
    this.connected = false
    this.spawned = false

    ws.on('open', () => {
      this.connected = true
      this.reconnectDelayMs = this.config.reconnectMinMs
      this.logger.info('Connected to Hyperfy websocket')
      this._startPing()
      this._sendSpawn()
    })

    ws.on('message', raw => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        this.logger.warn({ raw: raw.toString().slice(0, 200) }, 'Ignoring invalid JSON from Hyperfy WS')
        return
      }
      this._onMessage(msg)
    })

    ws.on('close', (code, reason) => {
      const reasonText = reason?.toString() || ''
      this.logger.warn({ code, reason: reasonText }, 'Hyperfy websocket closed')
      this.connected = false
      this.spawned = false
      this._clearPing()
      this.emit('status', { connected: false, spawned: false })
      if (!this.closedExplicitly) this._scheduleReconnect()
    })

    ws.on('error', err => {
      this.logger.error({ err: err.message }, 'Hyperfy websocket error')
    })
  }

  _sendSpawn() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const payload = {
      type: 'spawn',
      name: this.config.agentName,
    }
    if (this.config.agentAvatar) payload.avatar = this.config.agentAvatar
    this.ws.send(JSON.stringify(payload))
  }

  _onMessage(msg) {
    const { type } = msg
    if (type === 'spawned') {
      this.spawned = true
      this.logger.info({ id: msg.id, displayName: msg.displayName }, 'Hyperfy agent spawned')
      this.emit('status', { connected: this.connected, spawned: true, agent: msg })
      this._flushQueue()
      return
    }

    if (type === 'chat') {
      this.emit('chat', msg)
      return
    }

    if (type === 'error') {
      this.logger.warn({ code: msg.code, message: msg.message }, 'Hyperfy agent error event')
      this.emit('error_event', msg)
      return
    }

    if (type === 'pong') {
      this.logger.debug('Received Hyperfy pong')
      return
    }

    this.emit('event', msg)
  }

  _flushQueue() {
    if (!this.spawned || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    while (this.queue.length) {
      const msg = this.queue.shift()
      this.ws.send(JSON.stringify(msg))
    }
  }

  _startPing() {
    this._clearPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, this.config.pingIntervalMs)
  }

  _clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.closedExplicitly) return
    const delay = this.reconnectDelayMs
    this.logger.info({ delayMs: delay }, 'Scheduling Hyperfy reconnect')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._connect()
    }, delay)
    this.reconnectDelayMs = Math.min(Math.round(delay * 1.8), this.config.reconnectMaxMs)
  }

  _clearTimers() {
    this._clearPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
