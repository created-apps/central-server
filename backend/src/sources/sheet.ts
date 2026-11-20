/**
 * The enrolment sheet: who is enrolled. Read-only.
 *
 * Columns are found by header name, not position, using the same aliases as
 * the booking platform's reader, so the two always agree on who is enrolled.
 */
import { JWT } from "google-auth-library";
import { config } from "../config.js";

export interface SheetRow {
  sheetRow: number;
  studentEmail: string;
  parentEmail: string;
  studentName: string;
  parentName: string;
  program: string;
  track: string;
  enrolledOn: string;
  status: string;
}

const ALIASES: Record<keyof Omit<SheetRow, "sheetRow">, string[]> = {
  studentEmail: ["studentemail", "studentemailaddress", "studentmail", "childemail", "email", "emailaddress", "studentsemail"],
  parentEmail: ["parentemail", "parentemailaddress", "parentmail", "guardianemail", "parentsemail"],
  studentName: ["studentname", "student", "childname", "nameofstudent", "studentsname", "fullname", "name"],
  parentName: ["parentname", "guardianname", "parentsname"],
  // Not "track": the sheet has separate "Program Type(s)" and "Program Track" columns.
  program: ["programtypes", "programtype", "program", "programme", "programenrolled", "programmeenrolled", "course", "plan"],
  track: ["programtrack", "track", "subjecttrack"],
  enrolledOn: ["enrollmentdate", "enrolmentdate", "enrolledon", "dateofenrollment", "dateofenrolment", "startdate", "date", "timestamp", "createdat"],
  status: ["status", "enrollmentstatus", "enrolmentstatus", "stage"],
};

const normalise = (v: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function sheetConfigured(): boolean {
  return Boolean(config.sheetId && config.sheetCredentialsBase64);
}

async function fetchValues(): Promise<string[][]> {
  const creds = JSON.parse(Buffer.from(config.sheetCredentialsBase64, "base64").toString("utf8"));
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const { token } = await jwt.getAccessToken();
  const range = encodeURIComponent(config.sheetTab);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { values?: string[][] };
  return body.values ?? [];
}

export function parseRows(values: string[][]): SheetRow[] {
  if (!values.length) return [];
  const [header, ...body] = values;
  const normalised = header.map(normalise);
  const column: Partial<Record<keyof typeof ALIASES, number>> = {};
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
    const hit = aliases.find((a) => normalised.includes(a));
    if (hit) column[field] = normalised.indexOf(hit);
  }
  if (column.studentEmail === undefined && column.parentEmail === undefined) {
    console.warn("Enrolment sheet has no email column; headers:", header.slice(0, 20));
    return [];
  }
  const rows: SheetRow[] = [];
  body.forEach((raw, i) => {
    const cell = (f: keyof typeof ALIASES) => {
      const pos = column[f];
      return pos === undefined ? "" : String(raw[pos] ?? "").trim();
    };
    const studentEmail = cell("studentEmail").toLowerCase();
    const parentEmail = cell("parentEmail").toLowerCase();
    if (!studentEmail && !parentEmail) return;
    rows.push({
      sheetRow: i + 2,
      studentEmail,
      parentEmail,
      studentName: cell("studentName"),
      parentName: cell("parentName"),
      program: cell("program"),
      track: cell("track"),
      enrolledOn: cell("enrolledOn"),
      status: cell("status"),
    });
  });
  return rows;
}

/**
 * Enrolled children, one per student email (the parent's when no student email
 * is given). The first row for a child wins, as in the booking platform.
 */
export async function loadEnrolledChildren(): Promise<SheetRow[]> {
  if (!sheetConfigured()) {
    console.warn("Enrolment sheet is not configured");
    return [];
  }
  const rows = parseRows(await fetchValues());
  const seen = new Map<string, SheetRow>();
  for (const row of rows) {
    const key = row.studentEmail || row.parentEmail;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}
