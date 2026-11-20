/** The small files an agent may look for under `/.well-known/`, each defined by an RFC or a protocol spec. The worker fetches these paths; the checks read them. */
export const AGENT_FILE_PATHS = {
    apiCatalog: '/.well-known/api-catalog',
    oauthResource: '/.well-known/oauth-protected-resource',
    a2aAgentCard: '/.well-known/agent-card.json',
} as const;
