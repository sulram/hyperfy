---
name: gateway-agent
description: Use when an agent must act through the OpenClaw Hyperfy gateway. Know the real gateway envelopes, direct build endpoints, response wrapper from /action, and the mutation limits around build operations.
---

# Gateway Agent

You are operating through `src/xyz/openclaw-hyperfy-channel/serverPlugin.js`.

Use this skill when you need:

- OpenClaw <-> Hyperfy chat routing
- outbound replies through `/openclaw-gateway/outbound`
- voxel/build actions such as `build.perception`, `build.place`, `build.move`, and `build.remove`
- direct `curl` or HTTP access to the embedded gateway

## Reality Check

- `agents/` does not expose build APIs; build lives here
- Preferred external prefix: `/openclaw-gateway`
- `GET /openclaw-gateway/health` is open
- `/outbound`, `/action`, and all `/build/*` routes require `Authorization: Bearer <token>` when `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` is configured
- Build mutations are serialized; concurrent writes can return `409 BUILD_BUSY`
- Most build writes act on one cube per request
- The only bulk deletion route is `build.remove-all`
- Only `assetClassId=default-cube` is supported for `build.place`

## Choose the Right Envelope

### Inside Hyperfy/OpenClaw chat

Use `hyperfyAction`:

```json
{
  "hyperfyAction": {
    "type": "build.perception"
  }
}
```

### External HTTP client

Preferred wrapper:

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

Also accepted by `/action`:

- `{ "hyperfyAction": { ... } }`
- `{ "type": "build.place", "input": { ... } }`
- `params` instead of `input`

## Canonical Action Names

Prefer these names:

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

Aliases such as `catalog`, `snapshot`, `perception`, `clear`, `remove_all`, and `reposition_auto` are accepted, but do not lead with them.

If the intent is "clear all cubes", prefer `build.remove-all` in new prompts and clients.

## Gateway Build Model

- Grid coordinates are integer voxel cells: `{ x, y, z }`
- Voxel size is currently `1`
- Grid origin is currently `{ x: 0, y: 0, z: 0 }`
- Global cube cap comes from `OPENCLAW_GATEWAY_BUILD_MAX_CUBES`
- Per-column stack cap comes from `OPENCLAW_GATEWAY_BUILD_MAX_STACK_HEIGHT`
- Pinned cubes are protected
- `build.perception` is the safest read model for agents

## Operational Loop

1. Call `build.perception`
2. Read `limits`, `voxels`, `players`, and `carrying`
3. Choose `targetGrid`
4. If placing and `limits.remaining == 0`, do not call `build.place`
5. Use `build.move`, `build.remove`, or `build.reposition-auto` instead
6. After any mutation, read `build.perception` or inspect returned `limits`

## Direct Endpoints

### `GET /openclaw-gateway/health`

No auth unless your reverse proxy adds it.

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

Response:

```json
{
  "ok": true,
  "queued": 1,
  "queueDepth": 1,
  "truncatedByChunking": false
}
```

Rules:

- `text` is required
- long text is chunked into 500-character messages
- if `metadata.to` targets a player and `approachOnOutbound` is enabled, the gateway may navigate toward that player

## Read-Only Build Endpoints

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

`cubes[]` entries include:

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

This is the main agent-safe read model.

Returns:

- `grid.voxelSize`
- `grid.origin`
- `grid.maxStackHeight`
- `limits.maxCubes`
- `limits.currentCubes`
- `limits.remaining`
- `catalog[]` reduced to `{ id, voxel }`
- `voxels[]` reduced to `{ x, y, z, assetClassId }`
- `players[]`
- `carrying`

`players[]` entries include:

- `id`
- `name`
- `position`
- `grid`
- `isManagedAgent`
- `isGatewayAgent`

### `GET /openclaw-gateway/build/carry/status`

Returns:

```json
{
  "ok": true,
  "carrying": true,
  "carry": {
    "entityId": "cube-id",
    "moverToken": "carry:agent-id",
    "offset": { "forward": 1.1, "right": 0, "up": 1.0 },
    "intervalMs": 150,
    "position": { "x": 1, "y": 1, "z": 1 }
  }
}
```

## Mutation Endpoints

All mutation routes can return `409 BUILD_BUSY` if another build mutation is already in progress.

### `POST /openclaw-gateway/build/place`

Preferred request:

```json
{
  "targetGrid": { "x": 1, "y": 0, "z": 0 }
}
```

Also accepts `grid` or `voxel`.

Success:

```json
{
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
}
```

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

Source aliases accepted:

- `entityId`
- `fromGrid`
- `grid`
- `voxel`

Target aliases accepted:

- `targetGrid`
- `toGrid`
- `gridTo`

Success returns `moved`, `fromGrid`, `toGrid`, and `limits`.

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

Also accepts:

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

This is the only bulk deletion route.

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
- if no cube is specified, it picks the nearest non-pinned cube to the gateway agent

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

Success:

```json
{
  "ok": true,
  "carry": {
    "entityId": "cube-id",
    "moverToken": "carry:agent-id",
    "offset": { "forward": 1.1, "right": 0, "up": 1.0 },
    "intervalMs": 150
  },
  "carrying": true
}
```

Common failures:

- `404 NOT_FOUND`
- `409 PINNED`
- `409 AGENT_REQUIRED`
- `409 AGENT_NOT_READY`
- `409 VOXEL_OCCUPIED`

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
- if no carry exists, success returns `{ ok: true, carrying: false, carry: null }`

Success returns `stopped`, `entityId`, optional `position`, optional `grid`, plus `limits`.

### `POST /openclaw-gateway/build/reposition-auto`

Preferred request:

```json
{
  "targetGrid": { "x": 2, "y": 0, "z": 0 }
}
```

Optional fields:

- `entityId`
- `sourceGrid`
- `arrivalRadius`
- `timeoutMs`
- `run`
- `approachSource`
- `carryOffset`

Behavior:

1. optionally walks to the source cube
2. starts carry on that cube
3. navigates to the target voxel
4. drops the cube snapped to `targetGrid`

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

## `/action` Wrapper Contract

Endpoint:

- `POST /openclaw-gateway/action`

Preferred request:

```json
{
  "action": {
    "type": "build.move",
    "input": {
      "sourceGrid": { "x": 1, "y": 0, "z": 0 },
      "targetGrid": { "x": 2, "y": 0, "z": 0 }
    }
  }
}
```

Successful response shape:

```json
{
  "ok": true,
  "action": "build.move",
  "canonicalAction": "build.move",
  "result": {
    "ok": true,
    "moved": { "...": "..." },
    "fromGrid": { "x": 1, "y": 0, "z": 0 },
    "toGrid": { "x": 2, "y": 0, "z": 0 },
    "limits": { "maxCubes": 256, "currentCubes": 1, "remaining": 255 }
  },
  "statusCode": 200
}
```

Failure shape:

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
        "input": { "targetGrid": { "x": 1, "y": 0, "z": 0 } }
      }
    ],
    "hint": {
      "explanation": "The target voxel already has a cube.",
      "nextActions": ["build.perception", "choose another targetGrid", "build.place"]
    }
  }
}
```

Interpretation rules:

- use `statusCode` and `result.error`, not just `ok`
- if `help` is present, follow the canonical parameter names and examples there
- `/action` only forwards one action per request

## Fast Patterns

### Read world state

```bash
curl -s http://localhost:3000/openclaw-gateway/build/perception \
  -H 'authorization: Bearer change-me'
```

### Build through `/action`

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

### Direct route instead of `/action`

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/build/remove \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "targetGrid": { "x": 1, "y": 0, "z": 0 }
  }'
```

## Non-Negotiable Rules

- Use `build.perception` before the first mutation
- Use integer voxel coordinates
- Prefer `targetGrid` and `sourceGrid`
- Prefer canonical `build.*` names
- Do not call `build.place` when `limits.remaining == 0`
- Expect one cube mutation per request, except `build.remove-all`
- Retry sequentially, not in parallel, because mutations are serialized
- Keep in-world status messages short and plain text
