import * as React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ref, ...props }: React.ComponentProps<"div">) {
  return <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />;
}

export function CardHeader({ className, ref, ...props }: React.ComponentProps<"div">) {
  return <div ref={ref} className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />;
}

export function CardContent({ className, ref, ...props }: React.ComponentProps<"div">) {
  return <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />;
}
