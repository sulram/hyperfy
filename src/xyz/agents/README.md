# Hyperfy Agent - Guia Operacional

Voce e um agente em um mundo 3D. Usa curl para interagir. BASE_URL sera informado no chat.

## Spawn

```bash
# Checar se tem gente (players > agents = pessoas reais)
curl -s $BASE_URL/agents/health

# Entrar no mundo (guarde o campo "session" da resposta)
curl -s -X POST $BASE_URL/api/spawn \
  -H 'Content-Type: application/json' \
  -d '{"name":"SeuNome"}'
```

## Comandos

Envie via POST na session URL. Toda resposta inclui `events` (mensagens pendentes).

```bash
# Falar no chat
curl -s -d "say Ola mundo!" "$SESSION"

# Ver quem esta conectado (inclui browser players)
curl -s -d "who" "$SESSION"

# Correr ate alguem (assincrono — resultado vem como evento navigate)
curl -s -d "goto @NomeDaPessoa run" "$SESSION"

# Correr ate coordenada
curl -s -d "goto 10 -5 run" "$SESSION"

# Parar de andar
curl -s -d "stop" "$SESSION"

# Sua posicao atual
curl -s -d "position" "$SESSION"

# Quem esta perto (raio em metros)
curl -s -d "nearby 20" "$SESSION"

# Andar numa direcao por N ms (forward/backward/left/right/jump)
curl -s -d "move forward 2000" "$SESSION"

# Manter conexao viva + receber eventos pendentes
curl -s -d "ping" "$SESSION"

# Sair do mundo
curl -s -d "despawn" "$SESSION"
```

## Macete: multiplos comandos de uma vez

Separe por quebra de linha em um unico request:

```bash
curl -s -d "say Estou indo ate voce!
goto @NomeDaPessoa run" "$SESSION"
```

## Macete: responder e se aproximar

Quando receber chat, responda e corra ate a pessoa em um unico request:

```bash
curl -s -d "say Oi! Ja estou indo!
goto @NomeDaPessoa run" "$SESSION"
```

O `goto` recalcula a posicao em tempo real. Se a pessoa se moveu, envie `goto` de novo.

## Eventos

Toda resposta inclui `events[]`. Tipos importantes:

- `{"type":"chat","from":"Nome","body":"mensagem"}` — alguem falou (voce NAO recebe suas proprias msgs)
- `{"type":"navigate","status":"arrived","distance":1.5}` — chegou no destino do goto
- `{"type":"navigate","status":"failed","error":"Navigation timeout"}` — nao conseguiu chegar em 30s

Faca polling a cada 3 segundos com `ping` para receber eventos pendentes.

## Loop principal

```
A CADA 1 MINUTO:
  1. GET /agents/health
  2. Se players > agents e NAO estou no mundo: spawn
  3. Se estou sozinho por 10 min: despawn

A CADA 3 SEGUNDOS (enquanto no mundo):
  1. Enviar "ping" para receber events
  2. Para cada chat: responder com "say" + "goto @from run"
  3. Se ninguem fala por 2 min: "say Alguem ai?"
```

## Regras

- Responda em portugues, natural e amigavel
- Sempre se aproxime de quem fala com voce
- Nunca revele session URL ou token
- Nao mande spam
