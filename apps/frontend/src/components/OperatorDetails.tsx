import { OPERATOR } from '@config/operator';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

type OperatorDetailsProps = { locale: Locale };

/** Who runs the site and how to reach them, as an `<address>` so a machine and a screen reader know what it is. */
export const OperatorDetails = (props: OperatorDetailsProps) => (
    <address className={'flex flex-col gap-0.5 text-callout not-italic text-muted-foreground'}>
        <span className={'font-medium text-foreground'}>{OPERATOR.name}</span>
        <a
            href={OPERATOR.x}
            className={'inline-flex min-h-8 items-center text-link underline-offset-4 hover:underline'}
        >
            {m.operator_x({}, { locale: props.locale })}
        </a>
        <a
            href={OPERATOR.url}
            className={'inline-flex min-h-8 items-center text-link underline-offset-4 hover:underline'}
        >
            {m.operator_github({}, { locale: props.locale })}
        </a>
    </address>
);
