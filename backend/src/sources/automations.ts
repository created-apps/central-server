/**
 * AUTOMATIONS reads: progress reports.
 *
 * progress_reports has no student email, so rows are tied to a child by,
 * strongest first: the child's WhatsApp group JID (from SYNC), the report's
 * case_id -> group_cases.student_email, then an exact normalised name that
 * identifies exactly one report group.
 */
import { automationsSource } from "./clients.js";

export interface ReportEntry {
  docId: string;
  docUrl: string;
  reportNo: number | null;
  date: string;
  sessionsCompleted: number | null;
  groupName: string;
}

const normaliseName = (v: unknown) =>
  String(v ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export class ProgressReportIndex {
  private byJid = new Map<string, any[]>();
  private byEmail = new Map<string, any[]>();
  private byName = new Map<string, any[]>();

  constructor(reports: any[], cases: Map<string, any>) {
    const push = (map: Map<string, any[]>, key: string, row: any) => map.set(key, [...(map.get(key) ?? []), row]);
    for (const report of reports) {
      const jid = String(report.group_jid ?? "").trim();
      if (jid) push(this.byJid, jid, report);
      const email = String(cases.get(report.case_id ?? "")?.student_email ?? "").trim().toLowerCase();
      if (email) {
        push(this.byEmail, email, report);
        continue;
      }
      const name = normaliseName(report.student_name);
      if (name) push(this.byName, name, report);
    }
  }

  static async load(): Promise<ProgressReportIndex> {
    const [reports, cases] = await Promise.all([
      automationsSource.select("progress_reports", {
        columns: "id,case_id,student_name,group_name,group_jid,reports,active",
        filters: { active: "eq.true" },
      }),
      automationsSource.select("group_cases", { columns: "id,student_email" }),
    ]);
    return new ProgressReportIndex(
      reports.filter((r) => Array.isArray(r.reports) && r.reports.length),
      new Map(cases.map((c) => [c.id, c])),
    );
  }

  forStudent(email: string, name: string, groupJids: string[]): ReportEntry[] {
    let rows = groupJids.flatMap((jid) => this.byJid.get(jid) ?? []);
    if (!rows.length) rows = this.byEmail.get(email.trim().toLowerCase()) ?? [];
    if (!rows.length) {
      const candidates = this.byName.get(normaliseName(name)) ?? [];
      const groups = new Set(candidates.map((c) => c.group_jid || c.id));
      if (groups.size === 1) rows = candidates;
    }
    const entries = new Map<string, ReportEntry>();
    for (const row of rows) {
      for (const e of row.reports ?? []) {
        if (!e?.doc_id) continue;
        entries.set(String(e.doc_id), {
          docId: String(e.doc_id),
          docUrl: e.doc_url || `https://docs.google.com/document/d/${e.doc_id}`,
          reportNo: Number.isFinite(Number(e.report_no)) ? Number(e.report_no) : null,
          date: String(e.date ?? ""),
          sessionsCompleted: Number.isFinite(Number(e.sessions_completed)) ? Number(e.sessions_completed) : null,
          groupName: row.group_name ?? "",
        });
      }
    }
    return [...entries.values()].sort(
      (a, b) => (a.reportNo ?? 0) - (b.reportNo ?? 0) || a.date.localeCompare(b.date),
    );
  }
}
