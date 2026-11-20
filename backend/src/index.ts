import cors from "cors";
import express from "express";
import cron from "node-cron";
import { config } from "./config.js";
import { db, dbConfigured } from "./db.js";
import { api } from "./routes.js";
import { runSync } from "./syncJob.js";

const app = express();
// Only the frontend's server calls this API, but CORS stays for direct use.
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", api);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(config.port, async () => {
  console.log(`Milestones API on :${config.port}`);
  if (!dbConfigured()) {
    console.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: API and sync will fail");
    return;
  }
  // A run still marked running belonged to a process that has exited.
  const { error: staleError } = await db
    .from("sync_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), message: "Interrupted: the server stopped during this sync" })
    .eq("status", "running");
  if (staleError) console.warn(`Could not close interrupted syncs: ${staleError.message}`);
  if (config.cronEnabled) {
    if (!cron.validate(config.cronSchedule)) {
      console.error(`Invalid SYNC_CRON ${config.cronSchedule}; cron disabled`);
    } else {
      cron.schedule(config.cronSchedule, () => {
        runSync("cron").catch((err) => console.error("Scheduled sync failed:", err));
      });
      console.log(`Sync scheduled: ${config.cronSchedule}`);
    }
  }
});
