import { createNodeClientWorld } from '../../core/createNodeClientWorld'

const round2 = n => Math.round(n * 100) / 100

const DIRECTION_KEYS = {
  forward: 'keyW',
  backward: 'keyS',
  left: 'keyA',
  right: 'keyD',
  jump: 'space',
}

export class AgentConnection {
  constructor(id, name, avatar) {
    this.id = id
    this.name = name
    this.avatar = avatar || null
    this.status = 'connecting'
    this.world = null
    this._moveTimers = []
    this._chatListener = null
    this._navInterval = null
    this._navResolve = null
    this._navRunning = false

    // Callback hooks — set by the session handler before connect()
    this.onWorldChat = null
    this.onKick = null
    this.onDisconnect = null
  }

  connect(wsUrl) {
    return new Promise((resolve, reject) => {
      this.world = createNodeClientWorld()

      const timeout = setTimeout(() => {
        this.status = 'error'
        reject(new Error('Connection timed out'))
      }, 15000)

      this.world.once('ready', () => {
        clearTimeout(timeout)
        this.status = 'connected'

        this._chatListener = msg => {
          if (this.onWorldChat) this.onWorldChat(msg)
        }
        this.world.events.on('chat', this._chatListener)

        resolve()
      })

      this.world.on('kick', code => {
        clearTimeout(timeout)
        this.status = 'kicked'
        console.log(`Agent ${this.name} (${this.id}) kicked: ${code}`)
        if (this.onKick) this.onKick(code)
      })

      this.world.on('disconnect', () => {
        clearTimeout(timeout)
        if (this.status !== 'disconnected') {
          this.status = 'disconnected'
          console.log(`Agent ${this.name} (${this.id}) disconnected`)
          if (this.onDisconnect) this.onDisconnect()
        }
      })

      this.world.init({
        wsUrl,
        name: this.name,
        avatar: this.avatar,
        authToken: null,
        skipStorage: true,
      })
    })
  }

  getPlayerId() {
    return this.world?.network?.id ?? null
  }

  getPosition() {
    const player = this.world?.entities?.player
    if (!player) return null
    const p = player.base.position
    return { x: round2(p.x), y: round2(p.y), z: round2(p.z) }
  }

  getYaw() {
    const player = this.world?.entities?.player
    if (!player) return null
    const q = player.base.quaternion
    return round2(Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)))
  }

  /** Returns all players in the world (browser + agents) */
  getAllPlayers() {
    const players = this.world?.entities?.players
    if (!players) return []
    const result = []
    players.forEach(player => {
      const p = player.base.position
      const q = player.base.quaternion
      result.push({
        id: player.data.id,
        name: player.data.name,
        position: { x: round2(p.x), y: round2(p.y), z: round2(p.z) },
        yaw: round2(Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))),
        isLocal: !!player.isLocal,
      })
    })
    return result
  }

  /** Find a player by name (searches all world players) */
  findPlayerByName(name) {
    const players = this.world?.entities?.players
    if (!players) return null
    const lower = name.toLowerCase()
    for (const [, player] of players) {
      if (player.data.name?.toLowerCase() === lower) {
        const p = player.base.position
        return {
          id: player.data.id,
          name: player.data.name,
          position: { x: round2(p.x), y: round2(p.y), z: round2(p.z) },
          isLocal: !!player.isLocal,
        }
      }
    }
    return null
  }

  speak(text) {
    if (this.status !== 'connected') {
      throw new Error(`Agent is not connected (status: ${this.status})`)
    }
    this.world.chat.send(text)
  }

  move(direction, durationMs = 1000, run = false) {
    if (this.status !== 'connected') {
      throw new Error(`Agent is not connected (status: ${this.status})`)
    }
    this.cancelNavigation()
    const key = DIRECTION_KEYS[direction]
    if (!key) {
      throw new Error(`Invalid direction: ${direction}. Use: ${Object.keys(DIRECTION_KEYS).join(', ')}`)
    }
    if (run) this.world.controls.simulateButton('shiftLeft', true)
    this.world.controls.simulateButton(key, true)
    const timer = setTimeout(() => {
      this.world.controls.simulateButton(key, false)
      if (run) this.world.controls.simulateButton('shiftLeft', false)
      const idx = this._moveTimers.indexOf(timer)
      if (idx !== -1) this._moveTimers.splice(idx, 1)
    }, durationMs)
    this._moveTimers.push(timer)
  }

  navigateTo(targetX, targetZ, { arrivalRadius = 2.0, timeout = 30000, getTargetPos = null, run = false } = {}) {
    if (this.status !== 'connected') {
      return Promise.reject(new Error(`Agent is not connected (status: ${this.status})`))
    }
    this.cancelNavigation()

    return new Promise(resolve => {
      const startTime = Date.now()
      this._navResolve = resolve
      this._navRunning = run

      const tick = () => {
        const pos = this.getPosition()
        if (!pos) {
          this._cleanupNav()
          resolve({ arrived: false, position: null, distance: null, error: 'Lost position' })
          return
        }

        let tx = targetX
        let tz = targetZ
        if (getTargetPos) {
          const tp = getTargetPos()
          if (tp) {
            tx = tp.x
            tz = tp.z
          }
        }

        const dx = tx - pos.x
        const dz = tz - pos.z
        const distance = Math.sqrt(dx * dx + dz * dz)

        if (distance <= arrivalRadius) {
          this.world.controls.simulateButton('keyW', false)
          if (run) this.world.controls.simulateButton('shiftLeft', false)
          this.world.controls.simulateLook(null)
          this._cleanupNav()
          resolve({ arrived: true, position: pos, distance: round2(distance) })
          return
        }

        if (Date.now() - startTime > timeout) {
          this.world.controls.simulateButton('keyW', false)
          if (run) this.world.controls.simulateButton('shiftLeft', false)
          this.world.controls.simulateLook(null)
          this._cleanupNav()
          resolve({ arrived: false, position: pos, distance: round2(distance), error: 'Navigation timeout' })
          return
        }

        // Rotate to face target, then walk/run forward
        const yaw = Math.atan2(-dx, -dz)
        this.world.controls.simulateLook(yaw)
        if (run) this.world.controls.simulateButton('shiftLeft', true)
        this.world.controls.simulateButton('keyW', true)
      }

      tick()
      this._navInterval = setInterval(tick, 200)
    })
  }

  cancelNavigation() {
    if (this._navInterval) {
      clearInterval(this._navInterval)
      this._navInterval = null
    }
    if (this._navResolve) {
      if (this.world && this.status === 'connected') {
        this.world.controls.simulateButton('keyW', false)
        if (this._navRunning) this.world.controls.simulateButton('shiftLeft', false)
        this.world.controls.simulateLook(null)
      }
      const resolve = this._navResolve
      this._navResolve = null
      this._navRunning = false
      const pos = this.getPosition()
      resolve({ arrived: false, position: pos, distance: null, error: 'Cancelled' })
    }
  }

  _cleanupNav() {
    if (this._navInterval) {
      clearInterval(this._navInterval)
      this._navInterval = null
    }
    this._navResolve = null
  }

  disconnect() {
    this.cancelNavigation()
    for (const timer of this._moveTimers) {
      clearTimeout(timer)
    }
    this._moveTimers = []
    if (this.world && this.status === 'connected') {
      this.world.controls.simulateButton('shiftLeft', false)
    }
    if (this.world) {
      if (this._chatListener) {
        this.world.events.off('chat', this._chatListener)
        this._chatListener = null
      }
      this.status = 'disconnected'
      this.world.destroy()
      this.world = null
    }
    this.onWorldChat = null
    this.onKick = null
    this.onDisconnect = null
  }

  toJSON() {
    return { id: this.id, name: this.name, avatar: this.avatar, status: this.status }
  }
}
