import { errorResponseSchema, healthResponseSchema } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { AppError } from '@platform/errors.ts';
import { testApp } from './helpers.ts';

describe('GET /v1/health', () => {
    it('answers with the contract shape', async () => {
        const response = await testApp().request('/v1/health');
        expect(response.status).toBe(200);
        const body = healthResponseSchema.parse(await response.json());
        expect(body).toMatchObject({ status: 'ok', service: 'backend', version: 'dev', uptimeSeconds: 0, time: '2026-10-09T12:00:00.000Z' });
    });
});

describe('request id', () => {
    it('generates one when the caller sends none', async () => {
        const response = await testApp().request('/v1/health');
        expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('echoes a well-formed caller id and ignores an unsafe one', async () => {
        const app = testApp();
        const good = await app.request('/v1/health', { headers: { 'x-request-id': 'abc-123' } });
        expect(good.headers.get('x-request-id')).toBe('abc-123');
        const bad = await app.request('/v1/health', { headers: { 'x-request-id': 'bad id with spaces' } });
        expect(bad.headers.get('x-request-id')).not.toContain('bad');
    });
});

describe('error contract', () => {
    it('answers an unknown route with NOT_FOUND', async () => {
        const response = await testApp().request('/v1/nope');
        expect(response.status).toBe(404);
        const body = errorResponseSchema.parse(await response.json());
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
    });

    it('answers invalid input with VALIDATION_FAILED and the offending field', async () => {
        const response = await testApp().request('/v1/scans/short');
        expect(response.status).toBe(400);
        const body = errorResponseSchema.parse(await response.json());
        expect(body.error.code).toBe('VALIDATION_FAILED');
        expect(body.error.details?.[0]?.path).toBe('publicId');
    });

    it('maps a deliberate AppError to its status and code', async () => {
        const app = testApp();
        app.get('/limited', () => {
            throw new AppError('RATE_LIMITED', 'Slow down.');
        });
        const response = await app.request('/limited');
        expect(response.status).toBe(429);
        expect(errorResponseSchema.parse(await response.json()).error.code).toBe('RATE_LIMITED');
    });

    it('never leaks the message or the stack of an unexpected failure', async () => {
        const app = testApp();
        app.get('/boom', () => {
            throw new Error('database password is hunter2');
        });
        const response = await app.request('/boom');
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(text).not.toContain('hunter2');
        expect(errorResponseSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL');
    });
});

describe('CORS', () => {
    it('allows a configured origin, without credentials', async () => {
        const response = await testApp({ CORS_ORIGINS: 'https://sitehp.app' }).request('/v1/health', { headers: { origin: 'https://sitehp.app' } });
        expect(response.headers.get('access-control-allow-origin')).toBe('https://sitehp.app');
        expect(response.headers.get('access-control-allow-credentials')).toBeNull();
        expect(response.headers.get('access-control-expose-headers')).toContain('X-Request-Id');
    });

    it('allows only the methods the API answers', async () => {
        const response = await testApp({ CORS_ORIGINS: 'https://sitehp.app' }).request('/v1/scans', {
            method: 'OPTIONS',
            headers: { origin: 'https://sitehp.app', 'access-control-request-method': 'POST' },
        });
        expect(
            response.headers
                .get('access-control-allow-methods')
                ?.split(',')
                .map((method) => method.trim()),
        ).toEqual(['GET', 'POST']);
    });

    it('does not allow any other origin', async () => {
        const response = await testApp({ CORS_ORIGINS: 'https://sitehp.app' }).request('/v1/health', { headers: { origin: 'https://evil.example' } });
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('lets a browser send Last-Event-ID in a preflight (needed to resume SSE)', async () => {
        const response = await testApp({ CORS_ORIGINS: 'https://sitehp.app' }).request(`/v1/scans/${'x'.repeat(22)}/events`, {
            method: 'OPTIONS',
            headers: { origin: 'https://sitehp.app', 'access-control-request-method': 'GET', 'access-control-request-headers': 'last-event-id' },
        });
        expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('last-event-id');
    });
});
