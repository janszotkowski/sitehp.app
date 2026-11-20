import { Check, Copy, X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@components/ui/button';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { useCopy } from '@lib/useCopy';
import { m } from '@paraglide/messages.js';

/**
 * Copies `getText()` to the clipboard and says so for a moment, or says it could not (no permission, insecure page).
 * The text is built on click only: the whole report as JSON is not worth building on every render.
 */
type CopyButtonProps = { getText: () => string; label?: string; locale: Locale; className?: string; variant?: ComponentProps<typeof Button>['variant'] };

export const CopyButton = (props: CopyButtonProps) => {
    const { state, copy } = useCopy();
    const { locale } = props;
    const Icon = state === 'copied' ? Check : state === 'failed' ? X : Copy;
    const text = state === 'copied' ? m.report_detail_copied({}, { locale }) : state === 'failed' ? m.report_copy_failed({}, { locale }) : (props.label ?? m.report_detail_copy({}, { locale }));

    return (
        <Button
            type={'button'}
            variant={props.variant ?? 'ghost'}
            size={'sm'}
            onClick={() => copy(props.getText())}
            className={props.className}
        >
            <Icon aria-hidden={'true'} />
            <span aria-live={'polite'}>{text}</span>
        </Button>
    );
};
