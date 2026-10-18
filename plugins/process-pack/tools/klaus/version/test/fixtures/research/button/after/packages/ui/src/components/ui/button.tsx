import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../../lib/utils";

const buttonVariants = cva(
  "btn inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "btn-primary",
        secondary: "btn-secondary",
        destructive: "btn-destructive",
        outline: "btn-outline",
        ghost: "btn-ghost",
        link: "btn-link",
      },
      size: {
        sm: "btn-sm",
        compact: "btn-compact",
        "compact-sm": "btn-compact-sm",
        md: "btn-md",
        lg: "btn-lg",
        xl: "btn-xl",
        "icon-sm": "btn-icon-sm",
        icon: "btn-icon",
        "icon-lg": "btn-icon-lg",
      },
      width: {
        auto: "",
        full: "btn-full",
      },
      loading: {
        true: "btn-loading",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      width: "auto",
      loading: false,
    },
  }
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, width, loading, asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, width, loading, className })
        )}
        disabled={loading || props.disabled}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
