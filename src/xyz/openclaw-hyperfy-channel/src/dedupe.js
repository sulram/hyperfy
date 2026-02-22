export class TtlDedupe {
  constructor(ttlMs = 120000, maxEntries = 5000) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.map = new Map()
  }

  has(key) {
    this._sweep()
    return this.map.has(key)
  }

  add(key) {
    this._sweep()
    this.map.set(key, Date.now())
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey) this.map.delete(oldestKey)
    }
  }

  _sweep() {
    const now = Date.now()
    for (const [key, ts] of this.map) {
      if (now - ts > this.ttlMs) this.map.delete(key)
    }
  }
}
