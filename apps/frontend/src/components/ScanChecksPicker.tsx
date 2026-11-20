import { ALWAYS_CHECKED, CATEGORIES, CHECKS } from '@sitehp.app/core/browser';
import { useEffect, useRef } from 'react';
import { Button } from '@components/ui/button';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { categoryTitle } from '@lib/reportTitles';
import { m } from '@paraglide/messages.js';

type ScanChecksPickerProps = {
    selected: ReadonlySet<string>;
    onChange: (next: Set<string>) => void;
    locale: Locale;
};

const box = 'size-5 shrink-0 accent-[var(--foreground)]';

type CategoryBoxProps = { checked: boolean; indeterminate: boolean; onToggle: (on: boolean) => void; label: string };

/** The checkbox of a whole category: checked when all its checks are, in between when some are. */
const CategoryBox = (props: CategoryBoxProps) => {
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (input.current !== null) input.current.indeterminate = props.indeterminate;
    }, [props.indeterminate]);
    return (
        <label className={'text-callout flex min-h-11 items-center gap-3 font-medium'}>
            <input
                ref={input}
                type={'checkbox'}
                checked={props.checked}
                onChange={(event) => props.onToggle(event.target.checked)}
                className={box}
            />
            {props.label}
        </label>
    );
};

/**
 * Which checks a scan runs, by category and one by one: the landing page's "Customize scan". Everything is chosen to begin with. A check that must
 * always run (`ALWAYS_CHECKED`) is shown ticked and cannot be cleared. One column on a phone, two from `sm`.
 */
export const ScanChecksPicker = (props: ScanChecksPickerProps) => {
    const { selected, locale } = props;
    const groups = CATEGORIES.map((category) => ({ category, checks: CHECKS.filter((check) => check.category === category) })).filter((group) => group.checks.length > 0);

    const set = (ids: readonly string[], on: boolean) => {
        const next = new Set(selected);
        for (const id of ids) {
            if (on || ALWAYS_CHECKED.includes(id)) next.add(id);
            else next.delete(id);
        }
        props.onChange(next);
    };

    return (
        <div className={'flex flex-col gap-4 text-left'}>
            <div className={'flex flex-wrap gap-2'}>
                <Button
                    type={'button'}
                    variant={'outline'}
                    size={'sm'}
                    onClick={() =>
                        set(
                            CHECKS.map((check) => check.id),
                            true,
                        )
                    }
                >
                    {m.scan_customize_all({}, { locale })}
                </Button>
                <Button
                    type={'button'}
                    variant={'outline'}
                    size={'sm'}
                    onClick={() =>
                        set(
                            CHECKS.map((check) => check.id),
                            false,
                        )
                    }
                >
                    {m.scan_customize_clear({}, { locale })}
                </Button>
            </div>
            {groups.map(({ category, checks }) => {
                const ids = checks.map((check) => check.id);
                const count = ids.filter((id) => selected.has(id)).length;
                return (
                    <fieldset
                        key={category}
                        className={'flex flex-col'}
                    >
                        <legend className={'sr-only'}>{categoryTitle(category, locale)}</legend>
                        <CategoryBox
                            checked={count === ids.length}
                            indeterminate={count > 0 && count < ids.length}
                            onToggle={(on) => set(ids, on)}
                            label={m.scan_customize_category({ category: categoryTitle(category, locale), count, total: ids.length }, { locale })}
                        />
                        <ul className={'grid gap-x-6 pl-8 sm:grid-cols-2'}>
                            {checks.map((check) => {
                                const locked = ALWAYS_CHECKED.includes(check.id);
                                return (
                                    <li key={check.id}>
                                        <label className={'text-callout flex min-h-11 items-center gap-3 text-muted-foreground has-[:checked]:text-foreground'}>
                                            <input
                                                type={'checkbox'}
                                                checked={selected.has(check.id)}
                                                disabled={locked}
                                                onChange={(event) => set([check.id], event.target.checked)}
                                                className={box}
                                            />
                                            <span>
                                                {checkText(check.id, locale).title}
                                                {locked && <span className={'text-caption block text-subtle-foreground'}>{m.scan_customize_locked({}, { locale })}</span>}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </fieldset>
                );
            })}
        </div>
    );
};
