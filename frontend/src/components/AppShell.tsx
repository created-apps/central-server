"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, type SyncStatus } from "@/lib/api";
import { fmtDate } from "@/lib/milestones";
import { useCases } from "@/lib/ops";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./ui";

// ---------------------------------------------------------------- Icons

const Icon = ({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  groups: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  mentors: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.1a3.5 3.5 0 0 1 0 6.8",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  menu: "M4 6h16M4 12h16M4 18h16",
};

const NAV = [
  { href: "/", label: "Dashboard", icon: ICONS.dashboard, match: (p: string) => p === "/" || p.startsWith("/students") },
  { href: "/groups", label: "Groups", icon: ICONS.groups, match: (p: string) => p.startsWith("/groups") },
  { href: "/mentors", label: "Mentors", icon: ICONS.mentors, match: (p: string) => p.startsWith("/mentors") },
];

/** The brand mark: a simple monogram, not a logo. */
function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="hero-card inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">C</span>
      <span className="text-lg font-semibold tracking-tight">CreatED</span>
    </Link>
  );
}

// ---------------------------------------------------------------- Sidebar

function NavItem({ href, label, icon, active, badge, onClick }: { href: string; label: string; icon: string; active: boolean; badge?: number; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors ${
        active ? "font-semibold text-fg" : "text-muted hover:bg-soft hover:text-fg"
      }`}
    >
      {active && <span className="absolute -left-5 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent" />}
      <span className={active ? "text-accent" : ""}>
        <Icon d={icon} />
      </span>
      {label}
      {badge ? <span className="ml-auto rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent">{badge}</span> : null}
    </Link>
  );
}

/** Live sync status, in the sidebar's feature card. */
function SyncCard() {
  const { data } = useSWR("sync-status", () => api<SyncStatus>("/sync"), { refreshInterval: 15000 });
  const run = data?.lastRun;
  return (
    <div className="hero-card relative overflow-hidden rounded-3xl p-4">
      <div className="pointer-events-none absolute -right-8 -bottom-10 h-32 w-32 rounded-full border-[14px] border-white/10" />
      <p className="text-xs font-medium uppercase tracking-wider text-white/70">Data sync</p>
      <p className="mt-1.5 text-base font-semibold leading-snug">
        {data?.running ? "Syncing now…" : run?.status === "failed" ? "Last sync failed" : "Synced hourly"}
      </p>
      <p className="mt-1 text-xs text-white/75">
        {data?.running
          ? `${run?.students ?? 0} children saved so far`
          : run?.finished_at
            ? `Last run ${fmtDate(run.finished_at, true)}`
            : "No sync yet"}
      </p>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  // Only a badge: if the automations backend is down, stay quiet rather than retrying.
  const { data: cases } = useCases({ shouldRetryOnError: false, revalidateOnFocus: false });
  const [signingOut, setSigningOut] = useState(false);
  // Groups waiting on their first action, as a nudge in the menu.
  const fresh = (cases ?? []).filter((c) => c.stage === "NEW" && !c.operations_stopped_at).length;

  const signOut = async () => {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col gap-8 rounded-3xl bg-card px-5 py-6">
      <Brand />
      <nav>
        <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted">Menu</p>
        <div className="space-y-1">
          {NAV.map((n) => (
            <NavItem key={n.href} {...n} active={n.match(pathname)} badge={n.href === "/groups" ? fresh : undefined} onClick={onNavigate} />
          ))}
        </div>
        <p className="mt-8 mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted">General</p>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-muted hover:bg-soft hover:text-fg disabled:opacity-50"
        >
          <Icon d={ICONS.logout} />
          {signingOut ? "Signing out…" : "Logout"}
        </button>
      </nav>
      <div className="mt-auto">
        <SyncCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Top bar

/** Searches children: hands the text to the dashboard as ?q=. */
function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [q, setQ] = useState(pathname === "/" ? (params.get("q") ?? "") : "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
      }}
      className="flex w-full max-w-md items-center gap-2.5 rounded-full bg-card px-4 py-2.5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]"
    >
      <Icon d={ICONS.search} className="h-[18px] w-[18px] text-muted" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search children, projects or emails"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <kbd className="hidden rounded-md bg-soft px-1.5 py-0.5 text-[11px] font-medium text-muted sm:inline">⌘ K</kbd>
    </form>
  );
}

function UserBlock() {
  const user = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3">
      <Avatar name={user.name} />
      <div className="hidden leading-tight sm:block">
        <p className="text-sm font-semibold">{user.name}</p>
        <p className="text-xs text-muted">
          {user.email} · <span className={user.role === "admin" ? "text-accent" : ""}>{user.role}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Shell

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (pathname === "/login" || !user) return <>{children}</>;

  return (
    <div className="min-h-screen p-3 sm:p-4">
      <div className="mx-auto flex max-w-[1400px] gap-4">
        {/* Sidebar: fixed on large screens, a drawer below that. */}
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 lg:block">
          <Sidebar />
        </aside>
        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMenuOpen(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <aside className="absolute inset-y-3 left-3 w-64" onClick={(e) => e.stopPropagation()}>
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </aside>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <header className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card lg:hidden"
            >
              <Icon d={ICONS.menu} />
            </button>
            <Suspense fallback={<div className="h-11 flex-1" />}>
              <SearchBox />
            </Suspense>
            <div className="ml-auto rounded-full bg-card py-1.5 pr-4 pl-1.5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
              <UserBlock />
            </div>
          </header>
          <main className="pb-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
