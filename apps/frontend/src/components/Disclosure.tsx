import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@lib/utils';

type DisclosureProps = {
    open: boolean;
    onToggle: () => void;
    /** Always visible: the button that opens and closes the panel. */
    header: ReactNode;
    children: ReactNode;
    className?: string;
    headerClassName?: string;
};

/**
 * A button that opens a panel under it. The panel animates by growing its grid row (no measured heights), is
 * `inert` while closed so nothing in it takes focus, and `prefers-reduced-motion` turns the animation off.
 */
export const Disclosure = (props: DisclosureProps) => {
    const panelId = useId();
    return (
        <div className={props.className}>
            <button
                type={'button'}
                aria-expanded={props.open}
                aria-controls={panelId}
                onClick={props.onToggle}
                className={cn('flex w-full items-center gap-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', props.headerClassName)}
            >
                {props.header}
                <ChevronDown
                    aria-hidden={'true'}
                    className={cn('size-4 shrink-0 text-subtle-foreground motion-safe:transition-transform', props.open && 'rotate-180')}
                />
            </button>
            <div
                id={panelId}
                inert={!props.open}
                className={cn('grid motion-safe:transition-[grid-template-rows]', props.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
            >
                <div className={'min-h-0 overflow-hidden'}>{props.children}</div>
            </div>
        </div>
    );
};
