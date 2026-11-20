"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./AuthProvider";

const NAV = [
  { href: "/", label: "Children", match: (p: string) => p === "/" || p.startsWith("/students") },
  { href: "/groups", label: "Groups", match: (p: string) => p.startsWith("/groups") },
  { href: "/mentors", label: "Mentors", match: (p: string) => p.startsWith("/mentors") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (pathname === "/login" || !user) return <>{children}</>;

  const signOut = async () => {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-5">
            <Link href="/" className="text-sm font-semibold tracking-tight">CreatED Dashboard</Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-2.5 py-1 ${n.match(pathname) ? "bg-soft font-medium text-fg" : "text-muted hover:text-fg"}`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="hidden sm:inline">{user.name}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${user.role === "admin" ? "bg-accent/15 text-accent" : "bg-soft"}`}>
              {user.role}
            </span>
            <button onClick={signOut} disabled={signingOut} className="rounded-md border border-line px-2.5 py-1 hover:text-fg disabled:opacity-50">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
