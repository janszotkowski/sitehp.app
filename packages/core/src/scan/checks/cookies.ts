import type { CheckDefinition, Evidence, Severity } from '../check.ts';
import { blockedPage } from '../gate.ts';

/** One check per cookie flag. A site that sets no cookie skips them: there is nothing to protect, and a free pass would score it above one that sets cookies well. Evidence names the cookies, never their values. */
const cookieCheck = (id: string, severity: Severity, status: 'fail' | 'warn', hasFlag: (cookie: string) => boolean, extra?: (cookies: readonly string[]) => Evidence): CheckDefinition => ({
    id,
    category: 'security',
    group: 'cookies',
    layer: 'light',
    severity,
    effort: 'minutes',
    run: ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        if (page.cookies.length === 0) return { status: 'skipped', evidence: { cookies: 0 }, skippedReason: 'not_applicable' };
        const missing = page.cookies.filter((cookie) => !hasFlag(cookie)).map((cookie) => cookie.split('=')[0]?.trim().slice(0, 60) ?? '');
        return {
            status: missing.length === 0 ? 'pass' : status,
            evidence: { cookies: page.cookies.length, missing: missing.length, names: missing.slice(0, 5).join(', '), ...extra?.(page.cookies) },
        };
    },
});

const secure = (cookie: string): boolean => /;\s*secure\s*(;|$)/i.test(cookie);

export const cookieChecks: readonly CheckDefinition[] = [
    // `SameSite=None` without `Secure` is not merely weak: browsers reject the cookie, so whatever needs it (an embed, a login) breaks.
    cookieCheck('cookie_secure', 'high', 'fail', secure, (cookies) => ({ rejected: cookies.filter((cookie) => /;\s*samesite\s*=\s*none\s*(;|$)/i.test(cookie) && !secure(cookie)).length })),
    // Warn, not fail: a cookie that a script must read cannot be HttpOnly, and the scan cannot tell.
    cookieCheck('cookie_httponly', 'medium', 'warn', (cookie) => /;\s*httponly\s*(;|$)/i.test(cookie)),
    // Browsers treat a missing SameSite as Lax, so this is a hint to say it out loud.
    cookieCheck('cookie_samesite', 'low', 'warn', (cookie) => /;\s*samesite\s*=/i.test(cookie)),
];
