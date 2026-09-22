import { Check, ChevronDown } from 'lucide-react';
import {
  Checkbox as RCheckbox,
  Select as RSelect,
  Slider as RSlider,
  Switch as RSwitch,
  ToggleGroup,
} from 'radix-ui';
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '../../lib/utils';

const control =
  'w-full rounded-lg border border-line bg-surface pr-3 pl-3 text-sm text-ink placeholder:text-ink-3 shadow-card transition-colors hover:border-line-2 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(control, 'h-9', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(control, 'min-h-20 py-2 leading-relaxed', className)}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  aside,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  aside?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
              {label}
            </label>
          )}
          {aside}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
      {(label || hint) && (
        <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
          {label && <span className="text-sm text-ink">{label}</span>}
          {hint && <span className="text-xs leading-relaxed text-ink-3">{hint}</span>}
        </label>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <RCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="flex size-4 items-center justify-center rounded border border-line-2 bg-surface data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <RCheckbox.Indicator>
          <Check className="size-3 text-on-accent" strokeWidth={3} />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label && (
        <label htmlFor={id} className="cursor-pointer text-sm text-ink-2">
          {label}
        </label>
      )}
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className,
  size = 'md',
  id,
}: {
  value: T | undefined;
  onChange(v: NoInfer<T>): void;
  options: Option<NoInfer<T>>[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  id?: string;
}) {
  return (
    <RSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RSelect.Trigger
        id={id}
        className={cn(
          control,
          'inline-flex items-center justify-between gap-2 text-left data-[placeholder]:text-ink-3',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9',
          className,
        )}
      >
        <span className="truncate">
          <RSelect.Value placeholder={placeholder} />
        </span>
        <RSelect.Icon>
          <ChevronDown className="size-4 text-ink-3" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line bg-surface shadow-float animate-pop"
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default select-none flex-col rounded-md py-1.5 pr-8 pl-2.5 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                {o.hint && <span className="text-xs text-ink-3">{o.hint}</span>}
                <RSelect.ItemIndicator className="absolute top-2 right-2">
                  <Check className="size-4 text-accent" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange(v: NoInfer<T>): void;
  options: { value: NoInfer<T>; label: ReactNode; count?: number }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium text-ink-2 transition-colors hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-card',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
          )}
        >
          {o.label}
          {o.count != null && (
            <span className="tabular rounded-full bg-surface-3 px-1.5 py-px text-[11px] text-ink-2">
              {o.count}
            </span>
          )}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number;
  onChange(v: number): void;
  min: number;
  max: number;
  step: number;
  className?: string;
}) {
  return (
    <RSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v!)}
      className={cn('relative flex h-5 touch-none select-none items-center', className)}
    >
      <RSlider.Track className="relative h-1.5 grow rounded-full bg-surface-3">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb className="block size-4 rounded-full border-2 border-accent bg-surface shadow focus:outline-none focus-visible:ring-3 focus-visible:ring-accent/25" />
    </RSlider.Root>
  );
}
