/**
 * Dashboard access: the session token the frontend signs at login (jose,
 * HS256, AUTH_SECRET), forwarded by its /api/tracker proxy as the bearer.
 * Accounts and roles live in the operations dashboard's dashboard_users.
 */
import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify } from "jose";
import { config } from "./config.js";

export interface AuthedRequest extends Request {
  userEmail?: string;
  userName?: string;
  userRole?: "admin" | "viewer";
}

const secret = () => new TextEncoder().encode(config.authSecret);

export async function requireStaff(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!config.authSecret) return res.status(503).json({ error: "AUTH_SECRET is not set on the tracker backend" });
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.email !== "string" || (payload.role !== "admin" && payload.role !== "viewer")) {
      return res.status(401).json({ error: "Session expired, sign in again" });
    }
    req.userEmail = payload.email.toLowerCase();
    req.userName = typeof payload.name === "string" ? payload.name : payload.email;
    req.userRole = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, sign in again" });
  }
}

/** Admin-only actions, such as starting a sync. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.userRole !== "admin") return res.status(403).json({ error: "Read-only access — ask an admin to do this" });
  next();
}

const digest = (v: string) => createHash("sha256").update(v).digest();

/**
 * Service-to-service access: the X-API-Key header must equal MILESTONE_API_KEY.
 * Without the header, falls back to the staff session. Used only on the
 * endpoints that opt in.
 */
export function requireApiKeyOrStaff(req: AuthedRequest, res: Response, next: NextFunction) {
  const given = req.header("x-api-key");
  if (given === undefined) return requireStaff(req, res, next);
  if (!config.milestoneApiKey) return res.status(503).json({ error: "MILESTONE_API_KEY is not set on the tracker backend" });
  if (!timingSafeEqual(digest(given), digest(config.milestoneApiKey))) return res.status(401).json({ error: "Invalid API key" });
  req.userEmail = "api-key";
  req.userName = "API key";
  req.userRole = "viewer";
  next();
}
