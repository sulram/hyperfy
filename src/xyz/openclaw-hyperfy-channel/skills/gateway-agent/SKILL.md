---
name: gateway-agent
description: Use when an agent must act through the OpenClaw Hyperfy gateway. Prefer `hyperfyAction` inside Hyperfy chat, use `build.perception` before build actions, and use `/openclaw-gateway/action` only for external HTTP clients.
---

# Gateway Agent

You are operating through the OpenClaw Hyperfy gateway.

## Scope

This skill covers:

- OpenClaw agents replying through the `hyperfy-channel`
- in-world Hyperfy chat agents that can send `hyperfyAction`
- external HTTP/cURL clients calling `/openclaw-gateway/action`

## Transport Selection

- If you are acting inside Hyperfy through OpenClaw, use `hyperfyAction`.
- If you are an external script or cURL client, use `POST /openclaw-gateway/action` with `action`.
- Do not ask in-world users for bearer tokens during normal building.
- If you see `401` while acting from Hyperfy chat, stop using the HTTP route and retry as `hyperfyAction`.

## Non-Negotiable Rules

- Think in voxel coordinates `x,y,z`.
- Use `build.perception` before acting.
- Prefer canonical `build.*` action names.
- Use `targetGrid` for destination and `sourceGrid` for origin.
- Keep in-world chat replies short plain text.
- Do not say an action "does not work" unless you include raw gateway error fields.

## Main Build Loop

1. Call `build.perception`
2. Choose `targetGrid`
3. If `limits.remaining > 0`, call `build.place`
4. If `limits.remaining == 0`, call `build.remove`, `build.move`, or `build.reposition-auto`
5. Repeat

## Fast Execution Pattern

1. Read `build.perception`
2. Act immediately
3. Only then send a short status message

Do not write long diagnostics before trying the action.

## Canonical Actions

### `build.perception`

Read voxel map, limits, and `players[]` first.

```json
{
  "hyperfyAction": {
    "type": "build.perception"
  }
}
```

### `build.place`

Use when `limits.remaining > 0`.

```json
{
  "hyperfyAction": {
    "type": "build.place",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

### `build.remove`

Remove one cube by voxel.

```json
{
  "hyperfyAction": {
    "type": "build.remove",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

### `build.reposition-auto`

Let the gateway choose a managed cube and relocate it automatically.

```json
{
  "hyperfyAction": {
    "type": "build.reposition-auto",
    "input": {
      "targetGrid": { "x": 4, "y": 0, "z": 2 }
    }
  }
}
```

### `build.clear`

Clear all managed cubes only when explicitly requested.

```json
{
  "hyperfyAction": {
    "type": "build.clear"
  }
}
```

## External HTTP Shape

For external HTTP clients, switch only the envelope:

```json
{
  "action": {
    "type": "build.place",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

Endpoint:

- `POST /openclaw-gateway/action`

## Constraints

- Cube cap exists in `limits.maxCubes`
- Do not call `build.place` when `limits.remaining == 0`
- Target voxel must be free
- Stack height per column is limited
- `build.place` accepts `targetGrid` as the preferred destination field
- `build.remove` accepts `targetGrid` as the preferred target field
- `build.move` prefers `{ sourceGrid, targetGrid }`

## Error Handling

When an action fails, report:

- `statusCode`
- `result.error`
- `result.message`
- `help` when present

### Retry Rules

- `VOXEL_OCCUPIED` -> retry with a different `targetGrid` up to 3 times
- `MAX_STACK_HEIGHT_REACHED` -> choose another column and retry
- `INVALID_PARAMS` -> fix payload using `help.examples`, retry once
- `UNAUTHORIZED` in Hyperfy chat -> switch from HTTP `action` to `hyperfyAction`

### Failure Template

Use this exact shape:

`build.place failed | status=409 | error=VOXEL_OCCUPIED | message=Target voxel is already occupied`

If `help.hint` exists, add one short line:

`next: choose another targetGrid and retry`

## Message Policy

- Plain text only while building
- No Markdown in live chat replies
- No long explanations unless the user asked for debugging help
- Prefer one-line status updates:
  - `placed cube at (12,0,4)`
  - `voxel occupied at (12,0,4), trying another position`
  - `build.place failed | status=409 | error=VOXEL_OCCUPIED | message=Target voxel is already occupied`
