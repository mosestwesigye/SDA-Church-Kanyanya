"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/* ───────── Icons (24px grid, stroke = currentColor) ───────── */

const ICONS: Record<string, React.ReactNode> = {
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.2 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </>
  ),
  arrowLeft: <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  arrowRight: <path d="M5 12h14m0 0-6-6m6 6-6 6" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.2 2.5 3.5 5.2" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 3.5v5h5M12 7.5V12l3 2" />
    </>
  ),
};

export function AuthIcon({ name, className = "size-[18px]" }: { name: keyof typeof ICONS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/* ───────── Page pieces ───────── */

/** Staff / Member switch shown above the sign-in forms. */
export function AuthTabs() {
  const path = usePathname();
  const member = path.startsWith("/login/phone");
  const tab = (href: string, label: string, icon: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-[7px] text-[14px] transition-colors ${
        active ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line" : "text-ink-2 hover:text-ink"
      }`}
    >
      <AuthIcon name={icon} className="size-4" />
      {label}
    </Link>
  );
  return (
    <nav aria-label="Who is signing in" className="mb-8 flex gap-1 rounded-[10px] bg-surface-2 p-1">
      {tab("/login", "Church staff", "lock", !member)}
      {tab("/login/phone", "Member", "phone", member)}
    </nav>
  );
}

export function AuthHeader({ icon, eyebrow, title, children }: { icon?: string; eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-7">
      {icon && (
        <span className="mb-5 grid size-11 place-items-center rounded-[10px] bg-primary-soft text-primary ring-1 ring-primary/15">
          <AuthIcon name={icon} className="size-[22px]" />
        </span>
      )}
      {eyebrow && <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-primary">{eyebrow}</p>}
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] md:text-[30px]">{title}</h1>
      {children && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{children}</p>}
    </header>
  );
}

/** Text input with a leading icon. Extra props go to the <input>. */
export function IconField({
  id,
  label,
  icon,
  aside,
  hint,
  prefix,
  ...input
}: { id: string; label: string; icon: string; aside?: React.ReactNode; hint?: React.ReactNode; prefix?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3">
          <AuthIcon name={icon} />
          {prefix && <span className="ml-2 border-r border-line pr-2.5 text-[15px] font-medium text-ink-2">{prefix}</span>}
        </span>
        <input id={id} className={`input min-h-[48px] ${prefix ? "pl-[86px]" : "pl-11"}`} {...input} />
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-ink-2">{hint}</p>}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({ id, label, aside, hint, ...input }: { id: string; label: string; aside?: React.ReactNode; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3">
          <AuthIcon name="lock" />
        </span>
        <input id={id} type={show ? "text" : "password"} className="input min-h-[48px] pl-11 pr-12" {...input} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-[6px] text-ink-3 hover:text-ink"
        >
          <AuthIcon name={show ? "eyeOff" : "eye"} />
        </button>
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-ink-2">{hint}</p>}
    </div>
  );
}

/** Error / success message with an icon. */
export function AuthAlert({ state }: { state?: { error?: string; ok?: string } }) {
  if (!state?.error && !state?.ok) return null;
  const error = Boolean(state.error);
  return (
    <div role={error ? "alert" : "status"} className={`flex gap-2.5 rounded-[8px] border px-3.5 py-3 text-[14px] ${error ? "border-error/30 bg-error-soft text-error" : "border-primary/20 bg-primary-soft text-primary"}`}>
      <span className="mt-px font-bold" aria-hidden>{error ? "!" : "✓"}</span>
      <span>{state.error ?? state.ok}</span>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium text-ink-2 hover:text-ink">
      <AuthIcon name="arrowLeft" className="size-4" />
      {children}
    </Link>
  );
}
