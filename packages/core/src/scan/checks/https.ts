import type { CheckDefinition } from '../check.ts';
import { blocked } from '../gate.ts';
import { EXPIRY_DAYS } from '../limits.ts';
import { hideQueryValues } from '../url.ts';

// Let's Encrypt and most ACME clients renew at 30 days left, so a healthy site sits between 30 and 14 for weeks (`EXPIRY_DAYS`).

/** Security: the certificate is trusted and matches the name. An expired, self-signed or wrong-name certificate shows visitors a full-page browser warning. */
export const certValid: CheckDefinition = {
    id: 'cert_valid',
    category: 'security',
    group: 'https',
    layer: 'light',
    severity: 'critical',
    effort: 'hours',
    run: ({ certificate }) => {
        if (certificate === undefined) throw new Error('this check needs the certificate');
        // No TLS at all is `https_scheme`'s finding, but it is also not a valid certificate.
        if (certificate === null) return { status: 'fail', evidence: { available: false } };
        return { status: certificate.authorized ? 'pass' : 'fail', evidence: { available: true, authorized: certificate.authorized, error: certificate.error, issuer: certificate.issuer } };
    },
};

/** Security: the certificate does not run out soon. Most outages from certificates are a renewal nobody noticed. */
export const certExpiry: CheckDefinition = {
    id: 'cert_expiry',
    category: 'security',
    group: 'https',
    layer: 'light',
    severity: 'high',
    effort: 'minutes',
    run: ({ certificate }) => {
        if (certificate === undefined) throw new Error('this check needs the certificate');
        // No certificate has no expiry to measure; `https_scheme` and `cert_valid` already report the missing TLS.
        if (certificate === null) return { status: 'skipped', evidence: { available: false }, skippedReason: 'no_certificate' };
        const status = certificate.daysLeft < EXPIRY_DAYS.fail ? 'fail' : certificate.daysLeft < EXPIRY_DAYS.warn ? 'warn' : 'pass';
        return { status, evidence: { daysLeft: certificate.daysLeft, validTo: certificate.validTo } };
    },
};

/**
 * Security: someone who types `http://` ends up on https. A site that does not answer on
 * port 80 at all passes: nobody can be left on an unencrypted page (they just cannot connect).
 */
export const httpRedirect: CheckDefinition = {
    id: 'http_redirect',
    category: 'security',
    group: 'https',
    layer: 'light',
    severity: 'high',
    effort: 'minutes',
    run: ({ httpProbe }) => {
        if (httpProbe === undefined) throw new Error('this check needs the http probe');
        if (httpProbe === null) return { status: 'pass', evidence: { answered: false } };
        const evidence = { answered: true, finalUrl: hideQueryValues(httpProbe.finalUrl).slice(0, 200), status: httpProbe.status };
        // 426 Upgrade Required: port 80 refuses plain http, so nobody is left on it either.
        if (httpProbe.finalUrl.startsWith('https://') || httpProbe.status === 426) return { status: 'pass', evidence };
        // A firewall turning the scanner away says nothing about where a visitor ends up.
        if (blocked(httpProbe.status)) return { status: 'skipped', evidence, skippedReason: 'blocked' };
        return { status: 'fail', evidence };
    },
};
