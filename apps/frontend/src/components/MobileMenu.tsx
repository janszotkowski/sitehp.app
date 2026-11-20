import { Dialog } from '@base-ui/react/dialog';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect, type RefObject } from 'react';
import { ThemeToggle } from '@components/ThemeToggle';
import { Button } from '@components/ui/button';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

export type NavLink = { to: '/$locale/methodology' | '/$locale/about' | '/$locale/blog'; label: (locale: Locale) => string };

type MobileMenuProps = {
    links: readonly NavLink[];
    locale: Locale;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Menu button in the header, which gets the focus back when the menu closes. */
    trigger: RefObject<HTMLButtonElement | null>;
    /** Called once the dialog is in the page. It must be mounted closed and opened after: one mounted open skips the move of the focus into it. */
    onMounted: () => void;
};

const iconButton = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The navigation on a phone: a full-screen layer with the links at the bottom, where the thumb is, and a Close button
 * under them; the usual X stays at the top where the Menu button was. Base UI's Dialog gives the focus trap, Escape,
 * the scroll lock and the focus back on the Menu button. The button itself lives in the header, so this file (and Base UI's
 * dialog behind it) is loaded only when a phone user reaches for the menu.
 */
export const MobileMenu = (props: MobileMenuProps) => {
    const { locale, onMounted } = props;
    useEffect(onMounted, [onMounted]);
    return (
        <Dialog.Root
            open={props.open}
            onOpenChange={props.onOpenChange}
        >
            <Dialog.Portal>
                <Dialog.Popup
                    finalFocus={props.trigger}
                    className={
                        'fixed inset-0 z-50 flex flex-col bg-background pb-[max(1rem,env(safe-area-inset-bottom))] outline-none motion-safe:transition-opacity motion-safe:duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0'
                    }
                >
                    <div className={'flex h-(--site-header-height) shrink-0 items-center justify-between border-b px-4'}>
                        <span
                            aria-hidden={'true'}
                            className={'text-headline tracking-tight'}
                        >
                            sitehp.app
                        </span>
                        <Dialog.Title className={'sr-only'}>{m.nav_menu({}, { locale })}</Dialog.Title>
                        <Dialog.Close
                            aria-label={m.nav_close_menu({}, { locale })}
                            className={iconButton}
                        >
                            <X aria-hidden={'true'} />
                        </Dialog.Close>
                    </div>
                    <nav
                        aria-label={m.nav_label({}, { locale })}
                        className={'mt-auto px-4'}
                    >
                        <ul className={'flex flex-col border-t'}>
                            {props.links.map((link) => (
                                <li
                                    key={link.to}
                                    className={'border-b'}
                                >
                                    <Link
                                        to={link.to}
                                        params={{ locale }}
                                        activeProps={{ 'aria-current': 'page', className: 'text-foreground' }}
                                        onClick={() => props.onOpenChange(false)}
                                        className={
                                            'text-title-1 flex min-h-16 items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground'
                                        }
                                    >
                                        {link.label(locale)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                    <div className={'flex flex-col gap-3 px-4 pt-4'}>
                        <ThemeToggle
                            locale={locale}
                            showLabel
                            className={'text-callout justify-start self-start'}
                        />
                        <Dialog.Close
                            render={
                                <Button
                                    variant={'secondary'}
                                    size={'lg'}
                                    className={'w-full'}
                                />
                            }
                        >
                            {m.nav_close({}, { locale })}
                        </Dialog.Close>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
