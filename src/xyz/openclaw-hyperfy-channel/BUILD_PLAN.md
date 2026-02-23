# OpenClaw Hyperfy Build/Voxel Plan

Plano de implementação para dar habilidades de construção para agentes (via `curl` e via gateway/OpenClaw), começando pelo cubo padrão do painel de construção do Hyperfy.

## Objetivos

- Tratar o cubo padrão como um `asset class` canônico (`default-cube`)
- Dar percepção espacial aos agentes em grade voxel (quantização)
- Expor uma interface de alto nível onde o agente decide por voxel e o gateway executa automaticamente (`carry` + navegação + drop)
- Expor APIs de leitura/escrita via gateway (`/openclaw-gateway/build/*`)
- Definir limite máximo de cubos por ENV (inicialmente `256`)
- Preparar extensão futura para outros assets além do cubo

## Requisitos funcionais (fase inicial)

- Descobrir e catalogar o cubo padrão a partir da coleção `default` (item `Model.hyp`)
- Listar cubos existentes no mundo e sua posição quantizada
- Informar `limits.maxCubes/currentCubes/remaining`
- Informar candidatos de remoção quando atingir limite (para fluxo de mover/remover manual)
- Permitir `place` server-side de `default-cube` em célula voxel
- Permitir `move` server-side de cubo existente para nova célula voxel
- Permitir `carry` visual (`mover`) de cubo seguindo o agente gateway
- Enforce:
  - ocupação por voxel
  - altura máxima por coluna (`maxStackHeight`, inicial `4`)
  - cap global de cubos (`OPENCLAW_GATEWAY_BUILD_MAX_CUBES`, inicial `256`)

## Fases

### Fase 1 (este commit / início)

- [x] Branch de trabalho
- [x] Documento de plano
- [x] Passar `world` para o gateway embutido
- [x] `AssetClassRegistry` mínimo (`default-cube`) via coleção `default/Model`
- [x] `GET /build/catalog`
- [x] `GET /build/snapshot`
- [x] ENV simplificada (somente cap de cubos)

### Fase 2

- [x] `POST /build/place` (server-side)
- [x] `POST /build/move` (server-side)
- [x] `POST /build/remove`
- [x] Lock de operações de build (anti-race, simples / mutex no gateway)
- [x] `POST /build/carry/start|stop` + `GET /build/carry/status` (visual follow com `mover`)
- [x] `carry/start` sem payload -> pega cubo mais próximo do agente gateway
- [x] `carry/stop` com `targetGrid` opcional para drop explícito

### Fase 3

- [x] Integração com plugin OpenClaw para `sendPayload` estruturado (não-texto) via `hyperfyAction`
- [x] Rota de ação no gateway para comandos `build.*` (`POST /action`)
- [x] Interface voxel-only para agentes (sem expor `entityId`/`mover` no contrato do agente) via `GET /build/perception`
- [x] `POST /build/reposition-auto` (gateway escolhe cubo, faz `carry`, navega e posiciona)
- [ ] Regra simples consolidada: ao atingir cap, agente só move/remove cubos existentes (sem evicção automática)

### Fase 4

- [ ] Execução com animação do agente (`navigateTo` + posicionamento + place)
- [ ] Idle builder automático: agente recebe voxel map e escolhe próximo `targetGrid`
- [ ] Planner no gateway para transformar intenção voxel em sequência física (pick/carry/navigate/drop)
- [ ] Suporte a novos assets com footprints voxel diferentes

## ENV (simplificada)

- `OPENCLAW_GATEWAY_BUILD_MAX_CUBES` (default `256`)

Defaults fixos nesta fase:

- build habilitado
- voxel size = `1`
- origem do grid = `[0,0,0]`
- stack máximo por coluna = `4`
- cubo padrão = coleção `default`, blueprint `Model`

## Observações

- A primeira versão vai priorizar robustez de snapshot/catalog e operações simples (`place/move/remove`).
- Locomoção do agente para construir (`navigateTo`) entra depois da base de build server-side.
- O modelo de percepção será por `assetClass` + voxel, para facilitar expansão futura.
- Direção de produto: agentes devem decidir por voxel; o gateway executa detalhes de asset/movimentação automaticamente.
