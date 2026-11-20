import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@lib/utils';

// A select on Base UI in place of the native one, whose list the operating system draws and the app cannot style.
// The trigger looks like `Input`; the list looks like the dropdown menu and opens under the trigger, as wide as it.

export const Select = <Value,>(props: SelectPrimitive.Root.Props<Value>) => <SelectPrimitive.Root {...props} />;

export const SelectTrigger = (props: SelectPrimitive.Trigger.Props) => {
    const { className, children, ...rest } = props;

    return (
        <SelectPrimitive.Trigger
            data-slot={'select-trigger'}
            className={cn(
                'flex h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-input bg-card px-5 text-left text-headline text-foreground outline-none transition-[border-color,box-shadow] duration-100 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:bg-secondary',
                className,
            )}
            {...rest}
        >
            {children}
            <SelectPrimitive.Icon className={'shrink-0 text-muted-foreground transition-transform data-popup-open:rotate-180'}>
                <ChevronDown
                    aria-hidden={'true'}
                    className={'size-4'}
                />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
};

export const SelectValue = (props: SelectPrimitive.Value.Props) => {
    const { className, ...rest } = props;

    return (
        <SelectPrimitive.Value
            data-slot={'select-value'}
            className={cn('truncate data-placeholder:text-subtle-foreground', className)}
            {...rest}
        />
    );
};

type SelectContentProps = SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>;

export const SelectContent = (props: SelectContentProps) => {
    // The positioner takes its own props; the rest goes to the popup.
    const { align = 'start', side = 'bottom', sideOffset = 4, className, ...rest } = props;

    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Positioner
                className={'isolate z-50 outline-none'}
                align={align}
                side={side}
                sideOffset={sideOffset}
                // Under the trigger like a dropdown, not laid over it as the macOS menu is: the label and the field above stay in view.
                alignItemWithTrigger={false}
            >
                <SelectPrimitive.Popup
                    data-slot={'select-content'}
                    className={cn(
                        'max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none motion-safe:transition-[opacity,scale] motion-safe:duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
                        className,
                    )}
                    {...rest}
                />
            </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
    );
};

export const SelectItem = (props: SelectPrimitive.Item.Props) => {
    const { className, children, ...rest } = props;

    return (
        <SelectPrimitive.Item
            data-slot={'select-item'}
            className={cn(
                'relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm pr-2.5 pl-9 text-callout outline-hidden select-none data-highlighted:bg-foreground/10 data-disabled:pointer-events-none data-disabled:opacity-50',
                className,
            )}
            {...rest}
        >
            <SelectPrimitive.ItemIndicator className={'absolute left-2.5 flex size-4 items-center justify-center'}>
                <Check
                    aria-hidden={'true'}
                    className={'size-4'}
                />
            </SelectPrimitive.ItemIndicator>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
};
