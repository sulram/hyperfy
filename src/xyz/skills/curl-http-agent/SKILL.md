---
name: curl-http-agent
description: Use when an agent must control Hyperfy directly over the HTTP/session interface. Spawn first, poll every few seconds, navigate with plaintext commands, and never leak the session URL.
---

# cURL HTTP Agent

You are controlling a Hyperfy agent through the HTTP/session interface.

## Core Rules

- Spawn first, then save the returned `session` URL.
- Poll every 3 seconds with `ping` or `GET $SESSION`.
- Never reveal the session URL or token.
- Prefer the session URL interface unless the user explicitly asks for bearer-token REST calls.
- Treat `goto` as asynchronous: success or failure comes back in later `navigate` events.

## Session Lifecycle

### Spawn

```bash
SPAWN=$(curl -s -X POST "$BASE_URL/api/spawn" \
  -H 'Content-Type: application/json' \
  -d '{"name":"MyAgent"}')

SESSION=$(echo "$SPAWN" | jq -r .session)
```

### Poll immediately

```bash
for i in $(seq 1 200); do
  RESPONSE=$(curl -s -d "ping" "$SESSION")
  echo "$RESPONSE" | jq .
  sleep 3
done
```

### Despawn

```bash
curl -s -d "despawn" "$SESSION"
```

## Primary Commands

- `say <text>`
- `move forward|backward|left|right|jump [ms]`
- `run forward|backward|left|right [ms]`
- `face left|right|forward|backward|auto|@Name|<yaw>`
- `position`
- `nearby [radius]`
- `goto <x> <z> [run]`
- `goto @Name [run]`
- `who`
- `ping`
- `stop`
- `despawn`

Multiple commands can be sent in one request with newlines:

```bash
curl -s -d "say I am coming to you!
goto @PlayerName run" "$SESSION"
```

## Default Behavior

1. Spawn if you are not already in-world.
2. Start a polling loop right away.
3. On chat, reply briefly and move closer with `goto @from run`.
4. If idle for too long, move or ask a short question so the agent does not look dead.

## Event Handling

Read `events[]` from every response.

Important types:

- `chat`
- `navigate`
- `proximity`

Navigation examples:

- `{"type":"navigate","status":"started"}`
- `{"type":"navigate","status":"arrived","distance":1.5}`
- `{"type":"navigate","status":"failed","error":"Navigation timeout"}`

## Recommended Loop

```bash
IDLE=0
for i in $(seq 1 200); do
  RESPONSE=$(curl -s -d "ping" "$SESSION")
  FROM=$(echo "$RESPONSE" | jq -r '.events[]? | select(.type=="chat") | .from' | head -1)

  if [ -n "$FROM" ]; then
    IDLE=0
    curl -s -d "say Hi $FROM!
goto @$FROM run" "$SESSION"
  else
    IDLE=$((IDLE + 1))
    if [ "$IDLE" -ge 10 ]; then
      curl -s -d "move forward 2000" "$SESSION"
      IDLE=0
    fi
  fi

  sleep 3
done
```

## Safety Rules

- Do not expose session URLs in chat or logs.
- Do not claim navigation succeeded until a `navigate` event says `arrived`.
- Do not stay idle for 1-2 minutes.
- Do not spam chat; keep replies short and natural.
