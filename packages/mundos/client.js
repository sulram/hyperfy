import { LogInIcon } from 'lucide-react'
import { MundosPane } from './MundosPane'

// the token (or "guest") arrives in the url fragment, which browsers keep out of requests and logs.
// without one, the load passes through mundos, which signs the person in if needed and sends them back.
export default function (world) {
  const url = globalThis.env?.PUBLIC_MUNDOS_URL
  if (!url) return
  const match = location.hash.match(/^#identity=(.+)$/)
  if (!match) {
    location.replace(`${url}/enter?host=${encodeURIComponent(location.host)}`)
    return
  }
  history.replaceState(null, '', location.pathname + location.search)
  const identity = decodeURIComponent(match[1])
  world.network.params.identity = identity
  world.mundos = { url, world: globalThis.env.PUBLIC_MUNDOS_WORLD, guest: identity === 'guest' }
  world.ui.register({ id: 'mundos', section: 'main', label: 'Mundos', icon: LogInIcon, component: MundosPane })
}
