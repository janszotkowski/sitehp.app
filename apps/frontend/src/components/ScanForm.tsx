import { ALWAYS_CHECKED, CHECKS, displayUrl, type UrlRejection } from '@sitehp.app/core/browser';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ScanChecksPopover } from '@components/ScanChecksPopover';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { failureMessage } from '@lib/apiErrors';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { MAX_URL_LENGTH, checkScanInput } from '@lib/scanInput';
import { HERO_SCAN_FIELD_ID, NAV_SCAN_FIELD_ID, shortcutLabel } from '@lib/scanShortcut';
import { useHydrated } from '@lib/useHydrated';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

const REJECTION_MESSAGE: Record<UrlRejection, (locale: ReturnType<typeof asLocale>) => string> = {
    EMPTY: (locale) => m.scan_url_empty({}, { locale }),
    TOO_LONG: (locale) => m.scan_url_too_long({}, { locale }),
    INVALID: (locale) => m.scan_url_invalid({}, { locale }),
    UNSUPPORTED_SCHEME: (locale) => m.scan_url_scheme({}, { locale }),
    CREDENTIALS: (locale) => m.scan_url_credentials({}, { locale }),
    CUSTOM_PORT: (locale) => m.scan_url_port({}, { locale }),
    HOST_NOT_ALLOWED: (locale) => m.scan_url_host({}, { locale }),
};

const isRejection = (value: string): value is UrlRejection => value in REJECTION_MESSAGE;

// The header form's messages float under the field, so the bar never changes height.
const messageFloat = 'absolute top-full left-4 mt-1 text-caption';

// Fetched when a scan field gets the focus, so it is usually here by the time the address is in; a failed load is retried on the next try.
let scanStart: Promise<typeof import('@lib/scanStart')> | undefined;
const loadScanStart = (): Promise<typeof import('@lib/scanStart')> =>
    (scanStart ??= import('@lib/scanStart').catch((error: unknown) => {
        scanStart = undefined;
        throw error;
    }));

type ScanFormProps = {
    /** `hero` is the landing page's form, with its label and the preview of what will be scanned. `compact` is the header's: one line, the label spoken only, the error floating under the field, a hint for the shortcut. */
    variant?: 'hero' | 'compact';
};

/**
 * The scan entry point: validates the address as the person types it, starts the scan
 * and moves to the report. The navigation is client-side and uses a view transition, so
 * the demo ring becomes the real one instead of the page being replaced.
 */
export const ScanForm = (props: ScanFormProps) => {
    const compact = props.variant === 'compact';
    const fieldId = compact ? NAV_SCAN_FIELD_ID : HERO_SCAN_FIELD_ID;
    const locale = asLocale(getLocale());
    const navigate = useNavigate();
    const router = useRouter();
    const [value, setValue] = useState('');
    // Show a problem only once the person has finished typing (left the field or tried to submit), then keep it up to date on every key.
    const [touched, setTouched] = useState(false);
    const [serverError, setServerError] = useState<string | undefined>(undefined);
    // What a screen reader hears: set on submit and on leaving the field, not on every key (the visible message follows each key).
    const [announcement, setAnnouncement] = useState('');
    const [pending, setPending] = useState(false);
    // "Customize scan" (the landing page's form only): every check is chosen to begin with.
    const [customizing, setCustomizing] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(() => new Set(CHECKS.map((check) => check.id)));
    // Said by the choice, not the address field: the address can be fine while the choice is empty.
    const [choiceError, setChoiceError] = useState<string | undefined>(undefined);
    const allSelected = selected.size === CHECKS.length;
    // State lands on the next render; a second Enter in the same moment must already see the first submit.
    const busy = useRef(false);
    const field = useRef<HTMLInputElement>(null);
    const hydrated = useHydrated();
    // The server cannot know the platform, so it renders the common label and the browser's own replaces it after hydration.
    const hint = useSyncExternalStore(
        () => () => undefined,
        () => shortcutLabel(navigator.platform),
        () => shortcutLabel(''),
    );

    const rejectionOf = (text: string): string | undefined => {
        const checked = checkScanInput(text);
        return checked.kind === 'valid' ? undefined : REJECTION_MESSAGE[checked.kind === 'empty' ? 'EMPTY' : checked.reason](locale);
    };
    const input = checkScanInput(value);
    const localError = touched ? rejectionOf(value) : undefined;
    const error = localError ?? serverError;
    // What will really be scanned, with an international name shown as typed rather than as `xn--…`.
    const preview = input.kind === 'valid' ? displayUrl(input.href) : undefined;

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy.current) return;

        // The same rules the server applies; the server stays the authority.
        setTouched(true);
        setAnnouncement(rejectionOf(value) ?? '');
        if (input.kind !== 'valid') {
            // Say where the problem is: the field with the error gets the focus, so the message that follows is read in context.
            field.current?.focus();
            return;
        }

        // A choice with nothing in it but the check that always runs would scan for nothing.
        if (!compact && !allSelected && ![...selected].some((id) => !ALWAYS_CHECKED.includes(id))) {
            const message = m.scan_customize_none({}, { locale });
            setCustomizing(true);
            setChoiceError(message);
            setAnnouncement(message);
            return;
        }
        setChoiceError(undefined);

        setServerError(undefined);
        busy.current = true;
        setPending(true);
        const fail = (message: string) => {
            setServerError(message);
            setAnnouncement(message);
            busy.current = false;
            setPending(false);
        };
        const reset = () => {
            setValue('');
            setTouched(false);
            busy.current = false;
            setPending(false);
        };
        // The page this scan was started from: if the person has moved on while it started, they are not pulled to the report.
        const startedAt = router.state.location.href;
        try {
            const started = await (await loadScanStart()).startScan(value, compact || allSelected ? undefined : [...selected]);
            if (!started.ok) {
                const reason = started.urlReason;
                fail(reason !== undefined && isRejection(reason) ? REJECTION_MESSAGE[reason](locale) : failureMessage(started.failure, locale));
                return;
            }
            if (router.state.location.href !== startedAt) {
                reset();
                return;
            }
            const { publicId } = started;
            await navigate({ to: '/$locale/r/$publicId', params: { locale, publicId }, viewTransition: true });
            // The field lives on in the header: it is emptied for the next address, and the page change has already announced the report.
            if (compact) reset();
        } catch {
            // The scan code could not be loaded, or the page change failed: both mean the network let the person down.
            fail(failureMessage('NETWORK', locale));
        }
    };

    const errorId = `${fieldId}-error`;
    const loadingId = `${fieldId}-loading`;

    return (
        <form
            onSubmit={(event) => void submit(event)}
            noValidate
            // Until the page is live this handler is not attached, and a plain form would reload the page with the text in the address. `dialog` outside a dialog does nothing.
            method={'dialog'}
            className={compact ? 'relative flex w-full min-w-0 max-w-xl items-center gap-2' : 'flex w-full max-w-xl flex-col gap-3'}
        >
            <label
                htmlFor={fieldId}
                className={compact ? 'sr-only' : 'text-caption text-left text-muted-foreground'}
            >
                {m.scan_form_label({}, { locale })}
            </label>
            <div className={compact ? 'flex min-w-0 flex-1 gap-2' : 'flex flex-col gap-3 sm:flex-row'}>
                <div className={'relative min-w-0 flex-1'}>
                    <Input
                        ref={field}
                        id={fieldId}
                        name={'url'}
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            setServerError(undefined);
                        }}
                        onFocus={() => void loadScanStart().catch(() => undefined)}
                        onBlur={() => {
                            const leftWithText = value.trim() !== '';
                            setTouched(leftWithText);
                            if (leftWithText) setAnnouncement(rejectionOf(value) ?? '');
                        }}
                        // Text typed before hydration would sit in the field while the state is still empty, so the field waits for the page.
                        readOnly={!hydrated}
                        aria-busy={!hydrated}
                        maxLength={MAX_URL_LENGTH}
                        placeholder={m.scan_form_placeholder({}, { locale })}
                        inputMode={'url'}
                        autoComplete={'url'}
                        autoCapitalize={'none'}
                        spellCheck={false}
                        aria-invalid={error !== undefined}
                        aria-describedby={error === undefined ? (hydrated ? undefined : loadingId) : errorId}
                        aria-keyshortcuts={compact ? 'Control+K Meta+K' : undefined}
                        className={compact ? 'peer h-11 rounded-full px-4 text-callout md:pr-16' : undefined}
                    />
                    {compact && (
                        <kbd
                            aria-hidden={'true'}
                            className={
                                'pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-md border bg-background/60 px-1.5 py-0.5 text-caption text-subtle-foreground peer-focus:hidden peer-[:not(:placeholder-shown)]:hidden md:block'
                            }
                        >
                            {hint}
                        </kbd>
                    )}
                </div>
                {/* Focusable while disabled (`aria-disabled`), so the focus stays on the button while the scan starts. */}
                <Button
                    type={'submit'}
                    size={compact ? 'default' : 'lg'}
                    disabled={pending}
                    focusableWhenDisabled
                    className={cn('aria-disabled:opacity-50', compact && 'rounded-full')}
                >
                    {pending ? m.scan_form_submitting({}, { locale }) : m.scan_form_submit({}, { locale })}
                </Button>
            </div>
            {!compact && (
                <div className={'flex flex-col gap-3'}>
                    <ScanChecksPopover
                        selected={selected}
                        onChange={(next) => {
                            setSelected(next);
                            setChoiceError(undefined);
                        }}
                        open={customizing}
                        onOpenChange={setCustomizing}
                        describedBy={choiceError === undefined ? undefined : 'scan-customize-error'}
                        locale={locale}
                        className={'self-start'}
                    />
                    {choiceError !== undefined && (
                        <p
                            id={'scan-customize-error'}
                            className={'text-caption text-left text-destructive'}
                        >
                            {choiceError}
                        </p>
                    )}
                </div>
            )}
            {/* Always in the page, so a screen reader is already watching it when a message arrives; it changes only on submit or leaving the field. */}
            <p
                aria-live={'polite'}
                className={'sr-only'}
            >
                {announcement}
            </p>
            {/* The message as it stands, read with the field (`aria-describedby`). In the header it floats under the field, so the bar never changes height. */}
            <p
                id={errorId}
                className={cn(compact ? messageFloat : 'min-h-5 text-caption', 'text-destructive')}
            >
                {error}
            </p>
            {/* A slow load only: the hint fades in after a second, so a page that comes alive at once never shows it. */}
            {!hydrated && (
                <p
                    id={loadingId}
                    className={cn(compact ? messageFloat : '-mt-3 text-caption', 'delayed-hint text-subtle-foreground')}
                >
                    {m.scan_form_loading({}, { locale })}
                </p>
            )}
            <noscript>
                <p className={cn(compact ? messageFloat : 'text-caption', 'text-muted-foreground')}>{m.scan_form_no_js({}, { locale })}</p>
            </noscript>
            {!compact && error === undefined && preview !== undefined && value.trim() !== preview && (
                <p className={'-mt-3 break-all text-caption text-subtle-foreground'}>{m.scan_form_preview({ url: preview }, { locale })}</p>
            )}
        </form>
    );
};
