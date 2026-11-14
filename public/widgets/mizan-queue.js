// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: inbox;

// Mizan: queued messages widget for Scriptable (https://scriptable.app).
//
// When the Mizan Shortcut can't reach Mizan (no internet), it saves each bank alert as a file in its queue folder.
// This widget counts those files and adds up their amounts. Tap it and the Shortcut sends them all to Mizan; when
// it's done you see how many were imported, and the widget goes back to "All synced".
//
// Setup: in Mizan on the iPhone, open More › Widgets › Queued messages. Name this script "Mizan Queue" in Scriptable, and add a
// Scriptable file bookmark named "Mizan Queue" for the Shortcut's queue folder (Scriptable › Settings › File
// Bookmarks). The widget reads alerts only on this iPhone; they go to Mizan only when you import them.
// It shares its connection with the Mizan Payments widget, so if that one is set up, there's nothing to connect.

// Bumped with every change. The script checks your Mizan for a newer version and updates itself.
const VERSION = 3;
const KEY = "mizan.widget";
const UPDATE_KEY = "mizan.queue.checked";
const BOOKMARK = "Mizan Queue";
// Names the bookmark may have: people often name it after the folder.
const BOOKMARK_NAMES = [BOOKMARK, "queue-messages", "Queue Messages", "queue messages", "Mizan queue", "mizan queue"];
const SCRIPT = Script.name();

const AMBER = { top: new Color("#ffc65c"), bottom: new Color("#f08a1c"), ink: new Color("#3d2200"), soft: new Color("#5e3a08") };
const C = {
  bg: Color.dynamic(new Color("#f4f7f5"), new Color("#0f1513")),
  text: Color.dynamic(new Color("#121614"), new Color("#eef2ef")),
  muted: Color.dynamic(new Color("#6b726e"), new Color("#9aa39e")),
  green: Color.dynamic(new Color("#1f8a5b"), new Color("#3fbf84")),
};

// ---------- The queue on this iPhone ----------

const CURRENCY = /(PKR|Rs\.?|INR|USD|AED|SAR|GBP|EUR|\$|£|€)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

/** The amount printed in an alert, in hundredths, and how to show it. A guess for the widget only; Mizan reads it properly on import. */
function amountOf(text) {
  const m = CURRENCY.exec(text || "");
  if (!m) return null;
  const n = Math.round(parseFloat(m[2].replace(/,/g, "")) * 100);
  if (!isFinite(n) || n <= 0) return null;
  const cur = m[1].toUpperCase().replace(".", "");
  return { paisa: n, sign: cur === "PKR" || cur === "RS" ? "Rs" : cur === "INR" ? "₹" : cur.length === 1 ? cur : cur };
}

function money(paisa, sign) {
  const whole = String(Math.round(paisa / 100));
  const southAsian = sign === "Rs" || sign === "₹";
  let g;
  if (southAsian && whole.length > 3) g = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + whole.slice(-3);
  else g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign} ${g}`;
}

function shortSender(s) {
  const t = String(s || "Bank").replace(/^[A-Z]{2}-/, "").trim();
  return (t.length > 9 ? t.slice(0, 9) : t).toUpperCase() || "BANK";
}

/** The alerts waiting in the queue folder, newest first. null when the folder bookmark isn't set up. */
async function readQueue() {
  const fm = FileManager.local();
  const name = BOOKMARK_NAMES.find((n) => fm.bookmarkExists(n));
  if (!name) return null;
  const dir = fm.bookmarkedPath(name);
  let names = [];
  try {
    names = fm.listContents(dir);
  } catch (e) {
    return null;
  }
  const items = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const path = fm.joinPath(dir, name);
    if (fm.isDirectory(path)) continue;
    try {
      if (fm.isFileStoredIniCloud(path) && !fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
    } catch (e) {}
    let a = null;
    try {
      a = JSON.parse(fm.readString(path));
    } catch (e) {}
    const text = a && typeof a.text === "string" ? a.text : "";
    const at = a && a.receivedAt ? Date.parse(a.receivedAt) : fm.creationDate(path)?.getTime();
    items.push({ sender: shortSender(a && a.sender), amount: amountOf(text), at: isFinite(at) ? at : Date.now() });
  }
  items.sort((x, y) => y.at - x.at);
  const withAmount = items.filter((i) => i.amount);
  const sign = withAmount.length ? withAmount[0].amount.sign : "Rs";
  const total = withAmount.filter((i) => i.amount.sign === sign).reduce((s, i) => s + i.amount.paisa, 0);
  return { items, count: items.length, total, sign, totalText: total ? money(total, sign) : "" };
}

// ---------- Mizan ----------

function creds() {
  if (!Keychain.contains(KEY)) return null;
  try {
    const c = JSON.parse(Keychain.get(KEY));
    return c && c.server && c.token ? c : null;
  } catch (e) {
    return null;
  }
}

async function api(path, method) {
  const c = creds();
  if (!c) throw new Error("This widget isn't connected to Mizan yet. In Mizan on your iPhone, open More › Widgets › Queued messages.");
  const req = new Request(c.server + path);
  req.method = method || "GET";
  req.timeoutInterval = 20;
  req.headers = { Authorization: `Bearer ${c.token}` };
  if (method === "POST") {
    req.headers["Content-Type"] = "application/json";
    req.body = "{}";
  }
  let data;
  try {
    data = await req.loadJSON();
  } catch (e) {
    throw new Error("Couldn't reach Mizan. Check the internet connection and try again.");
  }
  if (!data || data.ok !== true) throw new Error((data && data.error) || "Mizan answered with an error.");
  return data;
}

async function pair(link) {
  if (!/^https?:\/\/[^\s/]+\/api\/devices\/pair\?code=[A-Za-z0-9-]+$/.test(link)) throw new Error("That isn't a Mizan pairing link.");
  const req = new Request(`${link}&name=${encodeURIComponent(("Widget on " + Device.name()).slice(0, 60))}`);
  req.timeoutInterval = 20;
  let data;
  try {
    data = await req.loadJSON();
  } catch (e) {
    throw new Error("Couldn't reach Mizan. Check the internet connection.");
  }
  if (!data || !data.ok || !data.token) throw new Error((data && data.error) || "Mizan didn't accept that code. Make a new one and try again.");
  if (data.kind && data.kind !== "widget") throw new Error("That code is for the Mizan Shortcut. Use the code from the widget setup in Mizan.");
  const server = data.server || link.replace(/\/api\/devices\/pair.*$/, "");
  Keychain.set(KEY, JSON.stringify({ server, token: data.token }));
  const ok = new Request(data.confirm || `${server}/api/devices/confirm`);
  ok.method = "POST";
  ok.headers = { Authorization: `Bearer ${data.token}` };
  try {
    await ok.loadJSON();
  } catch (e) {}
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const runUrl = (params) => {
  const qs = Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
  return `scriptable:///run/${encodeURIComponent(SCRIPT)}${qs ? `?${qs}` : ""}`;
};

// ---------- Drawing ----------

/** A stack of message bubbles, the newest in front, each labelled with its bank and amount. */
function bubbleStack(items, width, height) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const shown = items.slice(0, 3);
  const bw = width - 26;
  const bh = 40;
  // Back to front: each one further back sits higher and further right, and is fainter.
  for (let i = shown.length - 1; i >= 0; i--) {
    const it = shown[i];
    const x = i * 11;
    const y = height - bh - 8 - i * 17;
    const alpha = [0.96, 0.7, 0.48][i];
    const body = new Path();
    body.addRoundedRect(new Rect(x, y, bw, bh), 14, 14);
    dc.addPath(body);
    dc.setFillColor(new Color("#ffffff", alpha));
    dc.fillPath();
    if (i === 0) {
      // A little tail on the front bubble.
      const tail = new Path();
      tail.move(new Point(x + 10, y + bh - 6));
      tail.addLine(new Point(x + 2, y + bh + 6));
      tail.addLine(new Point(x + 22, y + bh - 2));
      tail.closeSubpath();
      dc.addPath(tail);
      dc.setFillColor(new Color("#ffffff", alpha));
      dc.fillPath();
    }
    dc.setTextColor(new Color("#3d2200", i === 0 ? 1 : 0.75));
    dc.setFont(Font.boldSystemFont(12));
    dc.drawTextInRect(it.sender, new Rect(x + 12, y + 5, bw - 20, 16));
    dc.setFont(Font.mediumSystemFont(11));
    dc.setTextColor(new Color("#5e3a08", i === 0 ? 1 : 0.7));
    dc.drawTextInRect(it.amount ? money(it.amount.paisa, it.amount.sign) : "Bank alert", new Rect(x + 12, y + 21, bw - 20, 15));
  }
  return dc.getImage();
}

function text(stack, s, font, color, lines = 1) {
  const t = stack.addText(s);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  return t;
}

function amber(w) {
  const g = new LinearGradient();
  g.colors = [AMBER.top, AMBER.bottom];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
}

// ---------- Widgets ----------

function syncedWidget(family, info) {
  const w = new ListWidget();
  w.url = runUrl({});
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  const last = info && info.lastImport && info.lastImport.finishedAt
    ? `Last import ${ago(Date.parse(info.lastImport.finishedAt))}`
    : info && info.lastAlertAt ? `Last alert ${ago(Date.parse(info.lastAlertAt))}` : "Nothing waiting";
  if (family === "accessoryCircular") {
    w.addSpacer();
    const s = SFSymbol.named("checkmark.circle");
    s.applyFont(Font.systemFont(26));
    const img = w.addImage(s.image);
    img.imageSize = new Size(26, 26);
    img.centerAlignImage();
    w.addSpacer();
    return w;
  }
  if (family === "accessoryInline") {
    text(w, "Mizan: all synced", Font.systemFont(12), C.text);
    return w;
  }
  if (family === "accessoryRectangular") {
    text(w, "All synced ✓", Font.boldSystemFont(14), C.text);
    text(w, last, Font.systemFont(12), C.text);
    return w;
  }
  w.backgroundColor = C.bg;
  w.setPadding(16, 16, 14, 16);
  const s = SFSymbol.named("checkmark.circle.fill");
  s.applyFont(Font.systemFont(26));
  const img = w.addImage(s.image);
  img.imageSize = new Size(26, 26);
  img.tintColor = C.green;
  w.addSpacer();
  text(w, "All synced", Font.boldSystemFont(family === "small" ? 18 : 20), C.text);
  w.addSpacer(2);
  text(w, last, Font.systemFont(12.5), C.muted);
  if (family !== "small") {
    w.addSpacer(2);
    text(w, "Alerts saved offline show up here.", Font.systemFont(12), C.muted);
  }
  return w;
}

function queueWidget(family, q) {
  const w = new ListWidget();
  w.url = runUrl({ import: "1" });
  w.refreshAfterDate = new Date(Date.now() + 10 * 60e3);
  const label = `${q.count} alert${q.count === 1 ? "" : "s"} waiting`;
  if (family === "accessoryCircular") {
    w.addSpacer();
    const t = text(w, String(q.count), Font.boldSystemFont(q.count > 99 ? 16 : 22), C.text);
    t.centerAlignText();
    const s = text(w, "queued", Font.systemFont(9), C.text);
    s.centerAlignText();
    w.addSpacer();
    return w;
  }
  if (family === "accessoryInline") {
    text(w, `${label}${q.totalText ? ` · ${q.totalText}` : ""}`, Font.systemFont(12), C.text);
    return w;
  }
  if (family === "accessoryRectangular") {
    text(w, label, Font.boldSystemFont(14), C.text);
    if (q.totalText) text(w, q.totalText, Font.systemFont(12), C.text);
    text(w, "Tap to import", Font.systemFont(12), C.text);
    return w;
  }

  amber(w);
  w.setPadding(16, 16, 14, 16);
  if (family === "small") {
    const top = w.addStack();
    top.centerAlignContent();
    text(top, String(q.count), Font.heavyRoundedSystemFont(44), AMBER.ink);
    top.addSpacer();
    const img = top.addImage(bubbleStack(q.items, 70, 60));
    img.imageSize = new Size(58, 50);
    text(w, q.count === 1 ? "alert waiting" : "alerts waiting", Font.semiboldSystemFont(14), AMBER.ink);
    if (q.totalText) text(w, q.totalText, Font.boldSystemFont(15), AMBER.soft);
    w.addSpacer();
    text(w, "Tap to import ›", Font.semiboldSystemFont(12), AMBER.soft);
    return w;
  }

  const row = w.addStack();
  const left = row.addStack();
  left.layoutVertically();
  text(left, String(q.count), Font.heavyRoundedSystemFont(52), AMBER.ink);
  text(left, q.count === 1 ? "alert waiting" : "alerts waiting", Font.semiboldSystemFont(15), AMBER.ink);
  if (q.totalText) text(left, q.totalText, Font.boldSystemFont(17), AMBER.soft);
  row.addSpacer();
  const img = row.addImage(bubbleStack(q.items, 150, 112));
  img.imageSize = new Size(150, 112);

  if (family === "large" || family === "extraLarge") {
    w.addSpacer(12);
    q.items.slice(0, 6).forEach((it) => {
      const r = w.addStack();
      r.centerAlignContent();
      r.size = new Size(0, 26);
      text(r, it.sender, Font.boldSystemFont(14), AMBER.ink);
      r.addSpacer(8);
      text(r, ago(it.at), Font.systemFont(12.5), AMBER.soft);
      r.addSpacer();
      text(r, it.amount ? money(it.amount.paisa, it.amount.sign) : "", Font.semiboldSystemFont(14), AMBER.ink);
    });
    if (q.count > 6) text(w, `+ ${q.count - 6} more`, Font.systemFont(12.5), AMBER.soft);
  }
  w.addSpacer();
  const foot = w.addStack();
  foot.centerAlignContent();
  const s = SFSymbol.named("arrow.down.circle.fill");
  s.applyFont(Font.systemFont(16));
  const icon = foot.addImage(s.image);
  icon.imageSize = new Size(16, 16);
  icon.tintColor = AMBER.ink;
  foot.addSpacer(6);
  text(foot, "Tap to import into Mizan", Font.semiboldSystemFont(13), AMBER.ink);
  return w;
}

function messageWidget(title, body) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = runUrl({});
  w.setPadding(14, 14, 14, 14);
  text(w, title, Font.boldSystemFont(15), C.text, 2);
  w.addSpacer(4);
  text(w, body, Font.systemFont(12), C.muted, 5);
  return w;
}

// ---------- In Scriptable ----------

async function say(title, message, buttons) {
  const a = new Alert();
  a.title = title;
  a.message = message || "";
  (buttons || ["OK"]).forEach((b) => a.addAction(b));
  return a.presentAlert();
}

const SETUP_HELP = `In Scriptable, open Settings (the gear) › File Bookmarks › +, pick Folder, then choose the folder the Mizan Shortcut saves offline alerts in (On My iPhone › Mizan › queue-messages, or wherever yours is). Name the bookmark "${BOOKMARK}" (or "queue-messages").`;

async function startImport(q) {
  const res = await api("/api/widgets/queue", "POST");
  // Runs the Mizan Shortcut in import mode; when it's done, Shortcuts opens this script again with ?done=<id>.
  Safari.open(res.runUrl);
}

async function showResult(id) {
  let summary = "The import finished.";
  try {
    const r = await api(`/api/widgets/queue?run=${encodeURIComponent(id)}`);
    summary = r.run.summary;
  } catch (e) {}
  const q = await readQueue();
  const left = q && q.count ? `\n\n${q.count} still waiting: they'll be sent next time.` : "\n\nAll synced ✓";
  await say("Imported", summary + left);
}

async function interactive(params) {
  if (params.failed) {
    await say("Import stopped", "The Shortcut stopped before it finished. Nothing was lost: the alerts stay in the queue until Mizan has them. Try again when you're online.");
    return;
  }
  if (params.done) return showResult(params.done);
  const q = await readQueue();
  if (!q) {
    await say("One more step", SETUP_HELP);
    return;
  }
  if (!creds()) {
    await say("Connect to Mizan", "In Mizan on your iPhone, open More › Widgets › Queued messages and tap Connect the widget. If the Mizan Payments widget is already connected on this iPhone, this one uses it: nothing to do.");
    return;
  }
  if (!q.count) {
    const i = await say("All synced ✓", "No alerts are waiting. Alerts the Shortcut saves while you're offline show up on the widget.", ["OK", "Open Mizan"]);
    if (i === 1) Safari.open(creds().server + "/app");
    return;
  }
  if (params.import) return startImport(q);
  const a = new Alert();
  a.title = `${q.count} alert${q.count === 1 ? "" : "s"} waiting`;
  a.message = q.items.slice(0, 5).map((i) => `${i.sender} · ${i.amount ? money(i.amount.paisa, i.amount.sign) : "alert"} · ${ago(i.at)}`).join("\n");
  a.addAction("Import now");
  a.addCancelAction("Cancel");
  if ((await a.presentSheet()) === 0) await startImport(q);
}

// ---------- Keeping the script up to date ----------

async function selfUpdate() {
  const c = creds();
  if (!c) return;
  const last = Keychain.contains(UPDATE_KEY) ? Number(Keychain.get(UPDATE_KEY)) : 0;
  if (Date.now() - last < 6 * 3600e3) return;
  Keychain.set(UPDATE_KEY, String(Date.now()));
  try {
    const req = new Request(`${c.server}/widgets/mizan-queue.js`);
    req.timeoutInterval = 15;
    const code = await req.loadString();
    const m = /\nconst VERSION = (\d+);/.exec(code || "");
    if (!req.response || req.response.statusCode !== 200 || !m || Number(m[1]) <= VERSION) return;
    if (!code.includes("// Mizan: queued messages widget for Scriptable")) return;
    for (const fm of [FileManager.iCloud(), FileManager.local()]) {
      try {
        fm.writeString(module.filename, code);
        return;
      } catch (e) {}
    }
  } catch (e) {}
}

// ---------- Start ----------

async function main() {
  const params = args.queryParameters || {};
  await selfUpdate();
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    const family = config.widgetFamily;
    const q = await readQueue();
    let w;
    if (!q) w = messageWidget("Mizan queue", `Tap to finish setup: add a Scriptable file bookmark named "${BOOKMARK}" for the queue folder.`);
    else if (q.count) w = queueWidget(family, q);
    else {
      let info = null;
      if (creds()) info = await api("/api/widgets/queue").catch(() => null);
      w = syncedWidget(family, info);
    }
    Script.setWidget(w);
    return;
  }
  if (params.pair) {
    try {
      await pair(params.pair);
      await say("Connected", "This widget is connected to Mizan.");
    } catch (e) {
      await say("Couldn't connect", e.message);
      return;
    }
  }
  try {
    await interactive(params);
  } catch (e) {
    await say("That didn't work", e.message);
  }
}

await main();
Script.complete();
