---
name: hyperfy-voxel-builder
description: Use when a bot/agent needs to build or rearrange Hyperfy default cubes as voxels via the OpenClaw Hyperfy gateway. The agent should read voxel perception, choose a target voxel, and call build.reposition-auto (or related build actions) instead of manipulating cube entities directly.
---

# Hyperfy Voxel Builder

Treat the world as a voxel grid of cubes.

## Rule

- Think in voxel coordinates `x,y,z`.
- Do not reason in terms of entity IDs unless debugging.
- Read perception first, choose a target voxel, then ask the gateway to execute.

## Main loop

1. Call `build.perception`
2. Find a free voxel target
3. Call `build.reposition-auto` with `targetGrid`
4. Repeat

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

## Manual/debug actions (optional)

- `build.snapshot`
- `build.carry.status`
- `build.carry.start`
- `build.carry.stop`
- `build.move`
- `build.place`
- `build.remove`

## Constraints to respect

- Cube cap exists (`limits.maxCubes`)
- If at cap, move/remove existing cubes instead of assuming new placement
- Target voxel must be free
- Stack height per column is limited

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
    "type": "build.reposition-auto",
    "input": {
      "targetGrid": { "x": 3, "y": 0, "z": 2 }
    }
  }
}
```

