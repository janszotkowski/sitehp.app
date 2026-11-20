import type { ApiError, ErrorCode } from '@sitehp.app/core/browser';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

/** What the UI knows about a failure: an API code, or `NETWORK` when the server could not be reached at all. */
export type FailureCode = ErrorCode | 'NETWORK';

// By the name the class sets, not `instanceof`: importing the class would bring the API contract's schemas into every page (this backs the router's error view).
const isApiError = (error: unknown): error is ApiError => error instanceof Error && error.name === 'ApiError' && 'code' in error;

// What `fetch` (and a lazy `import()`) throws when the request never got an answer, by browser: Chromium, Node, Firefox, Safari.
const NETWORK_FAILURE = /^(?:Failed to fetch|fetch failed|NetworkError when attempting to fetch|Load failed|Importing a module script failed|error loading dynamically imported module)/i;

/** A request that got no answer: the network failed, or it was aborted or timed out. */
const isNetworkFailure = (error: unknown): boolean =>
    (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));

/** The code of an API error, `NETWORK` only for a request that never got an answer, and `INTERNAL` for anything else (a bug in the page is not a lost connection). */
export const failureCodeOf = (error: unknown): FailureCode => (isApiError(error) ? error.code : isNetworkFailure(error) ? 'NETWORK' : 'INTERNAL');

/** The backend returns stable codes, never prose: the message is chosen here, in the page language. */
export const failureMessage = (code: FailureCode, locale: Locale): string => {
    switch (code) {
        case 'VALIDATION_FAILED':
            return m.error_validation_failed({}, { locale });
        case 'NOT_FOUND':
            return m.error_not_found({}, { locale });
        case 'RATE_LIMITED':
            return m.error_rate_limited({}, { locale });
        case 'UNAUTHORIZED':
            return m.error_unauthorized({}, { locale });
        case 'FORBIDDEN':
            return m.error_forbidden({}, { locale });
        case 'CONFLICT':
            return m.error_conflict({}, { locale });
        case 'DOMAIN_BLOCKED':
            return m.error_domain_blocked({}, { locale });
        case 'NETWORK':
            return m.error_network({}, { locale });
        case 'INTERNAL':
            return m.error_internal({}, { locale });
    }
};
