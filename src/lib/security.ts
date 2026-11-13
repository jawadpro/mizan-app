import "server-only";
import { q } from "./db";
import { missingTable } from "./auth";
import { deviceLabel } from "./device";

// Signed-in devices: every sign-in is a row in app.sessions, listed in Settings and signed out from there.

export type DeviceRow = {
  /** A short hash of the session id, so the real one never leaves the server. */
  id: string;
  label: string;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  remembered: boolean;
  current: boolean;
};

const PUBLIC_ID = `left(encode(sha256(convert_to(s.sid, 'UTF8')), 'hex'), 20)`;

export async function listDevices(currentSid: string): Promise<DeviceRow[]> {
  if (Math.random() < 0.1) q(`DELETE FROM app.sessions WHERE expires_at < now() - interval '7 days'`).catch(() => {});
  const { rows } = await q<{ id: string; sid: string; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string; remembered: boolean }>(
    `SELECT ${PUBLIC_ID} AS id, s.sid, s.user_agent, s.ip, s.created_at, s.last_seen_at, s.remembered
     FROM app.sessions s
     WHERE s.revoked_at IS NULL AND s.expires_at > now()
     ORDER BY (s.sid = $1) DESC, s.last_seen_at DESC LIMIT 50`,
    [currentSid],
  );
  return rows.map((r) => ({
    id: r.id, label: deviceLabel(r.user_agent), ip: r.ip, created_at: r.created_at, last_seen_at: r.last_seen_at,
    remembered: r.remembered, current: r.sid === currentSid,
  }));
}

/** Signs out one device (by its public id). Never the current one. */
export async function signOutDevice(id: string, currentSid: string): Promise<boolean> {
  const { rowCount } = await q(
    `UPDATE app.sessions s SET revoked_at = now() WHERE ${PUBLIC_ID} = $1 AND s.sid <> $2 AND s.revoked_at IS NULL`,
    [id, currentSid],
  );
  return (rowCount ?? 0) > 0;
}

/** Signs out every device except the session given (none: all of them). */
export async function signOutOthers(keepSid: string | null) {
  try {
    await q(`UPDATE app.sessions SET revoked_at = now() WHERE revoked_at IS NULL AND sid IS DISTINCT FROM $1`, [keepSid]);
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

/** Signs out the session in a request (the Sign out button). */
export async function revokeSession(sid: string) {
  await q(`UPDATE app.sessions SET revoked_at = now() WHERE sid = $1 AND revoked_at IS NULL`, [sid]).catch(() => {});
}

/** Records that the passphrase was just entered on this session, for sensitive actions. */
export async function markConfirmed(sid: string) {
  await q(`UPDATE app.sessions SET confirmed_at = now() WHERE sid = $1`, [sid]);
}
