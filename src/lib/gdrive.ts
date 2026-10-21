import "server-only";
import { deleteSecret, getSecret, setSecret } from "./secretbox";

// Google Drive access for backups. Uses the drive.file scope, so Mizan can only see and change
// files it created itself, never the rest of the owner's Drive.

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_NAME = "google_refresh_token";
const FOLDER_NAME = "Mizan backups";
const API = "https://www.googleapis.com/drive/v3";

export class DriveError extends Error {}

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function client() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new DriveError("Google Drive isn't set up on the server yet");
  return { id, secret };
}

export function redirectUri(origin: string) {
  return `${origin}/api/backup/google/callback`;
}

export function authUrl(origin: string, state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", client().id);
  u.searchParams.set("redirect_uri", redirectUri(origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", state);
  return u.toString();
}

async function token(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client().id, client_secret: client().secret, ...params }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!res.ok || !data.access_token) throw new DriveError(data.error === "invalid_grant" ? "Google access was revoked; connect Google Drive again" : "Google sign-in failed");
  return data;
}

/** Completes the consent flow and stores the refresh token encrypted. */
export async function connect(origin: string, code: string) {
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
  if (!t.refresh_token) throw new DriveError("Google didn't grant offline access; try connecting again");
  if (!(t.scope ?? "").split(" ").includes(SCOPE)) throw new DriveError("Drive access wasn't granted");
  await setSecret(TOKEN_NAME, t.refresh_token);
}

export async function connected(): Promise<boolean> {
  return !!(await getSecret(TOKEN_NAME));
}

export async function disconnect() {
  const rt = await getSecret(TOKEN_NAME);
  if (rt) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: rt }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  await deleteSecret(TOKEN_NAME);
}

async function accessToken(): Promise<string> {
  const rt = await getSecret(TOKEN_NAME);
  if (!rt) throw new DriveError("Google Drive isn't connected");
  return (await token({ grant_type: "refresh_token", refresh_token: rt })).access_token!;
}

async function drive<T>(at: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith("https://") ? path : `${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${at}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new DriveError(`Google Drive returned ${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

type DriveFile = { id: string; name: string; createdTime?: string };

async function folderId(at: string): Promise<string> {
  const qs = new URLSearchParams({
    q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: "1",
  });
  const found = await drive<{ files: DriveFile[] }>(at, `/files?${qs}`);
  if (found.files[0]) return found.files[0].id;
  const made = await drive<DriveFile>(at, "/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  return made.id;
}

/** Uploads one backup file, replacing a same-day copy, and keeps only the newest `keep` backups. */
export async function uploadBackup(name: string, data: Buffer, keep: number) {
  const at = await accessToken();
  const parent = await folderId(at);
  const same = await drive<{ files: DriveFile[] }>(at, `/files?${new URLSearchParams({ q: `'${parent}' in parents and name = '${name}' and trashed = false`, fields: "files(id)" })}`);
  const boundary = `mizan${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], mimeType: "text/csv" })}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: text/csv\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await drive<DriveFile>(at, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  for (const old of same.files) await drive(at, `/files/${encodeURIComponent(old.id)}`, { method: "DELETE" }).catch(() => undefined);

  const qs = new URLSearchParams({
    q: `'${parent}' in parents and name contains 'mizan-backup-' and trashed = false`,
    fields: "files(id,name,createdTime)",
    orderBy: "createdTime desc",
    pageSize: "200",
  });
  const list = await drive<{ files: DriveFile[] }>(at, `/files?${qs}`);
  for (const old of list.files.slice(keep)) {
    await drive(at, `/files/${encodeURIComponent(old.id)}`, { method: "DELETE" }).catch(() => undefined);
  }
}

/** The newest backup in Drive, for the Backups page. Read from Drive itself, so nothing is logged locally. */
export async function latestBackup(): Promise<{ name: string; createdTime: string } | null> {
  const at = await accessToken();
  const parent = await folderId(at);
  const qs = new URLSearchParams({
    q: `'${parent}' in parents and name contains 'mizan-backup-' and trashed = false`,
    fields: "files(name,createdTime)",
    orderBy: "createdTime desc",
    pageSize: "1",
  });
  const list = await drive<{ files: { name: string; createdTime: string }[] }>(at, `/files?${qs}`);
  return list.files[0] ?? null;
}
