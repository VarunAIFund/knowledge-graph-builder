"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const liquidbuttonVariants = cva(
  "relative inline-flex items-center justify-center cursor-pointer gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none select-none",
  {
    variants: {
      variant: {
        default: "text-[#1c1c1e] hover:text-black active:scale-[0.97] transition-transform duration-100",
        accent:  "text-[#5856d6] hover:text-[#4a48c0] active:scale-[0.97] transition-transform duration-100",
        ghost:   "text-[#6e6e73] hover:text-[#1c1c1e] active:scale-[0.97] transition-transform duration-100",
      },
      size: {
        xs:      "h-7  px-2.5 rounded-lg  text-[11px] [&_svg]:size-3",
        sm:      "h-8  px-3   rounded-xl  text-xs     [&_svg]:size-3.5",
        default: "h-9  px-4   rounded-xl  [&_svg]:size-4",
        lg:      "h-10 px-6   rounded-2xl [&_svg]:size-4",
        icon:    "size-8      rounded-xl  [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface LiquidButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidbuttonVariants> {
  asChild?: boolean
  /** Override the glass tint, e.g. "rgba(88,86,214,0.12)" for accent */
  tint?: string
}

const LiquidButton = React.forwardRef<HTMLButtonElement, LiquidButtonProps>(
  ({ className, variant, size, asChild = false, tint, children, style, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(liquidbuttonVariants({ variant, size, className }))}
        style={style}
        {...props}
      >
        {/* Frosted glass layer */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-[inherit] pointer-events-none"
          style={{
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
          }}
        />
        {/* Tint + specular border — Apple macOS style */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-[inherit] pointer-events-none"
          style={{
            background: tint ?? "rgba(255, 255, 255, 0.72)",
            boxShadow: [
              /* top specular — brightest edge */
              "inset 0 1.5px 0 rgba(255, 255, 255, 0.95)",
              /* bottom shadow */
              "inset 0 -1px 0 rgba(0, 0, 0, 0.05)",
              /* left specular */
              "inset 1px 0 0 rgba(255, 255, 255, 0.6)",
              /* hairline outer border */
              "0 0 0 0.5px rgba(0, 0, 0, 0.1)",
              /* drop shadow */
              "0 2px 12px rgba(60, 60, 120, 0.1)",
              "0 1px 3px rgba(60, 60, 120, 0.06)",
            ].join(", "),
          }}
        />
        {/* Content */}
        <span className="relative z-10 flex items-center gap-[inherit]">
          {children}
        </span>
      </Comp>
    )
  }
)
LiquidButton.displayName = "LiquidButton"

export { LiquidButton, liquidbuttonVariants }
