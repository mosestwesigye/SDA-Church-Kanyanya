import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid md:grid-cols-[minmax(320px,440px)_1fr]">
      <aside className="hidden md:flex flex-col justify-between bg-sidebar text-sidebar-ink p-10">
        <div className="flex items-center gap-3">
          <Image src="/sda-logo.png" alt="Seventh-day Adventist Church" width={42} height={44} priority />
          <div>
            <div className="text-[16px] font-semibold leading-tight">SDAK Church Manager</div>
            <div className="text-[12px] text-sidebar-muted">SDA Church Kanyanya · CUC</div>
          </div>
        </div>
        <p className="text-sidebar-muted text-sm max-w-xs">
          Membership records for the Seventh-day Adventist Church Kanyanya, Central Uganda Conference.
        </p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="md:hidden flex items-center gap-3 mb-8 bg-sidebar text-sidebar-ink rounded-[10px] p-4">
            <Image src="/sda-logo.png" alt="" width={34} height={36} priority />
            <div className="font-semibold">SDAK Church Manager</div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
