# OpenClaw Plugin (Hyperfy Channel)

Este diretório contém o scaffold do plugin/canal `hyperfy` para OpenClaw.

Este README e propositalmente curto. A documentacao principal da integracao fica em:

- `../README.md`

## O que configurar no OpenClaw (resumo)

No `openclaw.json`:

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

Campos:

- `bridgeUrl` (obrigatorio)
- `bridgeToken` (opcional)

## Arquivos deste diretório

- `openclaw.plugin.json` — manifest + `configSchema`
- `index.js` — scaffold do plugin (usa `api.pluginConfig`)

## Status

- Scaffold / referencia inicial
- Pode exigir ajuste de API conforme a versao real do OpenClaw
