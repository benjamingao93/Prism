"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

/** True only after hydration; the saved theme is unknown during server rendering. */
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = OPTIONS.find((o) => o.value === (mounted ? theme : "system")) ?? OPTIONS[0];

  return (
    <Select value={current.value} onValueChange={setTheme}>
      <SelectTrigger
        size="sm"
        aria-label={`Theme: ${current.label}`}
        title="Theme: light, dark or match your system"
        className="h-8 min-w-8 justify-center gap-1.5 bg-surface px-2 sm:justify-start [&>svg:last-child]:hidden"
      >
        <current.Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="hidden text-sm sm:inline">{current.label}</span>
      </SelectTrigger>
      <SelectContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <SelectItem key={value} value={value}>
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
