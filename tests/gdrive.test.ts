import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const store = new Map<string, string>([["google_refresh_token", "rt-123"]]);
vi.mock("@/lib/secretbox", () => ({
  getSecret: async (n: string) => store.get(n) ?? null,
  setSecret: async (n: string, v: string) => void store.set(n, v),
  deleteSecret: async (n: string) => void store.delete(n),
}));

import { uploadBackup } from "@/lib/gdrive";

type Call = { url: string; method: string; body?: string };

describe("Google Drive backup upload", () => {
  let calls: Call[];
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    calls = [];
    const backups = Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, name: `mizan-backup-${i}.csv` }));
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : init.body ? Buffer.from(init.body as Buffer).toString("utf8") : undefined;
      calls.push({ url, method, body });
      const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return ok({ access_token: "at" });
      if (url.includes("mimeType") && method === "GET") return ok({ files: [{ id: "folder1" }] });
      if (url.includes("name+%3D+%27mizan-backup-2026-10-20.csv") || url.includes("name+%3D+%27mizan-backup")) return ok({ files: [{ id: "today-old" }] });
      if (url.includes("upload/drive")) return ok({ id: "new" });
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("orderBy")) return ok({ files: backups });
      return ok({ files: [] });
    });
  });

  it("refreshes the token, uploads into the folder, replaces today's copy and prunes old ones", async () => {
    await uploadBackup("mizan-backup-2026-10-20.csv", Buffer.from("date_pkt,kind\r\n"), 30);
    expect(calls[0].body).toContain("grant_type=refresh_token");
    expect(calls[0].body).toContain("refresh_token=rt-123");
    const up = calls.find((c) => c.url.includes("upload/drive"))!;
    expect(up.body).toContain('"parents":["folder1"]');
    expect(up.body).toContain('"name":"mizan-backup-2026-10-20.csv"');
    expect(up.body).toContain("date_pkt,kind");
    const deleted = calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/files/")[1]);
    expect(deleted).toEqual(["today-old", "f30", "f31"]);
  });

  it("asks only for access to the files Mizan creates", async () => {
    const { authUrl } = await import("@/lib/gdrive");
    const u = new URL(authUrl("https://mizan.example", "st"));
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(u.searchParams.get("redirect_uri")).toBe("https://mizan.example/api/backup/google/callback");
    expect(u.searchParams.get("access_type")).toBe("offline");
  });
});
