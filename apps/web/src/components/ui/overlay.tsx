import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DropdownMenu,
  Dialog as RDialog,
  Popover as RPopover,
  Tooltip as RTooltip,
} from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  wide,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount>
              <motion.div
                className={cn(
                  'fixed top-[8vh] left-1/2 z-50 flex max-h-[84vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-2xl border border-line bg-surface shadow-float',
                  wide ? 'max-w-3xl' : 'max-w-lg',
                  className,
                )}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <RDialog.Title className="text-[15px] font-semibold text-ink">
                      {title}
                    </RDialog.Title>
                    {description ? (
                      <RDialog.Description className="mt-1 text-[13px] leading-relaxed text-ink-3">
                        {description}
                      </RDialog.Description>
                    ) : (
                      <RDialog.Description className="sr-only">{title}</RDialog.Description>
                    )}
                  </div>
                  <RDialog.Close
                    className="-mr-1 rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </RDialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
                {footer && (
                  <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
                    {footer}
                  </div>
                )}
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

/** A panel sliding in from the right, for details that keep the list visible. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount>
              <motion.div
                className="fixed top-0 right-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-float"
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 40, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.2, 0.9, 0.3, 1] }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                  <RDialog.Title className="truncate text-[15px] font-semibold">
                    {title}
                  </RDialog.Title>
                  <RDialog.Description className="sr-only">{title}</RDialog.Description>
                  <div className="flex items-center gap-1">
                    {actions}
                    <RDialog.Close
                      className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                      aria-label="Close"
                    >
                      <X className="size-4" />
                    </RDialog.Close>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-lg bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-bg shadow-float animate-pop"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Popover({
  trigger,
  children,
  align = 'start',
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          className="z-50 rounded-xl border border-line bg-surface p-3 shadow-float animate-pop"
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const Menu = {
  Root: DropdownMenu.Root,
  Trigger: DropdownMenu.Trigger,
  Content({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
    return (
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-float animate-pop"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    );
  },
  Item({
    children,
    onSelect,
    icon,
    danger,
    shortcut,
  }: {
    children: ReactNode;
    onSelect?(): void;
    icon?: ReactNode;
    danger?: boolean;
    shortcut?: ReactNode;
  }) {
    return (
      <DropdownMenu.Item
        onSelect={onSelect}
        className={cn(
          'flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2',
          danger ? 'text-danger' : 'text-ink',
        )}
      >
        {icon && <span className="text-ink-3 [&>svg]:size-4">{icon}</span>}
        <span className="flex-1">{children}</span>
        {shortcut && <span className="text-xs text-ink-3">{shortcut}</span>}
      </DropdownMenu.Item>
    );
  },
  Label({ children }: { children: ReactNode }) {
    return (
      <DropdownMenu.Label className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
        {children}
      </DropdownMenu.Label>
    );
  },
  Separator() {
    return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
  },
  RadioGroup: DropdownMenu.RadioGroup,
  Radio({ value, children, icon }: { value: string; children: ReactNode; icon?: ReactNode }) {
    return (
      <DropdownMenu.RadioItem
        value={value}
        className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium"
      >
        {icon && <span className="text-ink-3 [&>svg]:size-4">{icon}</span>}
        <span className="flex-1">{children}</span>
        <DropdownMenu.ItemIndicator>
          <span className="size-1.5 rounded-full bg-accent" />
        </DropdownMenu.ItemIndicator>
      </DropdownMenu.RadioItem>
    );
  },
};
