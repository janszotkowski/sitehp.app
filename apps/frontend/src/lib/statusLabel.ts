import type { Locale } from '@lib/i18n/switchLocalePath';
import type { RowStatus } from '@lib/reportModel';
import { m } from '@paraglide/messages.js';

/** A row's status in words. Its own module so the status pill (on the home page too) does not pull in the rest of the report model. */
export const statusLabel = (status: RowStatus, locale: Locale): string => {
    if (status === 'pass') return m.check_status_pass({}, { locale });
    if (status === 'warn') return m.check_status_warn({}, { locale });
    if (status === 'fail') return m.check_status_fail({}, { locale });
    if (status === 'skipped') return m.check_status_skipped({}, { locale });
    return m.report_check_running({}, { locale });
};
