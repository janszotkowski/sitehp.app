import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { cn } from '@lib/utils';

// The shadcn dropdown menu (base-maia) on Base UI, cut down to the parts the app uses.

export const DropdownMenu = (props: MenuPrimitive.Root.Props) => <MenuPrimitive.Root {...props} />;

export const DropdownMenuTrigger = (props: MenuPrimitive.Trigger.Props) => (
    <MenuPrimitive.Trigger
        data-slot={'dropdown-menu-trigger'}
        {...props}
    />
);

type DropdownMenuContentProps = MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>;

export const DropdownMenuContent = (props: DropdownMenuContentProps) => {
    // The positioner takes its own props; the rest goes to the popup.
    const { align = 'start', side = 'bottom', sideOffset = 4, className, ...rest } = props;

    return (
        <MenuPrimitive.Portal>
            <MenuPrimitive.Positioner
                className={'isolate z-50 outline-none'}
                align={align}
                side={side}
                sideOffset={sideOffset}
            >
                <MenuPrimitive.Popup
                    data-slot={'dropdown-menu-content'}
                    className={cn(
                        'z-50 max-h-(--available-height) min-w-44 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
                        className,
                    )}
                    {...rest}
                />
            </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
    );
};

export const DropdownMenuGroup = (props: MenuPrimitive.Group.Props) => (
    <MenuPrimitive.Group
        data-slot={'dropdown-menu-group'}
        {...props}
    />
);

export const DropdownMenuLabel = (props: MenuPrimitive.GroupLabel.Props) => {
    const { className, ...rest } = props;

    return (
        <MenuPrimitive.GroupLabel
            data-slot={'dropdown-menu-label'}
            className={cn('text-overline px-2.5 pt-2 pb-1 uppercase text-subtle-foreground', className)}
            {...rest}
        />
    );
};

export const DropdownMenuItem = (props: MenuPrimitive.Item.Props) => {
    const { className, ...rest } = props;

    return (
        <MenuPrimitive.Item
            data-slot={'dropdown-menu-item'}
            className={cn(
                "relative flex cursor-pointer items-center min-h-9 gap-2.5 rounded-sm px-2.5 text-callout outline-hidden select-none data-highlighted:bg-foreground/10 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...rest}
        />
    );
};

export const DropdownMenuSeparator = (props: MenuPrimitive.Separator.Props) => {
    const { className, ...rest } = props;

    return (
        <MenuPrimitive.Separator
            data-slot={'dropdown-menu-separator'}
            className={cn('-mx-1.5 my-1.5 h-px bg-border', className)}
            {...rest}
        />
    );
};
