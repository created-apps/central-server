"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/session";

const AuthContext = createContext<SessionUser | null>(null);

/** The session user, read from the httpOnly cookie in the root layout. */
export function AuthProvider({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Admins may send, edit, stop and refresh. The server enforces it either way. */
export const useIsAdmin = () => useContext(AuthContext)?.role === "admin";
