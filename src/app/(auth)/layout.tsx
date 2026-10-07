import Image from "next/image";
import { CHURCH } from "@/config/church";

const PILLARS = [
  { title: "Kept as the Church Manual requires", text: "Baptisms, professions of faith, transfers and removals recorded with the right approvals." },
  { title: "Every family and cell", text: "Members placed in their families, cells and zones — from Kanyanya and Mpererwe to Komamboga and Kiteezi." },
  { title: `Ready for ${CHURCH.conference}`, text: "The clerk’s quarterly membership report, prepared from the register in a few clicks." },
  { title: "Protected under DPPA 2019", text: "Two-step verification for staff, a full audit trail, and personal data handled under Uganda’s Data Protection and Privacy Act." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(420px,44%)_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-ink lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-40 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(127_196_206/0.22),transparent)]" />
          <div className="absolute -bottom-48 -right-24 size-[560px] rounded-full bg-[radial-gradient(closest-side,rgb(49_128_141/0.35),transparent)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]" />
          <Image src="/sda-mark.png" alt="" width={420} height={460} className="absolute -bottom-16 -right-10 w-[380px] opacity-[0.05]" />
        </div>

        <div className="relative flex items-center gap-3.5">
          <span className="grid size-12 place-items-center rounded-[12px] bg-white/[0.08] ring-1 ring-white/15">
            <Image src="/sda-mark.png" alt="" width={28} height={31} priority />
          </span>
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">Seventh-day Adventist Church</span>
            <span className="block text-[20px] font-semibold leading-tight">Kanyanya</span>
          </span>
        </div>

        <div className="relative max-w-[540px] py-10">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1 text-[12px] font-medium text-[#9fd6de] ring-1 ring-white/10">
            <span aria-hidden className="size-1.5 rounded-full bg-[#9fd6de]" />
            {CHURCH.office} · Membership register
          </p>
          <h2 className="mt-5 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] xl:text-[38px]">Caring for every member of the Kanyanya church family.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-sidebar-muted">
            The church register for {CHURCH.shortName} — kept by the clerk, used by the pastor, elders and cell leaders, and open to every member for their own record.
          </p>

          <figure className="mt-8 border-l-2 border-[#9fd6de]/50 pl-4">
            <blockquote className="text-[16px] italic leading-relaxed">“{CHURCH.scripture.text}”</blockquote>
            <figcaption className="mt-1 text-[13px] text-sidebar-muted">{CHURCH.scripture.ref}</figcaption>
          </figure>

          <ul className="mt-9 grid gap-x-6 gap-y-5 xl:grid-cols-2">
            {PILLARS.map((a) => (
              <li key={a.title} className="flex gap-3">
                <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#9fd6de]/15 text-[#9fd6de] ring-1 ring-[#9fd6de]/30">
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                </span>
                <span>
                  <span className="block text-[14px] font-semibold leading-snug">{a.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-sidebar-muted">{a.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative space-y-0.5 text-[12px] text-sidebar-muted">
          <p>© {year} {CHURCH.name}</p>
          <p>{CHURCH.place} · {CHURCH.conference}</p>
        </div>
      </aside>

      {/* Form column */}
      <div className="flex min-h-dvh flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-sidebar px-5 py-4 text-sidebar-ink lg:hidden">
          <Image src="/sda-mark.png" alt="" width={24} height={26} priority />
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">Seventh-day Adventist Church</span>
            <span className="block text-[16px] font-semibold leading-tight">Kanyanya · Membership register</span>
          </span>
        </div>
        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-5 pb-6 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
            Encrypted connection
          </span>
          <span>Need access? Speak to the church clerk after Sabbath service.</span>
        </footer>
      </div>
    </div>
  );
}
