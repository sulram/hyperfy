/**
 * Runtime patches to Hyperfy core for headless agent support.
 * Ported from molt.space fork — minimum needed for agents to walk visibly.
 * Import once at plugin startup: `import './patchHyperfyCore.js'`
 */

import { ClientControls } from '../../core/systems/ClientControls'
import { ClientNetwork } from '../../core/systems/ClientNetwork'
import { PlayerLocal } from '../../core/entities/PlayerLocal'
import { storage } from '../../core/storage'

// --- ClientControls: add simulateLook(yaw) for agent facing direction ---
ClientControls.prototype.simulateLook = function (yaw) {
  this._simulatedYaw = typeof yaw === 'number' ? yaw : null
}

// --- PlayerLocal: inject _simulatedYaw into cam.rotation.y before update ---
const _origPlayerUpdate = PlayerLocal.prototype.update
PlayerLocal.prototype.update = function (delta) {
  const simYaw = this.world?.controls?._simulatedYaw
  if (typeof simYaw === 'number') {
    this.cam.rotation.y = simYaw
  }
  _origPlayerUpdate.call(this, delta)
}

// --- ClientNetwork: accept authToken/skipStorage in init() ---
const _origNetInit = ClientNetwork.prototype.init
ClientNetwork.prototype.init = function (opts) {
  this._skipStorage = !!opts.skipStorage
  if (opts.authToken !== undefined) {
    // Build WebSocket URL directly with provided token (bypass storage)
    let url = `${opts.wsUrl}?authToken=${opts.authToken}`
    if (opts.name) url += `&name=${encodeURIComponent(opts.name)}`
    if (opts.avatar) url += `&avatar=${encodeURIComponent(opts.avatar)}`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    this.ws.addEventListener('message', this.onPacket)
    this.ws.addEventListener('close', this.onClose)
  } else {
    _origNetInit.call(this, opts)
  }
}

// --- ClientNetwork: skip authToken storage write when _skipStorage ---
const _origOnSnapshot = ClientNetwork.prototype.onSnapshot
ClientNetwork.prototype.onSnapshot = function (data) {
  _origOnSnapshot.call(this, data)
  if (this._skipStorage) {
    storage.remove('authToken')
  }
}
