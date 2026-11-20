import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { currentTheme, setTheme, type Theme } from '@lib/theme';
import { useHydrated } from '@lib/useHydrated';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';

type ThemeToggleProps = { locale: Locale; className?: string; showLabel?: boolean };

/**
 * Switches between the dark and the light theme and remembers the choice. The server cannot know the theme
 * (the boot script picks it before paint), so the button reads it once mounted and shows the other one as the action.
 */
export const ThemeToggle = (props: ThemeToggleProps) => {
    const { locale } = props;
    const hydrated = useHydrated();
    const [chosen, setChosen] = useState<Theme | undefined>(undefined);
    // The server renders dark; once hydrated the page's real theme is read from the document.
    const theme = chosen ?? (hydrated ? currentTheme() : 'dark');

    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const label = next === 'light' ? m.theme_to_light({}, { locale }) : m.theme_to_dark({}, { locale });
    const Icon = next === 'light' ? Sun : Moon;

    return (
        <button
            type={'button'}
            aria-label={props.showLabel === true ? undefined : label}
            onClick={() => {
                setTheme(next);
                setChosen(next);
            }}
            className={cn(
                'inline-flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                props.className,
            )}
        >
            <Icon
                aria-hidden={'true'}
                className={'size-5'}
            />
            {props.showLabel === true && <span>{label}</span>}
        </button>
    );
};
