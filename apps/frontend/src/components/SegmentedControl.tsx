import { cn } from '@lib/utils';

type Option<T extends string> = { value: T; label: string; count?: number };

type SegmentedControlProps<T extends string> = {
    label: string;
    value: T;
    options: readonly Option<T>[];
    onChange: (value: T) => void;
    className?: string;
};

/** A pill group where exactly one option is on. Each option is a 44 px touch target and responds on pointer-down. */
export const SegmentedControl = <T extends string>(props: SegmentedControlProps<T>) => (
    <div
        role={'group'}
        aria-label={props.label}
        className={cn('inline-flex rounded-4xl bg-secondary p-1', props.className)}
    >
        {props.options.map((option) => {
            const on = option.value === props.value;
            return (
                <button
                    key={option.value}
                    type={'button'}
                    aria-pressed={on}
                    onClick={() => props.onChange(option.value)}
                    className={cn(
                        'text-caption inline-flex min-h-11 items-center gap-1.5 rounded-4xl px-4 whitespace-nowrap outline-none transition-[background-color,color,transform] duration-100 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
                        on ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {option.label}
                    {option.count !== undefined && <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-subtle-foreground')}>{option.count}</span>}
                </button>
            );
        })}
    </div>
);
