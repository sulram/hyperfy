import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import moment from 'moment'
import { uuid } from '@hyperfy/core/utils'
import { Ranks } from '@hyperfy/core/extras/ranks'

const LEEWAY = 30 // seconds of clock drift allowed on exp

// who a connection is, according to mundos: a short-lived EdDSA token mundos signs for this world,
// handed over in the connection params by client.js. without the variables a dev world behaves as today.
export default function (world, { fastify, worldDir }) {
  const pem = process.env.MUNDOS_PUBLIC_KEY
  const name = process.env.PUBLIC_MUNDOS_WORLD
  if (!pem && !name) return
  if (!pem || !name) {
    return console.error('[mundos] MUNDOS_PUBLIC_KEY and PUBLIC_MUNDOS_WORLD must be set together; identity disabled')
  }
  const publicKey = crypto.createPublicKey(pem.replace(/\\n/g, '\n'))

  // free build for accounts: the admin flips it from inside the world. it lives in the world folder, which an upgrade copies
  const stateFile = path.join(worldDir, 'mundos.json')
  const state = fs.existsSync(stateFile) ? fs.readJsonSync(stateFile) : { freeBuild: false }
  const levels = new Map() // player id -> level, to apply a free build flip to whoever is connected

  const rankOf = level => {
    if (level === 'admin' || level === 'superadmin') return Ranks.ADMIN
    if (level === 'builder') return Ranks.BUILDER
    if (level === 'signed_in' && state.freeBuild) return Ranks.BUILDER
    return Ranks.VISITOR
  }

  world.network.setIdentity(params => {
    const token = params.identity
    if (!token || token === 'guest') return null
    const claims = verify(token, publicKey, name)
    if (!claims) {
      console.error('[mundos] token refused, entering as a guest')
      return null
    }
    levels.set(claims.sub, claims.level)
    return { id: claims.sub, name: claims.name, rank: rankOf(claims.level) }
  })

  const setFreeBuild = async (value, socket) => {
    state.freeBuild = value
    await fs.writeJson(stateFile, state)
    for (const s of world.network.sockets.values()) {
      if (levels.get(s.player.data.id) !== 'signed_in') continue
      const rank = rankOf('signed_in')
      s.player.modify({ rank })
      world.network.send('entityModified', { id: s.player.data.id, rank })
    }
    socket.send('chatAdded', {
      id: uuid(),
      from: null,
      fromId: null,
      body: `Free build for accounts: ${value ? 'on' : 'off'}`,
      createdAt: moment().toISOString(),
    })
  }

  world.events.on('command', ({ playerId, args }) => {
    if (args[0] !== 'freebuild') return
    const socket = world.network.sockets.get(playerId)
    if (!socket?.player.isAdmin()) return
    if (args[1] === 'on') setFreeBuild(true, socket)
    if (args[1] === 'off') setFreeBuild(false, socket)
  })

  fastify.get('/api/mundos', async () => ({ world: name, freeBuild: state.freeBuild }))
}

// the claims of an EdDSA JWT signed by mundos for this world, or null. (jsonwebtoken 9 has no EdDSA)
export function verify(token, publicKey, world, now = Date.now() / 1000) {
  try {
    const [h, p, s] = token.split('.')
    const header = JSON.parse(Buffer.from(h, 'base64url'))
    if (header.alg !== 'EdDSA') return null
    if (!crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))) return null
    const claims = JSON.parse(Buffer.from(p, 'base64url'))
    if (claims.iss !== 'mundos' || claims.aud !== world || !claims.sub) return null
    if (typeof claims.exp !== 'number' || claims.exp + LEEWAY < now) return null
    return claims
  } catch {
    return null
  }
}
