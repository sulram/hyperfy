/**
 * Ring buffer for storing events that HTTP agents poll for.
 * Events are timestamped on push and drained by timestamp on poll.
 */
export class EventBuffer {
  constructor(maxSize = 500) {
    this._maxSize = maxSize
    this._events = []
  }

  /**
   * Add an event to the buffer. Drops oldest if full.
   * Attaches `timestamp` (ISO string, returned to agent) and `_ts` (numeric, for filtering).
   */
  push(event) {
    if (event.id && this._events.some(e => e.id === event.id)) return
    const now = Date.now()
    const entry = {
      ...event,
      timestamp: new Date(now).toISOString(),
      _ts: now,
    }
    this._events.push(entry)
    if (this._events.length > this._maxSize) {
      this._events.shift()
    }
  }

  /**
   * Return all events after `sinceMs` (numeric timestamp) and clear them from the buffer.
   * Poll-and-consume pattern — each event is only returned once.
   */
  drainSince(sinceMs = 0) {
    const cutoff = typeof sinceMs === 'number' ? sinceMs : 0
    const matching = this._events.filter(e => e._ts > cutoff)
    this._events = this._events.filter(e => e._ts <= cutoff)
    return matching.map(({ _ts, ...rest }) => rest)
  }

  get length() {
    return this._events.length
  }
}
