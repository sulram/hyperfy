# XYZ Agents

Headless Hyperfy agents with a direct HTTP/cURL and WebSocket control surface.

This project adapts the `molt.space` headless-agent model to Hyperfy: instead of teleporting entities, it simulates player inputs so the agent can walk, run, and navigate visibly inside the world.

Use this project when you need:

- direct world control
- chat replies
- movement and navigation
- event polling
- automation over HTTP/cURL or WebSocket

Do not use this project for voxel or build actions. Build APIs live in `../openclaw-hyperfy-channel/`.

## Files That Matter

- `index.js` - HTTP, session, REST, and WebSocket surfaces
- `AgentConnection.js` - headless world connection plus movement and navigation
- `patchHyperfyCore.js` - local Hyperfy runtime patching needed for headless control
- `EventBuffer.js` - poll-and-consume event queue for HTTP sessions
- `avatarLibrary.js` - avatar lookup and `library:*` resolution
- `../skills/curl-http-agent/SKILL.md` - operational contract for cURL/session-driven agents

## Scope Boundary

This project owns:

- spawn and despawn
- chat
- walk and run movement
- world polling
- navigation toward coordinates or players
- HTTP session lifecycle
- bearer-token REST calls
- WebSocket control

This project does not own:

- `build.catalog`
- `build.snapshot`
- `build.perception`
- `build.place`
- `build.move`
- `build.remove`
- `/openclaw-gateway/*`

## Important Caveat

The API exposes `face` and `look`, including plaintext `face <direction|yaw|auto|@Name>`, but the current handler only acknowledges the request. It does not yet apply a reliable visible facing change to the agent. Document `face` as available syntax, but do not rely on it for gameplay behavior until the handler is wired.

## How It Works

At runtime:

1. the manager creates a node client world
2. the client connects to Hyperfy
3. the manager exposes control surfaces on top of that runtime
4. polling drains buffered events such as chat, proximity, and navigation

The movement model comes from `molt.space`:

- compute target direction
- rotate toward it with simulated input
- hold movement keys
- monitor distance until arrival, timeout, or cancel

## API Surfaces

There are 4 public surfaces here:

1. session spawn: `POST /api/spawn`
2. session URL: `GET|POST /s/:token`
3. bearer REST: `/api/agents/:id/*`
4. WebSocket: `GET /ws/agents`

There are also maintenance/admin routes:

- `GET /agents/health`
- `GET /api/avatars`
- `POST /api/agents/admin/despawn`
- `POST /api/agents/admin/prune-duplicates`

## Spawn Contract

### `POST /api/spawn`

Request:

```bash
curl -s -X POST "$BASE_URL/api/spawn" \
  -H 'content-type: application/json' \
  -d '{"name":"MyAgent","avatar":"library:devil"}'
```

Body fields:

- `name` - required string, max 32 chars
- `avatar` - optional avatar ref string such as `library:devil`

Successful response:

```json
{
  "id": "agent-id",
  "token": "bearer-token",
  "session": "http://host/s/session-token",
  "name": "MyAgent",
  "displayName": "MyAgent",
  "avatar": "/avatars/devil.vrm"
}
```

Failure:

```json
{
  "error": "SPAWN_FAILED",
  "message": "Name too long (max 32 characters)"
}
```

## Session URL Contract

The session URL is the simplest surface for cURL and automation.

### `GET /s/:token`

Poll pending events.

Success:

```json
{
  "ok": true,
  "events": [],
  "commands": [
    "say <text>",
    "move forward|backward|left|right|jump [ms]",
    "run forward|backward|left|right|jump [ms]",
    "face <direction|auto|@Name>",
    "look <direction|auto|@Name>",
    "position",
    "nearby [radius]",
    "goto <x> <z> [run]",
    "goto @<Name> [run]",
    "stop",
    "who",
    "ping",
    "despawn"
  ]
}
```

Auth failures:

- `401 { "ok": false, "error": "Invalid session token" }`
- `401 { "ok": false, "error": "Session expired" }`

### `POST /s/:token`

Send raw plaintext commands.

One line = one command. Multiple lines are executed in order.

Example:

```bash
curl -s -d "say hello
goto @PlayerName run" "$SESSION"
```

Single-command response:

```json
{
  "ok": true,
  "action": "goto",
  "status": "started",
  "target": "PlayerName",
  "distance": 8.1,
  "run": true,
  "events": [],
  "commands": ["say <text>", "..."]
}
```

Multi-command response:

```json
{
  "ok": true,
  "results": [
    { "ok": true, "action": "say" },
    { "ok": true, "action": "goto", "status": "started", "target": "PlayerName" }
  ],
  "events": [],
  "commands": ["say <text>", "..."]
}
```

Important:

- `events[]` are drained on every session poll
- `who`, `position`, and `nearby` return data in the command result, not as events
- `goto` starts navigation immediately, but final success or failure appears later in `events[]`

## Plaintext Commands

- `say <text>` - returns `{ ok, action: "say", warning? }`
- `move <direction> [ms]` - returns `{ ok, action: "move", direction, duration }`
- `run <direction> [ms]` - returns `{ ok, action: "run", direction, duration, run: true }`
- `position` or `pos` - returns `{ ok, action: "position", x, y, z, yaw }`
- `nearby [radius]` - returns `{ ok, action: "nearby", radius, agents: [...] }`
- `who` - returns `{ ok, action: "who", agents: [...] }`
- `goto <x> <z> [run]` - returns `{ ok, action: "goto", status: "started", target: { x, z }, distance, run? }`
- `goto @Name [run]` - returns the same start payload, but tracks a player or another agent
- `stop` - returns `{ ok, action: "stop" }`
- `ping` - returns `{ ok, action: "pong", agentStatus }`
- `despawn` - returns `{ ok, action: "despawn" }`
- `face <direction|yaw|auto|@Name>` / `look <direction|yaw|auto|@Name>` - acknowledged by the API, but currently not reliable as real orientation control

Common command errors:

- `Unknown command: ...`
- `Player not found: @Name`
- `Duration cannot exceed 10000ms`
- `Message too long (max 500 characters)`
- `Agent not connected (...)`

## Event Model

Polling returns `events[]`. These are the important event types:

### `chat`

```json
{
  "type": "chat",
  "from": "PlayerName",
  "fromId": "player-id",
  "body": "hello",
  "id": "chat-id",
  "createdAt": "2026-02-27T12:34:56.000Z"
}
```

### `navigate`

Started:

```json
{
  "type": "navigate",
  "status": "started",
  "target": { "x": 10, "z": 4 },
  "distance": 12.8,
  "run": true
}
```

Arrived:

```json
{
  "type": "navigate",
  "status": "arrived",
  "position": { "x": 10.1, "y": 0, "z": 4.2 },
  "distance": 0.6
}
```

Failed:

```json
{
  "type": "navigate",
  "status": "failed",
  "position": { "x": 8.2, "y": 0, "z": 3.1 },
  "distance": 3.4,
  "error": "Navigation timeout"
}
```

### `proximity`

```json
{
  "type": "proximity",
  "entered": [
    {
      "displayName": "PlayerName",
      "id": "player-id",
      "position": { "x": 1, "y": 0, "z": 2 },
      "distance": 2.1
    }
  ],
  "exited": []
}
```

### lifecycle

- `{"type":"kicked","code":"..."}`
- `{"type":"disconnected"}`

## Bearer REST Contract

Use this when you want explicit `Authorization: Bearer <token>` auth instead of the session URL.

Endpoints:

- `GET /api/agents/:id/events?since=<ms-or-date>`
  Response: `{ events, agentStatus }`
- `POST /api/agents/:id/speak`
  Body: `{ "text": "hello" }`
  Response: `{ "status": "sent", "warning"?: "..." }`
- `POST /api/agents/:id/move`
  Body: `{ "direction": "forward", "duration": 1000, "run": true }`
  Response: `{ "status": "moving"|"running", "direction": "forward", "duration": 1000, "run"?: true }`
- `POST /api/agents/:id/face`
  Body: `{ "direction": "left" }` or `{ "direction": null }`
  Response: `{ "status": "facing", "direction": "left"|"auto" }`
  Caveat: this is still only an ACK today
- `POST /api/agents/:id/ping`
  Response: `{ "status": "pong", "agentStatus": "connected" }`
- `DELETE /api/agents/:id`
  Response: `{ "status": "despawned" }`

Common failures:

- `401 { "error": "UNAUTHORIZED" }`
- `403 { "error": "FORBIDDEN" }`
- `409 { "error": "NOT_CONNECTED" }`
- `400 { "error": "INVALID_PARAMS", "message": "..." }`

## WebSocket Contract

Endpoint:

- `GET /ws/agents`

Messages are JSON, not plaintext.

Useful client message types:

- `{ "type": "spawn", "name": "MyAgent", "avatar": "library:devil" }`
- `{ "type": "speak", "text": "hello" }`
- `{ "type": "move", "direction": "forward", "duration": 1000, "run": true }`
- `{ "type": "navigate", "x": 10, "z": 5, "run": true }`
- `{ "type": "navigate", "target": "@PlayerName", "run": true }`
- `{ "type": "nearby", "radius": 10 }`
- `{ "type": "who" }`
- `{ "type": "ping" }`
- `{ "type": "stop" }`
- `{ "type": "list_avatars" }`

Useful server message types:

- `spawned`
- `chat`
- `warning`
- `move`
- `position`
- `nearby`
- `navigate`
- `who`
- `avatar_library`
- `pong`
- `kicked`
- `disconnected`
- `error`

The WebSocket `face` message exists, but it has the same current limitation as the HTTP handler: ACK only.

## Health and Maintenance Endpoints

- `GET /agents/health`
  Response: `{ status, agents, players, maxAgents }`
- `GET /api/avatars`
  Response: `{ avatars }`
- `POST /api/agents/admin/despawn`
  Requires admin auth
  Protected by `ADMIN_CODE`
  Body: `{ agentId, reason? }`
- `POST /api/agents/admin/prune-duplicates`
  Requires admin auth
  Protected by `ADMIN_CODE`
  Body: `{ name?, transport?, tag?, keep?, onlyConnected? }`

## Operational Rules

- Poll every 3 seconds while the agent is active
- Session inactivity TTL is 2 minutes
- Treat the session URL as a secret
- Do not claim navigation success until a later `navigate` event says `arrived`
- Use `stop` before switching from active navigation to a new manual movement plan
- Keep chat under 500 characters

## Minimal cURL Loop

```bash
SPAWN=$(curl -s -X POST "$BASE_URL/api/spawn" \
  -H 'content-type: application/json' \
  -d '{"name":"MyAgent"}')

SESSION=$(echo "$SPAWN" | jq -r .session)

for i in $(seq 1 200); do
  RESPONSE=$(curl -s -d "ping" "$SESSION")
  echo "$RESPONSE" | jq .
  sleep 3
done
```

## Skill

For an operational prompt focused on the session interface and real response shapes, use:

- `../skills/curl-http-agent/SKILL.md`
