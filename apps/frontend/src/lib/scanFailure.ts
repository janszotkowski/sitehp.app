import type { ScanFailureReason } from '@sitehp.app/core/browser';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

/** Why a scan failed, in the page language. The backend sends a reason code, never prose. */
export const failureReasonMessage = (reason: ScanFailureReason | null, locale: Locale): string => {
    switch (reason) {
        case 'blocked_address':
            return m.report_failed_blocked_address({}, { locale });
        case 'unreachable':
            return m.report_failed_unreachable({}, { locale });
        case 'timeout':
            return m.report_failed_timeout({}, { locale });
        case 'too_many_redirects':
            return m.report_failed_too_many_redirects({}, { locale });
        case 'tls_error':
            return m.report_failed_tls_error({}, { locale });
        case 'invalid_response':
            return m.report_failed_invalid_response({}, { locale });
        case 'internal_error':
        case null:
            return m.report_failed_internal_error({}, { locale });
    }
};
