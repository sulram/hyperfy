function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export function loadConfig() {
  const port = Number(process.env.PORT || 8787)
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`)
  }

  return {
    port,
    logLevel: process.env.LOG_LEVEL || 'info',
    hyperfy: {
      wsUrl: required('HYPERFY_WS_URL'),
      agentName: process.env.HYPERFY_AGENT_NAME || 'OpenClawBot',
      agentAvatar: process.env.HYPERFY_AGENT_AVATAR || undefined,
      maxChatLength: 500,
      pingIntervalMs: 20000,
      reconnectMinMs: 1000,
      reconnectMaxMs: 15000,
    },
    openclaw: {
      hookUrl: required('OPENCLAW_HOOK_URL'),
      agent: required('OPENCLAW_AGENT'),
      bearerToken: process.env.OPENCLAW_HOOK_BEARER_TOKEN || '',
      webhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET || '',
      timeoutMs: 15000,
      channelId: process.env.HYPERFY_CHANNEL_ID || 'hyperfy:default:global',
      channelName: process.env.HYPERFY_CHANNEL_NAME || 'Hyperfy Global',
    },
    bridge: {
      outboundToken: process.env.BRIDGE_OUTBOUND_TOKEN || '',
    },
  }
}
