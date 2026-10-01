import { Wordmark } from "@/components/brand/wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between bg-sidebar p-10 lg:flex">
        <Wordmark />
        <div className="max-w-md">
          <p className="text-[26px] leading-snug font-semibold tracking-tight text-white">
            Campaign operations for approved prospect intelligence.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground">
            Import approved research, build audiences, run sequenced outreach and manage every reply
            — with suppression, compliance and workspace isolation built in.
          </p>
        </div>
        <p className="text-xs text-sidebar-muted">Authorized LeadVault personnel only.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark tone="light" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
