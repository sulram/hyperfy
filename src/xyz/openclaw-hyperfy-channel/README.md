# OpenClaw Hyperfy Channel

Guide for the gateway project that connects `Hyperfy` chat and build actions to `OpenClaw`.

This project is the second half of `src/xyz`:

- `agents/` controls headless world agents directly over HTTP/cURL and does not expose build commands
- `openclaw-hyperfy-channel/` connects Hyperfy to OpenClaw and exposes gateway build actions

## What This Project Contains

- `serverPlugin.js` - embedded gateway inside the Hyperfy server process
- `hyperfy-channel/` - OpenClaw plugin scaffold for the `hyperfy` channel
- `skills/gateway-agent/SKILL.md` - operational skill for agents that act through the gateway

These are the only runtime pieces that still matter here:

- `serverPlugin.js` runs inside Hyperfy and exposes `/openclaw-gateway/*`
- `hyperfy-channel/` runs inside OpenClaw and sends outbound text/actions to that gateway

## Quick Path

If Hyperfy is already running with the embedded gateway enabled, the main step is configuring the `hyperfy-channel` plugin in OpenClaw.

In OpenClaw's `openclaw.json`:

```json5
{
  "plugins": {
    "entries": {
      "hyperfy-channel": {
        "enabled": true,
        "config": {
          "bridgeUrl": "https://hyperfy.lulu.tekne.studio/openclaw-gateway",
          "bridgeToken": ""
        }
      }
    }
  }
}
```

Then restart or reload OpenClaw and test outbound speech:

```bash
curl -s -X POST https://hyperfy.lulu.tekne.studio/openclaw-gateway/outbound \
  -H 'content-type: application/json' \
  -d '{"text":"test openclaw channel"}'
```

If the bot speaks in-world, the outbound path is working.

## Where Each Config Lives

Even on the same machine there are still 2 separate processes:

- `Hyperfy` process - world server + embedded gateway
- `OpenClaw` process - agent runtime + plugin/channel

Use this split:

- Hyperfy environment variables:
  `ENABLE_OPENCLAW_GATEWAY`, `OPENCLAW_*`, `OPENCLAW_GATEWAY_*`, `BRIDGE_OUTBOUND_TOKEN`, `HYPERFY_CHANNEL_*`
- OpenClaw plugin config in `openclaw.json`:
  `plugins.entries.hyperfy-channel.config.bridgeUrl`
  `plugins.entries.hyperfy-channel.config.bridgeToken`

Important:

- `OPENCLAW_*` lives in the Hyperfy process because it configures outbound calls from the gateway to OpenClaw.
- `bridgeUrl` and `bridgeToken` live in OpenClaw because they configure outbound calls from the plugin back to Hyperfy.

## Architecture

Round-trip message flow:

1. A player speaks in the Hyperfy world.
2. The gateway agent receives the chat event.
3. The embedded gateway sends the message to `OPENCLAW_HOOK_URL`.
4. OpenClaw decides to answer through the `hyperfy` channel.
5. The `hyperfy-channel` plugin sends `POST /openclaw-gateway/outbound`.
6. The gateway speaks through the Hyperfy agent, chunking long text into 500-character messages.

The same gateway also exposes build endpoints and an action router for voxel-based operations.

## Direct cURL Access

External clients can call the gateway directly with `curl` or any other HTTP client.

Examples:

```bash
curl -s http://localhost:3000/openclaw-gateway/health
```

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/action \
  -H 'content-type: application/json' \
  -d '{"action":{"type":"build.perception"}}'
```

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/build/place \
  -H 'content-type: application/json' \
  -d '{"targetGrid":{"x":1,"y":0,"z":0}}'
```

If `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` is configured, add:

```bash
-H 'authorization: Bearer <token>'
```

## Embedded Mode Setup

Embedded mode is the recommended deployment model. The gateway runs inside the main Hyperfy server process.

### Hyperfy server

Minimum environment:

```bash
ENABLE_OPENCLAW_GATEWAY=1
OPENCLAW_HOOK_URL=http://127.0.0.1:3001/hooks/agent
OPENCLAW_AGENT=hyperfy-bot
```

Recommended auth between OpenClaw and Hyperfy:

```bash
OPENCLAW_GATEWAY_OUTBOUND_TOKEN=change-me
```

### OpenClaw plugin

Configure the plugin scaffold in `openclaw.json`:

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

Outbound reply:

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/outbound \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{"text":"Test coming from OpenClaw"}'
```

## Pairing

In practice, pairing means keeping 3 things aligned:

1. Security pairing
   `plugins.entries.hyperfy-channel.config.bridgeToken`
   must match
   `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` or `BRIDGE_OUTBOUND_TOKEN`
2. Agent pairing
   `OPENCLAW_AGENT` chooses which OpenClaw agent responds
3. Channel pairing
   `OPENCLAW_GATEWAY_CHANNEL_ID` and `OPENCLAW_GATEWAY_CHANNEL_NAME`
   define how the Hyperfy side appears inside OpenClaw

Simplified POC pairing:

- one OpenClaw agent, for example `OPENCLAW_AGENT=hyperfy-bot`
- one default channel, for example `hyperfy:default:global`
- one gateway URL in `bridgeUrl`

## Environment Variables

### Required

- `ENABLE_OPENCLAW_GATEWAY`
- `OPENCLAW_HOOK_URL`
- `OPENCLAW_AGENT`

### Security and auth

- `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` - required by `POST /outbound`
- `BRIDGE_OUTBOUND_TOKEN` - legacy fallback alias
- `OPENCLAW_HOOK_BEARER_TOKEN` - bearer sent to OpenClaw webhook
- `OPENCLAW_WEBHOOK_SECRET` - `x-webhook-secret` sent to OpenClaw

### Hyperfy gateway agent

- `OPENCLAW_GATEWAY_AGENT_NAME` - bot avatar name, fallback `HYPERFY_AGENT_NAME`, default `OpenClawBot`
- `OPENCLAW_GATEWAY_AGENT_AVATAR` - bot avatar, fallback `HYPERFY_AGENT_AVATAR`

### Channel identity

- `OPENCLAW_GATEWAY_CHANNEL_ID` - fallback `HYPERFY_CHANNEL_ID`, default `hyperfy:default:global`
- `OPENCLAW_GATEWAY_CHANNEL_NAME` - fallback `HYPERFY_CHANNEL_NAME`, default `Hyperfy Global`

### Operations and debug

- `OPENCLAW_GATEWAY_PREFIX` - default `/openclaw-gateway`
- `OPENCLAW_GATEWAY_TIMEOUT_MS` - default `15000`
- `OPENCLAW_GATEWAY_DEBUG` - debug logging flag
- `OPENCLAW_GATEWAY_BUILD_MAX_CUBES` - cube cap for managed build actions, default `256`
- `OPENCLAW_GATEWAY_BUILD_MAX_STACK_HEIGHT` - max cubes per column, default `4`

## OpenClaw Plugin Config

This scaffold uses `api.pluginConfig`, not environment variables.

Fields in `plugins.entries.hyperfy-channel.config`:

- `bridgeUrl` - gateway base URL
- `bridgeToken` - same value used by `OPENCLAW_GATEWAY_OUTBOUND_TOKEN`

FAQ: where do I configure `HYPERFY_BRIDGE_URL`?

- in OpenClaw, not in Hyperfy
- in `openclaw.json`
- via `plugins.entries.hyperfy-channel.config.bridgeUrl`

## Embedded Gateway Endpoints

Default prefix: `/openclaw-gateway`

Core endpoints:

- `GET /openclaw-gateway/health`
- `POST /openclaw-gateway/outbound`

Build endpoints:

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
- `POST /openclaw-gateway/action`

`/outbound` requires `Authorization: Bearer <token>` when a token is configured.

## Build and Voxel System

The build layer treats the Hyperfy default cube as a canonical asset class and exposes a voxel-based control surface to agents.

### Model

- canonical asset class: `default-cube`
- voxel size: `1`
- grid origin: `[0,0,0]`
- default per-column max stack height: `4`
- global managed cube cap: `OPENCLAW_GATEWAY_BUILD_MAX_CUBES`, default `256`

The product direction is simple:

- agents decide in voxel coordinates
- the gateway handles the concrete asset and world operations

### Why it exists

The build system was added so agents can reason in discrete grid cells instead of raw entity ids and manual movement steps.

The gateway now provides:

- world-state perception in voxel space
- server-side cube placement, move, and removal
- carry/start and carry/stop operations for visual movement
- `reposition-auto` so the gateway can choose a managed cube and relocate it automatically

### Canonical actions

Prefer `build.*` names:

- `build.catalog`
- `build.snapshot`
- `build.perception`
- `build.place`
- `build.move`
- `build.remove`
- `build.remove-all`
- `build.carry.start`
- `build.carry.stop`
- `build.carry.status`
- `build.reposition-auto`

Compatibility aliases such as `place`, `remove`, `clear`, and `perception` still exist, but `build.*` is the stable contract.

### Recommended agent flow

1. Read `build.perception`
2. Choose `targetGrid`
3. If `limits.remaining > 0`, use `build.place`
4. If the cube cap is reached, use `build.remove`, `build.move`, or `build.reposition-auto`
5. Repeat

`build.perception` is the main agent-safe view because it exposes voxel occupancy, limits, and nearby players without leaking low-level world details into the agent contract.

### Build mutation granularity

Write operations are currently single-target mutations:

- `build.place` places one cube per request
- `build.move` moves one cube per request
- `build.remove` removes one cube per request
- `build.reposition-auto` repositions one cube per request

The only bulk mutation today is `build.remove-all`.

So if an agent wants to place 10 cubes, it should send 10 write requests. In practice these should be sequential, not parallel, because the gateway serializes build mutations and may return `BUILD_BUSY` if another mutation is already in flight.

### Payload shapes

Inside OpenClaw / Hyperfy chat, prefer `hyperfyAction`:

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

For external HTTP clients, use `/openclaw-gateway/action` with `action`:

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

### Transport rule

- In-world Hyperfy agents using the OpenClaw channel should use `hyperfyAction`.
- External scripts and cURL clients should use `POST /openclaw-gateway/action`.

That split keeps chat agents free from bearer-token and HTTP details while still allowing full external automation.

### Current implementation status

Implemented:

- build catalog and snapshot
- voxel perception
- server-side `place`, `move`, `remove`, and `remove-all`
- carry start, stop, and status
- simple build-operation locking
- gateway action routing for `build.*`
- `reposition-auto`

Still planned:

- consolidate the "cap reached means move/remove only" rule into a simpler default behavior
- animate full build execution with `navigateTo` plus placement
- idle builder behavior that chooses a new `targetGrid` automatically
- a gateway planner that turns voxel intent into pick/carry/navigate/drop steps
- support for new asset classes with non-cube footprints

## Quick Troubleshooting

- `401` on `/outbound`
  the OpenClaw plugin token does not match `OPENCLAW_GATEWAY_OUTBOUND_TOKEN`
- Hyperfy messages do not reach OpenClaw
  check `OPENCLAW_HOOK_URL`, `OPENCLAW_AGENT`, and webhook auth
- Health is ok, but the bot does not speak in-world
  verify that the gateway agent actually spawned and connected
- `VOXEL_OCCUPIED`
  choose a different `targetGrid`
- `MAX_CUBES_REACHED`
  remove, move, or reposition an existing cube before placing a new one

## OpenClaw Plugin Scaffold

The `hyperfy-channel/` directory contains the plugin manifest and scaffold that sends replies back to the gateway.

If you only need plugin configuration:

- read `hyperfy-channel/README.md`

If you need operational behavior for gateway actions and build commands:

- read `skills/gateway-agent/SKILL.md`
