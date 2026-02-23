---
name: hyperfy-voxel-builder
description: Use when an agent needs to build or rearrange Hyperfy default cubes as voxels via the OpenClaw Hyperfy gateway, including both OpenClaw agents using the hyperfy-channel plugin (hyperfyAction) and external agents using curl/HTTP (/action). Read voxel perception, use build.place while capacity remains, then build.reposition-auto when the cube cap is reached.
---

# Hyperfy Voxel Builder

Treat the world as a voxel grid of cubes.

## Agent types supported

- `OpenClaw + hyperfy-channel`:
  send structured payloads with `hyperfyAction`
- `External agent (curl/HTTP)`:
  call `POST /openclaw-gateway/action` with `action`

## Rule

- Think in voxel coordinates `x,y,z`.
- Do not reason in terms of entity IDs unless debugging.
- Read perception first, choose a target voxel, then ask the gateway to execute.
- Prefer `/action` with `build.*` commands.
- Use `result.players[]` from `build.perception` to locate named players (name + world position + voxel grid).

## Main loop

1. Call `build.perception`
2. Find a free voxel target
3. If `limits.remaining > 0`, call `build.place`
4. If `limits.remaining == 0`, call `build.reposition-auto`
5. Repeat

## Preferred actions (via gateway `/action`)

### Read voxel perception

```json
{
  "action": {
    "type": "build.perception"
  }
}
```

### Move the next cube automatically to a voxel

```json
{
  "action": {
    "type": "build.reposition-auto",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

### Create a new cube in a voxel (spawns cube)

```json
{
  "action": {
    "type": "build.place",
    "input": {
      "grid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

## Manual/debug actions (optional)

- `build.snapshot`
- `build.carry.status`
- `build.carry.start`
- `build.carry.stop`
- `build.move`
- `build.place`
- `build.remove`
- `build.clear` (alias of remove-all)

### Remove one cube by voxel (no entityId needed)

```json
{
  "action": {
    "type": "build.remove",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

### Remove all cubes

```json
{
  "action": {
    "type": "build.clear"
  }
}
```

## Constraints to respect

- Cube cap exists (`limits.maxCubes`)
- If `limits.remaining == 0`, do not call `build.place`; use `build.reposition-auto` or `build.remove`
- Target voxel must be free
- Stack height per column is limited
- `build.remove` accepts voxel coordinates (`grid`, `targetGrid`, `sourceGrid`, or `voxel`) or `entityId`

## Error handling (required)

- `MAX_CUBES_REACHED`: switch to `build.reposition-auto` (or `build.remove`)
- `VOXEL_OCCUPIED`: choose another voxel
- `MAX_STACK_HEIGHT_REACHED`: choose another voxel/column
- `NAVIGATION_FAILED`: retry with a closer voxel or different target

## OpenClaw plugin payload (`hyperfyAction`)

If using the `hyperfy-channel` plugin, send:

```json
{
  "hyperfyAction": {
    "type": "build.perception"
  }
}
```

or:

```json
{
  "hyperfyAction": {
    "type": "build.place",
    "input": {
      "grid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

or:

```json
{
  "hyperfyAction": {
    "type": "build.reposition-auto",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

## Quick policy

- Grow structure: `build.place`
- Reorganize structure at cap: `build.reposition-auto`
- Delete one: `build.remove` with `targetGrid`
- Delete all: `build.clear`
- Debug/manual only: `build.move`, `build.carry.*`, `build.snapshot`

## Endpoint reminder (external agents)

- Base URL: `https://hyperfy.lulu.tekne.studio/openclaw-gateway`
- Action endpoint: `POST /action`
- Auth header (if enabled): `Authorization: Bearer <token>`
