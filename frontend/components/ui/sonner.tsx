"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// shadcn's Sonner component, adapted to this dashboard: pinned to the light
// theme (globals.css is deliberately light-only, so there's no next-themes
// provider) and styled from Neuron's own tokens instead of shadcn's
// --popover/--radius variables, which this project doesn't define.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-accent" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className="size-4 animate-spin text-fg-3" />,
      }}
      style={
        {
          "--normal-bg": "var(--elevated)",
          "--normal-text": "var(--fg)",
          "--normal-border": "var(--border)",
          "--border-radius": "0.75rem",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          description: "!text-fg-2",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
