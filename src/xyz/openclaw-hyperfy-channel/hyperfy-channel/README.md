# OpenClaw Plugin (Hyperfy Channel)

This directory contains the scaffold for the `hyperfy` plugin/channel for OpenClaw.

This README is intentionally short. The main integration documentation lives in:

- `../README.md`

Operational behavior for gateway actions and build commands lives in:

- `../../skills/gateway-agent/SKILL.md`

## What to configure in OpenClaw (summary)

In `openclaw.json`:

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

Fields:

- `bridgeUrl` (required)
- `bridgeToken` (optional)

## Files in this directory

- `openclaw.plugin.json` - manifest + `configSchema`
- `index.js` - plugin scaffold (uses `api.pluginConfig`)

## Status

- Initial scaffold / reference
- May require API adjustments depending on the actual OpenClaw version
