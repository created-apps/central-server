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
        <div className="rounded-xl border border-line bg-card p-6">
          <h1 className="text-lg font-semibold">CreatED Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your dashboard account.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        {!authConfigured() && (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
            DATABASE_URL is not set, so credentials cannot be checked and no one can sign in.
          </p>
        )}
        <p className="mt-3 text-center text-xs text-muted">Invite-only. Ask an admin for access.</p>
      </div>
    </div>
  );
}
