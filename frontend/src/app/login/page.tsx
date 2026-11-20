import { Suspense } from "react";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/server/auth";
import { getCurrentUser } from "@/lib/server/current-user";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="hero-card inline-flex h-10 w-10 items-center justify-center rounded-full text-base font-bold">C</span>
          <span className="text-xl font-semibold tracking-tight">CreatED</span>
        </div>
        <div className="rounded-3xl bg-card p-7 shadow-[0_8px_30px_rgba(16,24,20,0.06)]">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your dashboard account.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        {!authConfigured() && (
          <p className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
            DATABASE_URL is not set, so credentials cannot be checked and no one can sign in.
          </p>
        )}
        <p className="mt-3 text-center text-xs text-muted">Invite-only. Ask an admin for access.</p>
      </div>
    </div>
  );
}
