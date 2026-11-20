import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@lib/utils';

// A popover on Base UI, in the shape of the dropdown menu beside it: content that floats over the page on glass, so opening it never moves the page.

export const Popover = (props: PopoverPrimitive.Root.Props) => <PopoverPrimitive.Root {...props} />;

export const PopoverTrigger = (props: PopoverPrimitive.Trigger.Props) => (
    <PopoverPrimitive.Trigger
        data-slot={'popover-trigger'}
        {...props}
    />
);

type PopoverContentProps = PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset' | 'collisionPadding' | 'collisionAvoidance'>;

/** The floating panel. Its width and height are the caller's (`className`); by default it is never taller than the room it has. */
export const PopoverContent = (props: PopoverContentProps) => {
    // The positioner takes its own props; the rest goes to the popup.
    const { align = 'start', side = 'bottom', sideOffset = 8, collisionPadding = 16, collisionAvoidance, className, ...rest } = props;

    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner
                className={'isolate z-50 outline-none'}
                align={align}
                side={side}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                {...(collisionAvoidance === undefined ? {} : { collisionAvoidance })}
            >
                <PopoverPrimitive.Popup
                    data-slot={'popover-content'}
                    className={cn(
                        'glass flex max-h-(--available-height) max-w-[calc(100vw-2rem)] origin-(--transform-origin) flex-col rounded-md text-left text-popover-foreground outline-none motion-safe:transition-[opacity,scale] motion-safe:duration-150 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0',
                        className,
                    )}
                    {...rest}
                />
            </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
    );
};

export const PopoverTitle = (props: PopoverPrimitive.Title.Props) => {
    const { className, ...rest } = props;

    return (
        <PopoverPrimitive.Title
            data-slot={'popover-title'}
            className={cn('text-headline border-b px-4 py-3', className)}
            {...rest}
        />
    );
};

export const PopoverClose = (props: PopoverPrimitive.Close.Props) => (
    <PopoverPrimitive.Close
        data-slot={'popover-close'}
        {...props}
    />
);
