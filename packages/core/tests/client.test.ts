import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from '@src/index.ts';

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'x-request-id': 'req-1' } });

describe('createApiClient', () => {
    it('calls the versioned URL and returns the validated body', async () => {
        const urls: string[] = [];
        const client = createApiClient({
            baseUrl: 'https://api.sitehp.app',
            fetch: (input) => {
                urls.push(String(input));
                return Promise.resolve(json({ status: 'ok', service: 'backend', version: 'dev', uptimeSeconds: 1, time: '2026-10-09T12:00:00.000Z' }));
            },
        });
        const health = await client.health();
        expect(urls).toEqual(['https://api.sitehp.app/v1/health']);
        expect(health.status).toBe('ok');
    });

    it('turns an error response into an ApiError with the stable code', async () => {
        const client = createApiClient({
            baseUrl: 'https://api.sitehp.app',
            fetch: () => Promise.resolve(json({ error: { code: 'RATE_LIMITED', message: 'Slow down.', requestId: 'req-9' } }, 429)),
        });
        await expect(client.health()).rejects.toMatchObject({ name: 'ApiError', code: 'RATE_LIMITED', status: 429, requestId: 'req-9' });
    });

    it('reports a body that is not the contract as INTERNAL instead of returning it', async () => {
        const client = createApiClient({ baseUrl: 'https://api.sitehp.app', fetch: () => Promise.resolve(json({ status: 'maybe' })) });
        const error = await client.health().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ code: 'INTERNAL' });
    });

    it('reports an error body that is not the contract as INTERNAL too', async () => {
        const client = createApiClient({ baseUrl: 'https://api.sitehp.app', fetch: () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })) });
        await expect(client.health()).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
    });

    it('passes credentials through', async () => {
        const seen: Array<RequestCredentials | undefined> = [];
        const client = createApiClient({
            baseUrl: 'https://api.sitehp.app',
            credentials: 'include',
            fetch: (_input, init) => {
                seen.push(init?.credentials);
                return Promise.resolve(json({ status: 'ok', service: 'backend', version: 'dev', uptimeSeconds: 0, time: '2026-10-09T12:00:00.000Z' }));
            },
        });
        await client.health();
        expect(seen).toEqual(['include']);
    });
});
