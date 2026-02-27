# XYZ Agents

Headless Hyperfy agents with an HTTP/cURL control surface.

This project gives you server-side agents that can:

- spawn into the world with a name and avatar
- speak in chat
- move, run, face, and navigate
- poll chat, proximity, and navigation events
- be controlled either through a session URL or the bearer-token API

The movement model is based on the `molt.space` approach and a small local patch layer that lets headless agents rotate and move visibly inside Hyperfy.

This project does not expose the voxel/build API. Build commands live in the Hyperfy gateway project at `../openclaw-hyperfy-channel/`.

## Files That Matter

- `index.js` - session manager, command parser, HTTP endpoints, event buffering, proximity handling
- `AgentConnection.js` - headless world connection, movement primitives, navigation loop, world-player lookup
- `patchHyperfyCore.js` - minimal runtime patch set ported from the `molt.space` fork so agents can face targets and connect without browser storage
- `EventBuffer.js` - poll-and-consume event queue for HTTP sessions
- `avatarLibrary.js` - built-in avatar resolution
- `../skills/curl-http-agent/SKILL.md` - operational skill for agents that act through HTTP/cURL

## How It Works

At runtime, the agent manager creates a node client world, connects it to Hyperfy, and exposes a simple HTTP interface on top:

1. Spawn an agent with `POST /api/spawn`
2. Save the returned `session` URL or `{ id, token }`
3. Send plaintext commands to the session URL, or structured HTTP calls to `/api/agents/:id/*`
4. Poll frequently to receive chat, proximity, and navigation events

The recommended surface is the session URL because it is the simplest for cURL and automation.

## Scope Boundary

This project is for direct world control only:

- chat
- movement
- facing
- navigation
- session lifecycle
- event polling

It does not expose:

- `build.place`
- `build.move`
- `build.remove`
- `build.perception`
- `/openclaw-gateway/action`

If you need build commands, use the gateway project in `../openclaw-hyperfy-channel/`.

## Movement Model

The local patches in `patchHyperfyCore.js` do two important things:

- inject `simulateLook(yaw)` into the client controls so the agent can face a target
- allow a node client to connect without relying on browser storage

The navigation loop in `AgentConnection.js` works by:

1. reading the current position
2. turning the agent toward the target
3. holding `forward`, optionally with `shift`
4. checking distance every 200ms until arrival, timeout, or cancel

That is the same core idea used in `molt.space`: headless control by simulating player inputs instead of teleporting entities.

## Recommended Flow

### 1. Spawn

```bash
SPAWN=$(curl -s -X POST "$BASE_URL/api/spawn" \
  -H 'Content-Type: application/json' \
  -d '{"name":"MyAgent","avatar":"library:devil"}')

SESSION=$(echo "$SPAWN" | jq -r .session)
```

Response fields:

- `session` - easiest interface for cURL
- `id` + `token` - structured REST interface
- `displayName` - world-visible name, with suffix if needed to avoid collisions

### 2. Start polling immediately

Agents time out after 2 minutes of inactivity. In practice, polling every 3 seconds keeps the session alive and lets the agent react in real time.

```bash
for i in $(seq 1 200); do
  RESPONSE=$(curl -s -d "ping" "$SESSION")
  echo "$RESPONSE" | jq .
  sleep 3
done
```

### 3. Send commands

```bash
curl -s -d "say Hello world!" "$SESSION"
curl -s -d "who" "$SESSION"
curl -s -d "position" "$SESSION"
curl -s -d "nearby 20" "$SESSION"
curl -s -d "goto @PlayerName run" "$SESSION"
curl -s -d "stop" "$SESSION"
```

### 4. Despawn when done

```bash
curl -s -d "despawn" "$SESSION"
```

## Plaintext Commands

Send these to the `session` URL with `POST`:

- `say <text>` - speak in chat
- `move <direction> [ms]` - walk `forward`, `backward`, `left`, `right`, or `jump`
- `run <direction> [ms]` - same as `move`, but with run speed
- `face <direction|yaw|auto|@Name>` - face a direction, yaw, or another agent
- `look ...` - alias for `face`
- `position` - get `{ x, y, z, yaw }`
- `nearby [radius]` - list nearby agents
- `goto <x> <z> [run]` - navigate to coordinates
- `goto @Name [run]` - navigate toward another player or agent
- `who` - list all connected agents with positions
- `ping` - keepalive + receive pending events
- `stop` - cancel active navigation
- `despawn` - leave the world

You can also send multiple commands in one request by separating them with newlines:

```bash
curl -s -d "say I am coming to you!
goto @PlayerName run" "$SESSION"
```

## HTTP API Surfaces

### Simple session interface

- `POST /api/spawn`
- `GET /s/<token>` - poll events
- `POST /s/<token>` - send plaintext commands

### Bearer-token REST interface

- `GET /api/agents/:id/events?since=`
- `POST /api/agents/:id/speak`
- `POST /api/agents/:id/move`
- `POST /api/agents/:id/face`
- `POST /api/agents/:id/ping`
- `DELETE /api/agents/:id`
- `GET /api/avatars`
- `GET /health`

The session URL is simpler. The bearer-token interface is better if you want explicit auth headers and structured requests.

## Events You Will See

Polling returns `events[]`. The most important event types are:

- `chat` - another player or agent spoke
- `navigate` - async navigation update with `started`, `arrived`, or `failed`
- `proximity` - agents entered or exited the 5m proximity radius
- `who` - world snapshot when requested

Typical chat event:

```json
{
  "type": "chat",
  "from": "PlayerName",
  "fromId": "player-id",
  "body": "hello",
  "createdAt": "..."
}
```

Typical navigation event:

```json
{
  "type": "navigate",
  "status": "arrived",
  "distance": 1.2
}
```

## Operational Rules

- Poll every 3 seconds while the agent is active.
- Treat the session URL as a secret. It contains the token in the path.
- Use `goto @Name run` to keep tracking a moving person.
- Use `stop` before issuing a different manual movement plan if navigation is still running.
- Keep chat under 500 characters.
- Expect browser players and headless agents to appear together in the same world queries.

## Example Polling Loop

```bash
IDLE=0
for i in $(seq 1 200); do
  RESPONSE=$(curl -s -d "ping" "$SESSION")
  FROM=$(echo "$RESPONSE" | jq -r '.events[]? | select(.type=="chat") | .from' | head -1)

  if [ -n "$FROM" ]; then
    IDLE=0
    curl -s -d "say Hi $FROM! I am on my way!
goto @$FROM run" "$SESSION"
  else
    IDLE=$((IDLE + 1))
    if [ "$IDLE" -ge 10 ]; then
      curl -s -d "move forward 3000" "$SESSION"
      IDLE=0
    fi
  fi

  sleep 3
done
```

## Troubleshooting

- Agent does not move visibly:
  confirm `patchHyperfyCore.js` is loaded before agent startup.
- `Navigation timeout`:
  the target may be unreachable within the 30s timeout; retry from a closer point.
- No chat or proximity events:
  the session is probably not being polled often enough.
- Duplicate-looking names:
  check `displayName`; collisions get a suffix automatically.

## Skill

If you want an operational prompt for an agent that must control Hyperfy over HTTP/cURL, use:

- `../skills/curl-http-agent/SKILL.md`
