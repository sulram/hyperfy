# OpenClaw Hyperfy Channel

Guia para integrar o chat do `Hyperfy` com um canal/agente do `OpenClaw`.

## Caminho rapido (seu caso: Hyperfy ja esta rodando)

Se o `Hyperfy` ja esta rodando com o gateway embutido ativo, voce precisa principalmente configurar o plugin/canal no `OpenClaw`.

No `openclaw.json` do OpenClaw:

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

Depois:

1. Reinicie/recarregue o OpenClaw (para carregar o plugin/config)
2. Teste no Hyperfy:

```bash
curl -s -X POST https://hyperfy.lulu.tekne.studio/openclaw-gateway/outbound \
  -H 'content-type: application/json' \
  -d '{"text":"teste channel openclaw"}'
```

Se esse POST fizer o bot falar no mundo, a parte Hyperfy -> gateway esta ok.

## Onde configurar cada config (importante)

Mesmo quando tudo roda no mesmo servidor/host, existem 2 processos diferentes:

- processo `Hyperfy` (servidor do mundo + gateway embutido)
- processo `OpenClaw` (runtime do agente + plugin/canal)

Regra pratica:

- ENVs configuradas no `Hyperfy`:
  `ENABLE_OPENCLAW_GATEWAY`, `OPENCLAW_*`, `OPENCLAW_GATEWAY_*`, `BRIDGE_OUTBOUND_TOKEN`, `HYPERFY_CHANNEL_*`
- Config do plugin no `OpenClaw` (`openclaw.json`):
  `plugins.entries.hyperfy-channel.config.bridgeUrl`, `plugins.entries.hyperfy-channel.config.bridgeToken`

Observacao importante:

- `OPENCLAW_*` fica no ambiente do `Hyperfy` porque e a configuracao de saida do gateway para chamar o OpenClaw.
- `bridgeUrl/bridgeToken` ficam no `openclaw.json` do `OpenClaw` porque sao configuracao do plugin para chamar o gateway do Hyperfy.

## FAQ: onde eu configuro `HYPERFY_BRIDGE_URL`?

Resposta curta:

- no OpenClaw, nao no Hyperfy
- em `openclaw.json`, via `plugins.entries.hyperfy-channel.config.bridgeUrl`
- este scaffold usa `api.pluginConfig` (sem fallback por env)

O codigo do scaffold fica em:

- `src/xyz/openclaw-hyperfy-channel/hyperfy-channel/index.js`

Ou seja:

- voce configura isso no `openclaw.json` do processo que roda o `OpenClaw`
- nao no `src/server` do Hyperfy
- e nao no ambiente do processo do Hyperfy

### Opcao A (recomendada): configurar no `openclaw.json`

Exemplo (ajuste o plugin id se necessario):

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

No OpenClaw real, isso e suportado pelo sistema de plugins (`plugins.entries.<pluginId>.config`).

Observacao:

- `~/.openclaw/openclaw.json` (ou `/root/.openclaw/openclaw.json`) continua sendo a config do OpenClaw/Gateway (ex.: `gateway.mode`, `gateway.port`, `hooks.*`)
- e agora tambem pode carregar a config do plugin `hyperfy-channel` em `plugins.entries.<id>.config`

## TL;DR (POC simplificada, mesmo servidor/host)

Se voce esta em POC e tudo roda no mesmo servidor/host, use o minimo:

Se o Hyperfy ainda nao estiver configurado, siga este bloco.

### Hyperfy (servidor)

```bash
ENABLE_OPENCLAW_GATEWAY=1
OPENCLAW_HOOK_URL=http://127.0.0.1:3001/hooks/agent
OPENCLAW_AGENT=hyperfy-bot
```

Essas 3 ENVs acima vao no processo do `Hyperfy`.

### OpenClaw (`openclaw.json`, plugin/canal)

```json5
{
  "plugins": {
    "entries": {
      "hyperfy-channel": {
        "enabled": true,
        "config": {
          "bridgeUrl": "http://127.0.0.1:3000/openclaw-gateway",
          "bridgeToken": ""
        }
      }
    }
  }
}
```

Essa configuracao vai no `openclaw.json` do `OpenClaw`.

### Teste rapido

```bash
curl -s -X POST http://127.0.0.1:3000/openclaw-gateway/outbound \
  -H 'content-type: application/json' \
  -d '{"text":"Teste POC"}'
```

Nesta POC simplificada:

- sem token de `/outbound` (auth opcional)
- sem customizar `CHANNEL_ID/CHANNEL_NAME` (defaults)
- sem avatar custom do bot (default)
- pairing = URL do gateway + `OPENCLAW_AGENT`

Este diretório agora suporta dois modos:

- `Modo embutido (recomendado)`:
  o gateway roda dentro do servidor Hyperfy como plugin Fastify (`serverPlugin.js`)
- `Modo bridge separado (POC)`:
  um processo Node/Docker independente (`src/`)

## Como funciona (visao geral)

Fluxo de ida e volta:

1. Um jogador fala no mundo Hyperfy.
2. O agente gateway (avatar bot no Hyperfy) recebe o evento de chat.
3. O gateway envia esse texto para `OPENCLAW_HOOK_URL` (webhook de entrada do OpenClaw).
4. O OpenClaw processa e decide responder pelo canal `hyperfy`.
5. O plugin/canal do OpenClaw faz `POST /outbound` no gateway.
6. O gateway manda `speak` no agente Hyperfy (com chunking de 500 chars).

## O que e "pairing"

Neste contexto, "pairing" e o pareamento de 3 coisas:

1. `Pairing de seguranca (token)`
   o token de saida do plugin OpenClaw deve bater com o token aceito pelo gateway.
2. `Pairing de agente (OpenClaw agent)`
   o `OPENCLAW_AGENT` define qual agente/persona do OpenClaw processa as mensagens do Hyperfy.
3. `Pairing de canal (identidade)`
   `HYPERFY_CHANNEL_ID` / `HYPERFY_CHANNEL_NAME` (ou `OPENCLAW_GATEWAY_CHANNEL_*`) definem como esse canal aparece para o OpenClaw.

Resumo pratico:

- `plugins.entries.hyperfy-channel.config.bridgeToken` (OpenClaw) == `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` (ou `BRIDGE_OUTBOUND_TOKEN`) no gateway
- `OPENCLAW_AGENT` aponta para o agente certo no OpenClaw
- `plugins.entries.hyperfy-channel.config.bridgeUrl` aponta para o endpoint correto do gateway (`/openclaw-gateway/outbound` por padrao no modo embutido)

### Pairing simplificado (POC)

Se tudo esta no mesmo servidor/host e voce quer validar rapido:

- nao use token por enquanto
- mantenha 1 canal default (`hyperfy:default:global`)
- escolha 1 agente OpenClaw fixo (`OPENCLAW_AGENT=hyperfy-bot`)

Ou seja, o "pairing" vira basicamente:

- `OPENCLAW_AGENT` (quem responde)
- `bridgeUrl` no plugin `hyperfy-channel` (para onde o OpenClaw envia a resposta)

## Estrutura

- `serverPlugin.js` — gateway embutido no servidor Hyperfy (recomendado)
- `src/` — bridge HTTP/WS separado (POC legado, ainda util para testes isolados)
- `hyperfy-channel/` — scaffold de plugin/canal `hyperfy` para o OpenClaw

## Modo embutido (recomendado)

O gateway roda dentro do processo principal do Hyperfy, sem WebSocket loopback interno e sem um terceiro servico.

### Passo a passo

1. Ative o plugin no servidor Hyperfy

Adicione no ambiente do servidor:

```bash
ENABLE_OPENCLAW_GATEWAY=1
```

2. Configure a conexao com o OpenClaw (obrigatorio)

```bash
OPENCLAW_HOOK_URL=http://SEU-OPENCLAW/hooks/agent
OPENCLAW_AGENT=hyperfy-bot
```

3. Configure autenticacao entre plugin OpenClaw e gateway (recomendado)

```bash
OPENCLAW_GATEWAY_OUTBOUND_TOKEN=change-me
```

No plugin do OpenClaw, use o mesmo valor em `plugins.entries.hyperfy-channel.config.bridgeToken`.

Para POC, voce pode pular este passo e deixar sem token.

4. Suba o servidor Hyperfy

O Hyperfy vai registrar o plugin e spawnar um agente gateway persistente.

5. Teste o health do gateway

Por padrao:

```bash
curl -s http://localhost:3000/openclaw-gateway/health
```

6. Configure o plugin/canal no OpenClaw

Use o scaffold em `hyperfy-channel/` e configure:

```json5
{
  "plugins": {
    "entries": {
      "hyperfy-channel": {
        "enabled": true,
        "config": {
          "bridgeUrl": "http://SEU-HYPERFY:3000/openclaw-gateway",
          "bridgeToken": "change-me"
        }
      }
    }
  }
}
```

7. Teste envio de resposta para o Hyperfy (manual)

```bash
curl -s -X POST http://localhost:3000/openclaw-gateway/outbound \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{"text":"Teste vindo do OpenClaw"}'
```

Se o agent gateway estiver spawnado e conectado, ele fala no mundo.

## ENVs do modo embutido (Hyperfy servidor)

Estas ENVs sao configuradas no processo do `Hyperfy` (servidor do mundo).
Mesmo as que comecam com `OPENCLAW_` ficam aqui.

### Minimo para POC

- `ENABLE_OPENCLAW_GATEWAY=1`
- `OPENCLAW_HOOK_URL=...`
- `OPENCLAW_AGENT=...`

Todo o resto e opcional no inicio.

### Obrigatorias

- `ENABLE_OPENCLAW_GATEWAY`
  ativa o plugin embutido (`1`, `true`, `yes`, `on`)
- `OPENCLAW_HOOK_URL`
  webhook de entrada do OpenClaw (mensagens do Hyperfy -> OpenClaw)
- `OPENCLAW_AGENT`
  id/nome do agente do OpenClaw que processa esse canal

### Seguranca / auth

- `OPENCLAW_GATEWAY_OUTBOUND_TOKEN`
  token exigido em `POST /outbound` (recomendado)
- `BRIDGE_OUTBOUND_TOKEN`
  alias legado (fallback)
- `OPENCLAW_HOOK_BEARER_TOKEN`
  bearer enviado pelo gateway ao webhook do OpenClaw (se o OpenClaw exigir)
- `OPENCLAW_WEBHOOK_SECRET`
  header `x-webhook-secret` enviado ao OpenClaw (se exigido)

### Agente Hyperfy (gateway bot)

- `OPENCLAW_GATEWAY_AGENT_NAME`
  nome do avatar bot no mundo (fallback: `HYPERFY_AGENT_NAME`, default `OpenClawBot`)
- `OPENCLAW_GATEWAY_AGENT_AVATAR`
  avatar do bot (fallback: `HYPERFY_AGENT_AVATAR`)

### Canal visto pelo OpenClaw

- `OPENCLAW_GATEWAY_CHANNEL_ID`
  id do canal (fallback: `HYPERFY_CHANNEL_ID`, default `hyperfy:default:global`)
- `OPENCLAW_GATEWAY_CHANNEL_NAME`
  nome amigavel (fallback: `HYPERFY_CHANNEL_NAME`, default `Hyperfy Global`)

### Operacao / debug

- `OPENCLAW_GATEWAY_PREFIX`
  prefixo HTTP do gateway (default `/openclaw-gateway`)
- `OPENCLAW_GATEWAY_TIMEOUT_MS`
  timeout de chamadas ao OpenClaw (default `15000`)
- `OPENCLAW_GATEWAY_DEBUG`
  logs debug (`1/true/...`)

## Config do plugin OpenClaw (canal `hyperfy`) no `openclaw.json`

Este scaffold usa `api.pluginConfig` (config de plugin), nao ENV.

Campos em `plugins.entries.hyperfy-channel.config`:

- `bridgeUrl`
  URL base do gateway
  exemplo (modo embutido): `https://hyperfy.lulu.tekne.studio/openclaw-gateway`
- `bridgeToken`
  mesmo valor de `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` (ou `BRIDGE_OUTBOUND_TOKEN`)

### Mapa rapido (quem configura o que)

No `Hyperfy`:

- `ENABLE_OPENCLAW_GATEWAY`
- `OPENCLAW_HOOK_URL`
- `OPENCLAW_AGENT`
- `OPENCLAW_GATEWAY_OUTBOUND_TOKEN` (opcional)
- `OPENCLAW_HOOK_BEARER_TOKEN` / `OPENCLAW_WEBHOOK_SECRET` (opcionais)
- `OPENCLAW_GATEWAY_AGENT_*` (opcionais)
- `OPENCLAW_GATEWAY_CHANNEL_*` ou `HYPERFY_CHANNEL_*` (opcionais)

No `OpenClaw`:

- `plugins.entries.hyperfy-channel.config.bridgeUrl`
- `plugins.entries.hyperfy-channel.config.bridgeToken` (opcional na POC, recomendado depois)

## Endpoints do gateway embutido

Prefixo padrao: `/openclaw-gateway`

- `GET /openclaw-gateway/health`
- `POST /openclaw-gateway/outbound`
  requer `Authorization: Bearer <token>` se token estiver configurado

Payload de `/outbound`:

```json
{ "text": "Oi do OpenClaw" }
```

## Como o pairing funciona na pratica

### 1. Pairing do token (plugin OpenClaw -> Hyperfy gateway)

O plugin `hyperfy-channel/index.js` envia:

- `Authorization: Bearer ${pluginConfig.bridgeToken}`

O gateway embutido valida contra:

- `OPENCLAW_GATEWAY_OUTBOUND_TOKEN`
- fallback: `BRIDGE_OUTBOUND_TOKEN`

Se nao bater, retorna `401 UNAUTHORIZED`.

### 2. Pairing do agente OpenClaw (Hyperfy -> OpenClaw webhook)

Quando o Hyperfy envia uma mensagem ao OpenClaw, o gateway manda um payload com:

- `agent: OPENCLAW_AGENT`

Isso determina qual agente do OpenClaw vai responder.

### 3. Pairing do canal (contexto no OpenClaw)

O gateway envia `channel.id`, `channel.type`, `channel.name`.

Padrao:

- `type = "hyperfy"`
- `id = hyperfy:default:global`
- `name = Hyperfy Global`

Voce pode mudar para separar mundos/salas/instancias.

Exemplo:

- `OPENCLAW_GATEWAY_CHANNEL_ID=hyperfy:metaverso-online:lobby`
- `OPENCLAW_GATEWAY_CHANNEL_NAME=Metaverso Online Lobby`

## Troubleshooting rapido

- `401` no `/outbound`
  token do plugin OpenClaw nao bate com `OPENCLAW_GATEWAY_OUTBOUND_TOKEN`
- mensagens do Hyperfy nao chegam no OpenClaw
  confira `OPENCLAW_HOOK_URL`, `OPENCLAW_AGENT`, e auth (`OPENCLAW_HOOK_BEARER_TOKEN` / `OPENCLAW_WEBHOOK_SECRET`)
- gateway health ok, mas bot nao fala no mundo
  verifique se o agente gateway spawnou/conectou em `/openclaw-gateway/health`
- respostas cortadas em varias mensagens
  esperado: o gateway faz chunking em 500 caracteres para `speak`

## Modo bridge separado (POC legado)

Ainda existe para teste isolado e Docker.

Nesse modo:

- use `src/xyz/openclaw-hyperfy-channel/src/`
- configure `HYPERFY_WS_URL` (aponta para `/ws/agents`)
- rode a bridge separada

Veja `./.env.example` para o conjunto de variaveis desse modo.

## Plugin OpenClaw (scaffold)

O codigo em `hyperfy-channel/index.js` e um scaffold de plugin custom.

Para configuracao do plugin (OpenClaw), veja tambem:

- `hyperfy-channel/README.md` (versao curta, focada no canal `hyperfy`)

Observacoes:

- A API exata de plugin/canal do OpenClaw pode variar por versao.
- O scaffold esta preparado para enviar texto para `POST /outbound`.
- Pode ser necessario ajustar `registerChannel`, `setup(api)` e formato de `message`.
