/**
 * Progress reports as PDFs, exported from Google Drive with the service
 * account. Read-only. A Doc outside the configured Shared Drive, or that is
 * not a Google Doc, is never exported, so a guessed doc id cannot be used to
 * pull an unrelated file the service account can read.
 */
import { JWT } from "google-auth-library";
import { config } from "../config.js";

const DOC_MIME = "application/vnd.google-apps.document";
const MAX_BYTES = 25 * 1024 * 1024;

export class DriveExportError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function driveConfigured(): boolean {
  return Boolean(config.googleSaClientEmail && config.googleSaPrivateKey && config.googleSharedDriveId);
}

/**
 * The key arrives with real or escaped newlines, possibly quoted, or (as in
 * the booking platform's .env) on one line with no newlines at all. OpenSSL
 * needs the PEM layout, so a one-line key is rebuilt: header, 64-char base64
 * lines, footer.
 */
function privateKey(): string {
  let key = config.googleSaPrivateKey.trim().replace(/^["']|["']$/g, "");
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  key = key.trim();
  if (key.includes("\n")) return key;
  const match = key.match(/-----BEGIN ([A-Z ]+)-----(.+)-----END \1-----/);
  if (!match) return key;
  const body = match[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${match[1]}-----\n${lines.join("\n")}\n-----END ${match[1]}-----\n`;
}

let client: JWT | null = null;
async function token(): Promise<string> {
  client ??= new JWT({
    email: config.googleSaClientEmail,
    key: privateKey(),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new DriveExportError("Could not get a Drive access token");
  return token;
}

export async function exportReportPdf(docId: string): Promise<{ name: string; pdf: Buffer }> {
  if (!driveConfigured()) throw new DriveExportError("Drive export is not configured", 503);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(docId)) throw new DriveExportError("Invalid document id", 400);
  const headers = { Authorization: `Bearer ${await token()}` };

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}?fields=id,name,mimeType,driveId&supportsAllDrives=true`,
    { headers, signal: AbortSignal.timeout(20_000) },
  );
  if (metaRes.status === 404) throw new DriveExportError("Report not found in Drive", 404);
  if (!metaRes.ok) throw new DriveExportError(`Drive returned ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name?: string; mimeType?: string; driveId?: string };
  if (meta.driveId !== config.googleSharedDriveId) throw new DriveExportError("Report is not in the shared drive", 403);
  if (meta.mimeType !== DOC_MIME) throw new DriveExportError("Report is not a Google Doc", 415);

  const pdfRes = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!pdfRes.ok) throw new DriveExportError(`Drive export returned ${pdfRes.status}`);
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  if (pdf.length > MAX_BYTES) throw new DriveExportError("Report is too large to export");
  return { name: meta.name ?? "progress-report", pdf };
}

/** A safe download filename from the Doc's title. */
export function pdfFilename(name: string): string {
  const stem = name.replace(/[^A-Za-z0-9 ._-]/g, "").replace(/\.{2,}/g, ".").replace(/^[. ]+/, "").trim();
  return `${(stem || "progress-report").slice(0, 80)}.pdf`;
}
