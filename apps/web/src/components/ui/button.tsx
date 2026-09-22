import { Loader2 } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

const variants = {
  primary: 'bg-ink text-bg hover:bg-ink/85 shadow-card',
  accent: 'bg-accent text-on-accent hover:bg-accent-2 shadow-card',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-2 shadow-card',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-card',
  'danger-ghost': 'text-danger hover:bg-danger/10',
} as const;

const sizes = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading,
    icon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,border,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  function IconButton({ label, size = 'sm', className, ...rest }, ref) {
    const square = { xs: 'w-7 px-0', sm: 'w-8 px-0', md: 'w-9 px-0', lg: 'w-11 px-0' }[size];
    return (
      <Button
        ref={ref}
        aria-label={label}
        title={label}
        size={size}
        variant="ghost"
        className={cn(square, className)}
        {...rest}
      />
    );
  },
);
