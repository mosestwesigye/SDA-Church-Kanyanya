"use client";

import { useTransition } from "react";
import { setThemeAction, type ThemeChoice } from "@/app/theme/actions";

export function ThemeToggle({ current }: { current: ThemeChoice }) {
  const [pending, start] = useTransition();
  const options: [ThemeChoice, string][] = [["system", "Match device"], ["light", "Light"], ["dark", "Dark"]];
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          disabled={pending}
          onClick={() => start(() => setThemeAction(value))}
          className={`min-h-[44px] rounded-[6px] border px-4 text-[14px] ${current === value ? "border-primary bg-primary-soft font-semibold" : "border-line"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
