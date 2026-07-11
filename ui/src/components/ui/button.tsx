import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_0_24px_rgb(195_244_0/0.18)] hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        outline: "border border-input bg-card/80 text-foreground hover:border-primary/60 hover:bg-accent",
        ghost: "text-foreground hover:bg-accent/80 hover:text-accent-foreground",
        glass: "border border-white/12 bg-white/[0.06] text-foreground backdrop-blur-xl hover:bg-white/[0.1]",
        chip: "border border-white/12 bg-white/[0.08] text-muted-foreground hover:border-primary/50 hover:bg-primary/15 hover:text-foreground",
        chipActive: "border border-primary bg-primary text-primary-foreground shadow-[0_0_18px_rgb(195_244_0/0.22)] hover:bg-primary/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "size-9",
        chip: "h-8 px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
