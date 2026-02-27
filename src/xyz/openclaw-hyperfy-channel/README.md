# OpenClaw Hyperfy Channel

Guide for the gateway project that connects Hyperfy chat and voxel/build actions to OpenClaw.

Inside `src/xyz`, the responsibility split is:

- `agents/` controls headless Hyperfy agents directly over HTTP, REST, or WebSocket and does not expose build APIs
- `openclaw-hyperfy-channel/` owns the OpenClaw integration, outbound replies, and the build gateway under `/openclaw-gateway/*`

## What This Project Contains

- `serverPlugin.js` - the embedded gateway that runs inside the Hyperfy server process
- `hyperfy-channel/` - the OpenClaw plugin scaffold that posts back into that gateway
- `../skills/gateway-agent/SKILL.md` - the operational contract for gateway clients and agents

These are the runtime pieces that matter:

- `serverPlugin.js` runs inside Hyperfy and exposes `/openclaw-gateway/*`
- `hyperfy-channel/` runs inside OpenClaw and sends `/outbound` and `/action` requests back to Hyperfy

## Scope Boundary

This project owns:

- forwarding Hyperfy chat to OpenClaw
- sending OpenClaw replies back into Hyperfy
- spawning and managing the gateway bot
- direct external HTTP access to the gateway
- voxel/build reads and mutations

This project does not own:

- the direct `agents/` session API
- agent spawn via `/api/spawn`
- movement/session control for arbitrary headless agents

## Architecture

Typical round trip:

1. a player speaks in Hyperfy
2. the embedded gateway receives that chat
3. the gateway forwards it to `OPENCLAW_HOOK_URL`
4. OpenClaw decides to answer through the `hyperfy` channel
5. the `hyperfy-channel` plugin sends `POST /openclaw-gateway/outbound`
6. the gateway speaks through its managed Hyperfy bot

The same gateway also exposes a build API and a higher-level `/action` wrapper for voxel operations.

## Process Split

Even when both programs run on the same machine, there are 2 distinct processes:

- Hyperfy process
  Owns `ENABLE_OPENCLAW_GATEWAY`, `OPENCLAW_*`, `OPENCLAW_GATEWAY_*`, and the embedded `serverPlugin.js`
- OpenClaw process
  Owns `openclaw.json` and the `hyperfy-channel` plugin config

Use this split:

- Hyperfy env vars configure outbound calls from Hyperfy to OpenClaw
- OpenClaw plugin config controls outbound calls from OpenClaw back to Hyperfy

## Quick Setup

### Hyperfy server

Minimum environment:

```bash
ENABLE_OPENCLAW_GATEWAY=1
OPENCLAW_HOOK_URL=http://127.0.0.1:3001/hooks/agent
OPENCLAW_AGENT=hyperfy-bot
```

Recommended auth:

```bash
OPENCLAW_GATEWAY_OUTBOUND_TOKEN=change-me
```

### OpenClaw plugin

In `openclaw.json`:

```json5
{
  "plugins": {
    "entries": {
      "hyperfy-channel": {
        "enabled": true,
        "config": {
          "bridgeUrl": "http://127.0.0.1:3000/openclaw-gateway",
          "bridgeToken": "change-me"
        }
      }
    }
  }
}
```

### Manual checks

Health:

```bash
curl -s http://localhost:3000/openclaw-gateway/health
```

Outbound:

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/outbound \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{"text":"Test coming from OpenClaw"}'
```

Perception:

```bash
curl -s http://localhost:3000/openclaw-gateway/build/perception \
  -H 'authorization: Bearer change-me'
```

## Pairing Rules

In practice, 3 things must line up:

1. security pairing
   `plugins.entries.hyperfy-channel.config.bridgeToken`
   must match
   `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` or `BRIDGE_OUTBOUND_TOKEN`
2. agent pairing
   `OPENCLAW_AGENT` chooses which OpenClaw agent receives forwarded Hyperfy chat
3. channel pairing
   `OPENCLAW_GATEWAY_CHANNEL_ID` and `OPENCLAW_GATEWAY_CHANNEL_NAME`
   define how the Hyperfy side appears inside OpenClaw

## Environment Variables

### Required

- `ENABLE_OPENCLAW_GATEWAY`
- `OPENCLAW_HOOK_URL`
- `OPENCLAW_AGENT`

### Security and auth

- `OPENCLAW_GATEWAY_OUTBOUND_TOKEN`
- `BRIDGE_OUTBOUND_TOKEN` - legacy fallback alias
- `OPENCLAW_HOOK_BEARER_TOKEN`
- `OPENCLAW_WEBHOOK_SECRET`

### Gateway bot identity

- `OPENCLAW_GATEWAY_AGENT_NAME`
- `OPENCLAW_GATEWAY_AGENT_AVATAR`

### Channel identity

- `OPENCLAW_GATEWAY_CHANNEL_ID`
- `OPENCLAW_GATEWAY_CHANNEL_NAME`

### Timeouts and behavior

- `OPENCLAW_GATEWAY_PREFIX` - default `/openclaw-gateway`
- `OPENCLAW_GATEWAY_TIMEOUT_MS` - outbound OpenClaw webhook timeout, default `15000`
- `OPENCLAW_GATEWAY_DEBUG`
- `OPENCLAW_GATEWAY_IDLE_WANDER`
- `OPENCLAW_GATEWAY_IDLE_AFTER_MS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_INTERVAL_MS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_JITTER_MS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_MIN_RADIUS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_MAX_RADIUS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_ARRIVAL_RADIUS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_TIMEOUT_MS`
- `OPENCLAW_GATEWAY_IDLE_WANDER_RUN`

### Build limits

- `OPENCLAW_GATEWAY_BUILD_MAX_CUBES` - default `256`
- `OPENCLAW_GATEWAY_BUILD_MAX_STACK_HEIGHT` - default `4`

## OpenClaw Plugin Config

The OpenClaw scaffold uses `api.pluginConfig`, not environment variables.

Fields under `plugins.entries.hyperfy-channel.config`:

- `bridgeUrl` - required gateway base URL
- `bridgeToken` - optional bearer token for `/outbound`, `/action`, and `/build/*`

## Endpoint Summary

Default prefix: `/openclaw-gateway`

Open endpoint:

- `GET /openclaw-gateway/health`

Protected when a token is configured:

- `POST /openclaw-gateway/outbound`
- `POST /openclaw-gateway/action`
- `GET /openclaw-gateway/build/catalog`
- `GET /openclaw-gateway/build/snapshot`
- `GET /openclaw-gateway/build/perception`
- `GET /openclaw-gateway/build/carry/status`
- `POST /openclaw-gateway/build/place`
- `POST /openclaw-gateway/build/move`
- `POST /openclaw-gateway/build/remove`
- `POST /openclaw-gateway/build/remove-all`
- `POST /openclaw-gateway/build/carry/start`
- `POST /openclaw-gateway/build/carry/stop`
- `POST /openclaw-gateway/build/reposition-auto`

## Build Model

The build layer treats the Hyperfy default cube as one canonical asset class and exposes a voxel contract on top of it.

Current model:

- `assetClassId`: `default-cube`
- voxel size: `1`
- grid origin: `{ x: 0, y: 0, z: 0 }`
- stack cap per `(x,z)` column: `OPENCLAW_GATEWAY_BUILD_MAX_STACK_HEIGHT`
- global cap: `OPENCLAW_GATEWAY_BUILD_MAX_CUBES`
- pinned cubes are protected

Important operational rules:

- almost every write mutates one cube per request
- the only bulk deletion route is `build/remove-all`
- build writes are serialized; concurrent writes return `409 BUILD_BUSY`
- `build.place` only supports `assetClassId=default-cube`

## `/health` Contract

### `GET /openclaw-gateway/health`

Response shape:

```json
{
  "status": "ok",
  "gateway": {
    "enabled": true,
    "spawning": false,
    "queued": 0,
    "lastSpawnAt": null,
    "lastForwardAt": null,
    "lastError": null,
    "lastInteractionAt": "2026-02-27T12:34:56.000Z",
    "idleWanderEnabled": false,
    "idleWanderInFlight": false
  },
  "build": {
    "enabled": true,
    "maxCubes": 256,
    "currentCubes": 0,
    "remaining": 256,
    "catalogSize": 1,
    "carry": null,
    "autoRepositionInFlight": false
  },
  "hyperfyAgent": null
}
```

## `/outbound` Contract

### `POST /openclaw-gateway/outbound`

Request:

```json
{
  "text": "hello from OpenClaw",
  "metadata": {
    "to": "hyperfy:player:player-id:PlayerName"
  }
}
```

Rules:

- `text` is required
- long text is chunked to 500-character chat messages
- if `metadata.to` targets a Hyperfy player and `approachOnOutbound` is enabled, the gateway may move the bot toward that player

Success response:

```json
{
  "ok": true,
  "queued": 1,
  "queueDepth": 1,
  "truncatedByChunking": false
}
```

Failure example:

```json
{
  "error": "INVALID_PARAMS",
  "message": "text is required"
}
```

## `/action` Contract

### Envelope

The action router accepts exactly one action per request.

Preferred body:

```json
{
  "action": {
    "type": "build.place",
    "input": {
      "targetGrid": { "x": 1, "y": 0, "z": 0 }
    }
  }
}
```

Also accepted:

- `{ "hyperfyAction": { ... } }`
- `{ "type": "build.place", "input": { ... } }`
- `params` instead of `input`

### Supported canonical action names

- `build.catalog`
- `build.snapshot`
- `build.perception`
- `build.carry.status`
- `build.carry.start`
- `build.carry.stop`
- `build.reposition-auto`
- `build.place`
- `build.move`
- `build.remove`
- `build.remove-all`

Compatibility aliases exist, including:

- `catalog`
- `snapshot`
- `perception`
- `carry.status`
- `carry.start`
- `carry.stop`
- `place`
- `move`
- `remove`
- `clear`
- `remove_all`
- `reposition_auto`

Prefer canonical `build.*` names in docs and prompts.
If the intent is "clear all cubes", prefer `build.remove-all` in new clients.

### Successful response shape

```json
{
  "ok": true,
  "action": "build.place",
  "canonicalAction": "build.place",
  "result": {
    "ok": true,
    "placed": {
      "entityId": "cube-id",
      "assetClassId": "default-cube",
      "grid": { "x": 1, "y": 0, "z": 0 },
      "position": { "x": 1, "y": 0, "z": 0 }
    },
    "limits": {
      "maxCubes": 256,
      "currentCubes": 1,
      "remaining": 255
    }
  },
  "statusCode": 200
}
```

### Failure response shape

```json
{
  "ok": false,
  "action": "place",
  "canonicalAction": "build.place",
  "result": {
    "error": "VOXEL_OCCUPIED",
    "message": "Target voxel is already occupied"
  },
  "statusCode": 409,
  "help": {
    "requestedType": "place",
    "canonicalType": "build.place",
    "examples": [
      {
        "type": "build.place",
        "input": {
          "targetGrid": { "x": 1, "y": 0, "z": 0 }
        }
      }
    ]
  }
}
```

Interpretation rules:

- trust `statusCode` and `result.error`
- if `help` is present, use the canonical parameter names there
- `/action` is a wrapper around the direct routes, not a batch API

## Direct Build API Contracts

### `GET /openclaw-gateway/build/catalog`

Returns:

- `catalog[]` with `id`, `label`, `source`, `voxel`, `blueprintSignature`
- `limits.maxCubes`
- `limits.maxStackHeight`
- `grid.voxelSize`
- `grid.origin`

### `GET /openclaw-gateway/build/snapshot`

Returns:

- `catalog[]`
- `limits`
- `grid`
- `cubes[]`
- `evictionCandidates[]`

Each `cubes[]` item includes:

- `entityId`
- `assetClassId`
- `blueprintId`
- `blueprintName`
- `position`
- `grid`
- `quaternion`
- `scale`
- `pinned`
- `mover`
- `uploader`
- `createdAt`

### `GET /openclaw-gateway/build/perception`

This is the main read model for agents.

Response:

```json
{
  "ok": true,
  "grid": {
    "voxelSize": 1,
    "origin": { "x": 0, "y": 0, "z": 0 },
    "maxStackHeight": 4
  },
  "limits": {
    "maxCubes": 256,
    "currentCubes": 1,
    "remaining": 255
  },
  "catalog": [
    {
      "id": "default-cube",
      "voxel": {
        "size": [1, 1, 1],
        "stackable": true,
        "maxStackHeight": 4
      }
    }
  ],
  "voxels": [
    { "x": 1, "y": 0, "z": 0, "assetClassId": "default-cube" }
  ],
  "players": [
    {
      "id": "player-id",
      "name": "PlayerName",
      "position": { "x": 0, "y": 0, "z": 0 },
      "grid": { "x": 0, "y": 0, "z": 0 },
      "isManagedAgent": false,
      "isGatewayAgent": false
    }
  ],
  "carrying": false
}
```

### `GET /openclaw-gateway/build/carry/status`

Returns:

- `carrying`
- `carry.entityId`
- `carry.moverToken`
- `carry.offset`
- `carry.intervalMs`
- `carry.position`

## Mutation Contracts

### `POST /openclaw-gateway/build/place`

Preferred request:

```json
{
  "targetGrid": { "x": 1, "y": 0, "z": 0 }
}
```

Also accepted:

- `grid`
- `voxel`
- optional `assetClassId`, but it must still be `default-cube`

Success returns `placed` and `limits`.

Common failures:

- `400 INVALID_PARAMS`
- `409 VOXEL_OCCUPIED`
- `409 MAX_STACK_HEIGHT_REACHED`
- `409 MAX_CUBES_REACHED`
- `500 DEFAULT_CUBE_NOT_FOUND`

### `POST /openclaw-gateway/build/move`

Preferred request:

```json
{
  "sourceGrid": { "x": 1, "y": 0, "z": 0 },
  "targetGrid": { "x": 2, "y": 0, "z": 0 }
}
```

Source selectors accepted:

- `entityId`
- `sourceGrid`
- `fromGrid`
- `grid`
- `voxel`

Target selectors accepted:

- `targetGrid`
- `toGrid`
- `gridTo`

Success returns:

- `moved`
- `fromGrid`
- `toGrid`
- `limits`

Common failures:

- `400 INVALID_PARAMS`
- `404 NOT_FOUND`
- `409 CARRY_ACTIVE`
- `409 PINNED`
- `409 VOXEL_OCCUPIED`
- `409 MAX_STACK_HEIGHT_REACHED`

### `POST /openclaw-gateway/build/remove`

Preferred request:

```json
{
  "targetGrid": { "x": 1, "y": 0, "z": 0 }
}
```

Also accepted:

- `entityId`
- `grid`
- `sourceGrid`
- `voxel`

Success returns `removed` and `limits`.

Common failures:

- `400 INVALID_PARAMS`
- `404 NOT_FOUND`
- `409 CARRY_ACTIVE`
- `409 PINNED`

### `POST /openclaw-gateway/build/remove-all`

This is the only bulk mutation route.

Success returns:

- `removed[]`
- `removedCount`
- `skippedPinned[]`
- `skippedPinnedCount`
- `failed[]`
- `failedCount`
- `limits`

### `POST /openclaw-gateway/build/carry/start`

Behavior:

- grabs an existing cube
- does not create a cube
- if no cube is specified, it selects the nearest movable cube to the gateway agent

Accepted selectors:

- `entityId`
- `sourceGrid`
- `grid`
- `targetGrid`
- `voxel`

Optional:

- `offset.forward`
- `offset.right`
- `offset.up`

Success returns:

- `carry.entityId`
- `carry.moverToken`
- `carry.offset`
- `carry.intervalMs`
- `carrying: true`

### `POST /openclaw-gateway/build/carry/stop`

Optional request:

```json
{
  "targetGrid": { "x": 2, "y": 0, "z": 0 },
  "snapToGrid": true
}
```

Rules:

- `snapToGrid` defaults to `true`
- if nothing is being carried, success returns `{ ok: true, carrying: false, carry: null }`

Success returns:

- `stopped`
- `entityId`
- optional `position`
- optional `grid`
- `limits`

### `POST /openclaw-gateway/build/reposition-auto`

Preferred request:

```json
{
  "targetGrid": { "x": 2, "y": 0, "z": 0 }
}
```

Optional inputs:

- `entityId`
- `sourceGrid`
- `arrivalRadius`
- `timeoutMs`
- `run`
- `approachSource`
- `carryOffset`

Behavior:

1. optionally navigate to the source cube
2. start carry
3. navigate to the target voxel
4. drop and snap to `targetGrid`

Success returns:

- `targetGrid`
- `targetWorld`
- `selected`
- `pickupNavigate`
- `carryStarted`
- `navigate`
- `placed`
- `limits`

Common failures:

- `400 INVALID_PARAMS`
- `404 NOT_FOUND`
- `409 BUILD_BUSY`
- `409 VOXEL_OCCUPIED`
- `409 MAX_STACK_HEIGHT_REACHED`
- `409 AGENT_NOT_READY`
- `409 PICKUP_NAVIGATION_FAILED`
- `409 NAVIGATION_FAILED`

## Common Error Codes

Global or routing:

- `UNAUTHORIZED`
- `BUILD_DISABLED`
- `WORLD_UNAVAILABLE`
- `UNSUPPORTED_ACTION`

Build mutation flow:

- `BUILD_BUSY`
- `INVALID_PARAMS`
- `NOT_FOUND`
- `PINNED`
- `CARRY_ACTIVE`
- `VOXEL_OCCUPIED`
- `MAX_STACK_HEIGHT_REACHED`
- `MAX_CUBES_REACHED`
- `DEFAULT_CUBE_NOT_FOUND`
- `AGENT_REQUIRED`
- `AGENT_NOT_READY`
- `PICKUP_NAVIGATION_FAILED`
- `NAVIGATION_FAILED`

## Recommended Agent Flow

1. read `build.perception`
2. decide in voxel coordinates
3. write one mutation
4. inspect `limits` or refresh `build.perception`
5. continue sequentially

If you need to create multiple cubes, send multiple sequential requests. The gateway does not support a general multi-place batch endpoint today.

## Direct cURL Examples

Read perception:

```bash
curl -s http://localhost:3000/openclaw-gateway/build/perception \
  -H 'authorization: Bearer change-me'
```

Place via `/action`:

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/action \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "action": {
      "type": "build.place",
      "input": {
        "targetGrid": { "x": 1, "y": 0, "z": 0 }
      }
    }
  }'
```

Move via direct route:

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/build/move \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "sourceGrid": { "x": 1, "y": 0, "z": 0 },
    "targetGrid": { "x": 2, "y": 0, "z": 0 }
  }'
```

## Plugin Scaffold

The OpenClaw-side scaffold is documented briefly in `hyperfy-channel/README.md`. The main API contract remains this file, and the operational prompt lives in `../skills/gateway-agent/SKILL.md`.
