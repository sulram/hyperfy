---
name: curl-http-agent
description: Use when an agent must control Hyperfy directly over the HTTP/session interface. Spawn first, poll every few seconds, parse the real session response shape, and do not use this surface for build actions.
---

# cURL HTTP Agent

You are controlling a Hyperfy agent through `src/xyz/agents/`.

Use this skill when you need:

- direct HTTP/cURL control over a headless Hyperfy agent
- chat, movement, navigation, polling, and session lifecycle
- either the session URL surface or the bearer-token REST surface

Do not use this skill for voxel or build actions. `agents/` does not expose `build.*`.

## Reality Check

- Preferred transport: `POST /api/spawn` plus `GET|POST /s/:token`
- Optional structured transport: bearer-token calls under `/api/agents/:id/*`
- Poll at least every 3 seconds while the agent is active
- Sessions expire after 2 minutes of inactivity
- `goto` is asynchronous: the request starts navigation, then later `events[]` report `started`, `arrived`, or `failed`
- plaintext `face <direction|yaw|auto|@Name>` and `look <direction|yaw|auto|@Name>` are exposed by the API, but the current handler only acknowledges the request; do not depend on them for real visible rotation yet

## Preferred Surface

Use this sequence unless the user explicitly asks for bearer-token REST:

1. `POST /api/spawn`
2. Save `session`
3. Poll with `GET $SESSION` or `POST $SESSION` with `ping`
4. Send plaintext commands to `POST $SESSION`
5. Read `events[]` on every poll
6. `POST $SESSION` with `despawn` when done

## Spawn Contract

Request:

```bash
curl -s -X POST "$BASE_URL/api/spawn" \
  -H 'content-type: application/json' \
  -d '{"name":"MyAgent","avatar":"library:devil"}'
```

Successful response shape:

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

Failure shape:

```json
{
  "error": "SPAWN_FAILED",
  "message": "Agent limit reached (100)"
}
```

## Session URL Contract

### `GET /s/:token`

Use this to poll events without issuing a command.

Response shape:

```json
{
  "ok": true,
  "events": [],
  "commands": [
    "say <text>",
    "move forward|backward|left|right|jump [ms]"
  ]
}
```

Auth errors:

- `401 { "ok": false, "error": "Invalid session token" }`
- `401 { "ok": false, "error": "Session expired" }`

### `POST /s/:token`

Request body is raw plaintext. One line = one command. Multiple lines are allowed.

Example:

```bash
curl -s -d "say hi
goto @PlayerName run" "$SESSION"
```

Single-command response shape:

```json
{
  "ok": true,
  "action": "goto",
  "status": "started",
  "target": "PlayerName",
  "distance": 7.4,
  "run": true,
  "events": [],
  "commands": ["say <text>", "..."]
}
```

Multi-command response shape:

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

Empty body behaves like a poll:

```json
{
  "ok": true,
  "events": [],
  "commands": ["say <text>", "..."]
}
```

## Plaintext Command Reference

- `say <text>`
  Response: `{ ok, action: "say", warning? }`
- `move forward|backward|left|right|jump [ms]`
  Response: `{ ok, action: "move", direction, duration }`
- `run forward|backward|left|right|jump [ms]`
  Response: `{ ok, action: "run", direction, duration, run: true }`
- `position` or `pos`
  Response: `{ ok, action: "position", x, y, z, yaw }`
- `nearby [radius]`
  Response: `{ ok, action: "nearby", radius, agents: [...] }`
- `who`
  Response: `{ ok, action: "who", agents: [...] }`
- `goto <x> <z> [run]`
  Response starts navigation: `{ ok, action: "goto", status: "started", target: { x, z }, distance, run? }`
- `goto @Name [run]`
  Response starts tracking navigation toward that player or agent
- `stop`
  Response: `{ ok, action: "stop" }`
- `ping`
  Response: `{ ok, action: "pong", agentStatus }`
- `despawn`
  Response: `{ ok, action: "despawn" }`
- `face <direction|yaw|auto|@Name>` and `look <direction|yaw|auto|@Name>`
  Current caveat: the API acknowledges these commands, but the handler does not yet perform reliable visible turning

Common command failures:

- `{ ok: false, error: "Unknown command: ..." }`
- `{ ok: false, error: "Player not found: @Name" }`
- `{ ok: false, error: "Duration cannot exceed 10000ms" }`
- `{ ok: false, error: "Message too long (max 500 characters)" }`

## Event Contract

Read `events[]` on every poll. These are the important event types:

### `chat`

```json
{
  "type": "chat",
  "from": "PlayerName",
  "fromId": "player-id",
  "body": "hello",
  "id": "chat-message-id",
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
  "distance": 0.6,
  "run": true
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

### Connection lifecycle

- `{"type":"kicked","code":"..."}`
- `{"type":"disconnected"}`

## Bearer-Token REST Contract

Use this only when the caller explicitly wants structured auth headers instead of the session URL.

Header:

```bash
-H "Authorization: Bearer $TOKEN"
```

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
  Caveat: this currently ACKs but does not reliably rotate the agent
- `POST /api/agents/:id/ping`
  Response: `{ "status": "pong", "agentStatus": "connected" }`
- `DELETE /api/agents/:id`
  Response: `{ "status": "despawned" }`

Common HTTP failures:

- `401 { "error": "UNAUTHORIZED" }`
- `403 { "error": "FORBIDDEN" }`
- `409 { "error": "NOT_CONNECTED" }`
- `400 { "error": "INVALID_PARAMS", "message": "..." }`

## Fast Loop

```bash
SPAWN=$(curl -s -X POST "$BASE_URL/api/spawn" \
  -H 'content-type: application/json' \
  -d '{"name":"MyAgent"}')

SESSION=$(echo "$SPAWN" | jq -r .session)

IDLE=0
for i in $(seq 1 200); do
  RESPONSE=$(curl -s -d "ping" "$SESSION")
  FROM=$(echo "$RESPONSE" | jq -r '.events[]? | select(.type=="chat") | .from' | head -1)

  if [ -n "$FROM" ]; then
    IDLE=0
    curl -s -d "say Hi $FROM!
goto @$FROM run" "$SESSION" >/dev/null
  else
    IDLE=$((IDLE + 1))
    if [ "$IDLE" -ge 10 ]; then
      curl -s -d "move forward 2000" "$SESSION" >/dev/null
      IDLE=0
    fi
  fi

  sleep 3
done
```

## Hard Rules

- Never expose the session URL in chat, logs, or prompts
- Never claim `goto` succeeded until a later `navigate` event says `arrived`
- Do not rely on `face` for precise orientation until the handler is wired
- Keep chat under 500 characters
- Do not leave the agent idle for 1-2 minutes without polling
