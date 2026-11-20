import { useState } from 'react';
import { Disclosure } from '@components/Disclosure';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

type RawHeadersProps = { headers: Readonly<Record<string, string>>; locale: Locale };

/** Every response header of the scanned page, collapsed like the sections above it. */
export const RawHeaders = (props: RawHeadersProps) => {
    const [open, setOpen] = useState(false);
    return (
        <div className={'overflow-hidden rounded-lg border bg-card'}>
            <Disclosure
                open={open}
                onToggle={() => setOpen(!open)}
                headerClassName={'p-4 sm:p-5'}
                header={<span className={'text-headline min-w-0 flex-1'}>{m.report_headers_title({}, { locale: props.locale })}</span>}
            >
                <dl className={'flex flex-col gap-3 border-t p-4 sm:p-5'}>
                    {Object.entries(props.headers).map(([name, value]) => (
                        <div
                            key={name}
                            className={'flex flex-col gap-1 sm:flex-row sm:gap-4'}
                        >
                            <dt className={'text-caption font-medium sm:w-56 sm:shrink-0'}>{name}</dt>
                            <dd className={'text-caption break-all text-muted-foreground'}>{value}</dd>
                        </div>
                    ))}
                </dl>
            </Disclosure>
        </div>
    );
};
