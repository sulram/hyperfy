# XYZ

This folder contains the two experimental agent projects under the `xyz` namespace.

## Projects

### `agents/`

Headless Hyperfy agents with an HTTP/cURL control surface.

This project is based on the `molt.space` headless-agent model adapted to Hyperfy.

Use this project when you want to:

- spawn an agent directly in the world
- control movement and navigation over HTTP
- poll chat and proximity events
- build automations around the session URL or bearer-token API

This project does not expose build commands.

Main guide:

- `agents/README.md`

Skill:

- `skills/curl-http-agent/SKILL.md`

### `openclaw-hyperfy-channel/`

OpenClaw <-> Hyperfy integration, including the embedded gateway inside Hyperfy, the OpenClaw plugin scaffold, and voxel/build actions.

Use this project when you want to:

- connect Hyperfy chat to an OpenClaw agent
- run the embedded gateway inside the Hyperfy server
- send replies back into the world through `/openclaw-gateway/outbound`
- expose build and voxel actions such as `build.perception`, `build.place`, and `build.remove`
- call the gateway directly from external `curl` or HTTP clients

Main guide:

- `openclaw-hyperfy-channel/README.md`

Skill:

- `skills/gateway-agent/SKILL.md`

## Responsibility Split

- `agents/` owns direct world control: spawn, chat, movement, navigation, polling, and session lifecycle. It does not expose build commands.
- `openclaw-hyperfy-channel/` owns OpenClaw pairing, gateway routing, outbound replies, and voxel/build operations. External `curl` clients can call these gateway routes directly.

## Read Order

1. Start here to choose the right project.
2. Read `agents/README.md` if you need direct HTTP/cURL control.
3. Read `openclaw-hyperfy-channel/README.md` if you need OpenClaw integration or build actions.
