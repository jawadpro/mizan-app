// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: calendar-check;

// Mizan: monthly payments widget for Scriptable (https://scriptable.app).
//
// On the Home Screen it shows this month's payments: what's paid, what's due and what's late. Tap a payment and
// this script opens, so you can mark it paid and link the bank transaction that paid it (Mizan suggests the
// likely one by amount, payee and date).
//
// Setup: in Mizan, open Monthly payments › Home Screen widget. Name this script "Mizan Payments" in Scriptable.
// The script holds no address or key: connecting saves both in this iPhone's Keychain. The key can read your
// monthly payments and mark them; it can't send bank alerts or see anything else. Remove it any time in Mizan.

const KEY = "mizan.widget";
const CACHE = "mizan-payments.json";
const SCRIPT = Script.name();

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#101412")),
  text: Color.dynamic(new Color("#121614"), new Color("#eef2ef")),
  muted: Color.dynamic(new Color("#6b726e"), new Color("#9aa39e")),
  track: Color.dynamic(new Color("#e3e8e5"), new Color("#26302b")),
  paid: Color.dynamic(new Color("#1f8a5b"), new Color("#3fbf84")),
  late: Color.dynamic(new Color("#c0392b"), new Color("#ff6b5e")),
  soon: Color.dynamic(new Color("#b7791f"), new Color("#f2b84b")),
  open: Color.dynamic(new Color("#8a938e"), new Color("#7d8781")),
};
const TONE_SYMBOL = { paid: "checkmark.circle.fill", skipped: "minus.circle", late: "exclamationmark.circle.fill", soon: "clock.fill", open: "circle" };

// ---------- Keychain and requests ----------

function creds() {
  if (!Keychain.contains(KEY)) return null;
  try {
    const c = JSON.parse(Keychain.get(KEY));
    return c && c.server && c.token ? c : null;
  } catch (e) {
    return null;
  }
}

class MizanError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, opts = {}) {
  const c = creds();
  if (!c) throw new MizanError("This widget isn't connected to Mizan yet.", 401);
  const req = new Request(c.server + path);
  req.method = opts.method || "GET";
  req.timeoutInterval = 20;
  req.headers = { Authorization: `Bearer ${c.token}` };
  if (opts.body) {
    req.headers["Content-Type"] = "application/json";
    req.body = JSON.stringify(opts.body);
  }
  let data;
  try {
    data = await req.loadJSON();
  } catch (e) {
    throw new MizanError("Couldn't reach Mizan. Check the internet connection and try again.", 0);
  }
  const status = req.response ? req.response.statusCode : 0;
  if (!data || data.ok !== true) throw new MizanError((data && data.error) || `Mizan answered with an error (${status}).`, status);
  return data;
}

/** A pairing link from Mizan: https://<your Mizan>/api/devices/pair?code=XXXXXXXX */
function pairLinkFrom(address, code) {
  const a = (address || "").trim();
  if (/\/api\/devices\/pair\?code=/.test(a)) return a;
  const server = a.replace(/\/+$/, "").replace(/\/app.*$/, "");
  const c = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^https?:\/\/[^\s/]+$/.test(server) || c.length !== 8) return null;
  return `${server}/api/devices/pair?code=${c}`;
}

async function pair(link) {
  if (!/^https?:\/\/[^\s/]+\/api\/devices\/pair\?code=[A-Za-z0-9-]+$/.test(link)) {
    throw new MizanError("That isn't a Mizan pairing link. In Mizan, open Monthly payments › Home Screen widget.", 400);
  }
  const req = new Request(`${link}&name=${encodeURIComponent(("Widget on " + Device.name()).slice(0, 60))}`);
  req.timeoutInterval = 20;
  let data;
  try {
    data = await req.loadJSON();
  } catch (e) {
    throw new MizanError("Couldn't reach Mizan. Check the address and the internet connection.", 0);
  }
  if (!data || !data.ok || !data.token) throw new MizanError((data && data.error) || "Mizan didn't accept that code. Make a new one and try again.", 400);
  if (data.kind && data.kind !== "widget") throw new MizanError("That code is for the Mizan Shortcut. Use the code from Monthly payments › Home Screen widget.", 400);
  const server = data.server || link.replace(/\/api\/devices\/pair.*$/, "");
  Keychain.set(KEY, JSON.stringify({ server, token: data.token }));
  // Tells Mizan the key is saved, so Mizan shows the widget as connected.
  const ok = new Request(data.confirm || `${server}/api/devices/confirm`);
  ok.method = "POST";
  ok.headers = { Authorization: `Bearer ${data.token}` };
  try {
    await ok.loadJSON();
  } catch (e) {}
}

// ---------- Data, with a copy kept for when the iPhone is offline ----------

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.cacheDirectory(), CACHE);
}

async function load(month) {
  try {
    const d = await api(`/api/widgets/monthly${month ? `?month=${month}` : ""}`);
    if (!month || month === d.month) {
      d.fetchedAt = Date.now();
      try {
        FileManager.local().writeString(cachePath(), JSON.stringify(d));
      } catch (e) {}
    }
    return d;
  } catch (e) {
    if (e.status === 401 || e.status === 400 || month) throw e;
    const fm = FileManager.local();
    if (fm.fileExists(cachePath())) {
      const d = JSON.parse(fm.readString(cachePath()));
      d.stale = true;
      return d;
    }
    throw e;
  }
}

const runUrl = (params) => {
  const qs = Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
  return `scriptable:///run/${encodeURIComponent(SCRIPT)}${qs ? `?${qs}` : ""}`;
};

// ---------- Home Screen and Lock Screen widget ----------

function symbol(name, color, size) {
  const s = SFSymbol.named(name);
  s.applyFont(Font.systemFont(size));
  return { image: s.image, color };
}

function bar(width, height, fraction) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const r = height / 2;
  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, width, height), r, r);
  dc.addPath(track);
  dc.setFillColor(new Color("#8a938e", 0.25));
  dc.fillPath();
  if (fraction > 0) {
    const fill = new Path();
    fill.addRoundedRect(new Rect(0, 0, Math.max(height, width * Math.min(1, fraction)), height), r, r);
    dc.addPath(fill);
    dc.setFillColor(new Color("#1f8a5b"));
    dc.fillPath();
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

function header(w, d, compact) {
  const top = w.addStack();
  top.centerAlignContent();
  text(top, "Payments", Font.boldSystemFont(compact ? 13 : 14), C.text);
  text(top, ` · ${d.monthShort}`, Font.mediumSystemFont(compact ? 13 : 14), C.muted);
  top.addSpacer();
  const all = d.summary.due > 0 && d.summary.paid >= d.summary.due;
  text(top, all ? "All paid" : `${d.summary.paid}/${d.summary.due} paid`, Font.semiboldSystemFont(12), all ? C.paid : C.text);
  w.addSpacer(5);
  const img = w.addImage(bar(300, 5, d.summary.due ? d.summary.paid / d.summary.due : 1));
  img.imageSize = new Size(compact ? 130 : 300, 5);
  img.resizable = true;
  w.addSpacer(5);
  const sub = [];
  if (d.summary.open > 0) sub.push(`${d.summary.left} left${d.summary.unknownLeft ? ` + ${d.summary.unknownLeft} bill${d.summary.unknownLeft === 1 ? "" : "s"}` : ""}`);
  if (d.summary.late > 0) sub.push(`${d.summary.late} late`);
  if (d.stale) sub.push("offline");
  if (sub.length) text(w, sub.join(" · "), Font.systemFont(11), d.summary.late ? C.late : C.muted);
}

function row(w, item, compact) {
  const r = w.addStack();
  r.centerAlignContent();
  r.url = runUrl({ item: item.id, month: item.month });
  const sym = symbol(TONE_SYMBOL[item.tone] || "circle", C[item.tone] || C.open, 12);
  const icon = r.addImage(sym.image);
  icon.imageSize = new Size(13, 13);
  icon.tintColor = sym.color;
  r.addSpacer(6);
  const name = text(r, item.name, Font.mediumSystemFont(12.5), item.state === "paid" || item.state === "skipped" ? C.muted : C.text);
  name.minimumScaleFactor = 0.85;
  r.addSpacer();
  if (!compact && item.state !== "paid") {
    text(r, item.status, Font.systemFont(10.5), item.tone === "late" ? C.late : item.tone === "soon" ? C.soon : C.muted);
    r.addSpacer(6);
  }
  const amt = item.left || item.amount;
  if (amt) text(r, amt, Font.semiboldSystemFont(12), item.state === "paid" ? C.muted : C.text);
}

function buildWidget(d, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = runUrl({});
  w.refreshAfterDate = new Date(Date.now() + 30 * 60e3);
  const items = d.items.map((i) => ({ ...i, month: d.month }));
  const open = items.filter((i) => i.state === "open" || i.state === "partial");

  if (family === "accessoryInline") {
    text(w, d.summary.open ? `${d.summary.paid}/${d.summary.due} paid · ${d.summary.left} left` : "All payments done", Font.systemFont(12), C.text);
    return w;
  }
  if (family === "accessoryCircular") {
    w.addSpacer();
    const t = text(w, `${d.summary.paid}/${d.summary.due}`, Font.boldSystemFont(16), C.text);
    t.centerAlignText();
    const s = text(w, "paid", Font.systemFont(10), C.text);
    s.centerAlignText();
    w.addSpacer();
    return w;
  }
  if (family === "accessoryRectangular") {
    text(w, `Payments ${d.summary.paid}/${d.summary.due}`, Font.boldSystemFont(13), C.text);
    if (open[0]) text(w, `${open[0].name} · ${open[0].status}`, Font.systemFont(12), C.text);
    else text(w, "All paid this month", Font.systemFont(12), C.text);
    if (open.length) text(w, `${d.summary.left} left`, Font.systemFont(12), C.text);
    return w;
  }

  w.setPadding(14, 14, 12, 14);
  if (family === "small") {
    header(w, d, true);
    w.addSpacer(8);
    if (!open.length) {
      text(w, items.length ? "Everything is paid." : "No monthly payments yet.", Font.mediumSystemFont(12), C.muted, 2);
    } else {
      open.slice(0, 3).forEach((i) => {
        const r = w.addStack();
        r.centerAlignContent();
        const sym = symbol(TONE_SYMBOL[i.tone] || "circle", C[i.tone] || C.open, 10);
        const icon = r.addImage(sym.image);
        icon.imageSize = new Size(11, 11);
        icon.tintColor = sym.color;
        r.addSpacer(4);
        text(r, i.name, Font.mediumSystemFont(11.5), C.text);
        w.addSpacer(3);
      });
    }
    w.addSpacer();
    return w;
  }

  header(w, d, false);
  w.addSpacer(8);
  if (!items.length) {
    text(w, "No monthly payments yet. Add them in Mizan › Monthly payments.", Font.systemFont(12), C.muted, 2);
    w.addSpacer();
    return w;
  }
  const max = family === "large" || family === "extraLarge" ? 11 : 4;
  // Unpaid first; paid ones fill the space left.
  const shown = items.slice(0, max);
  shown.forEach((i, n) => {
    row(w, i, false);
    if (n < shown.length - 1) w.addSpacer(family === "large" || family === "extraLarge" ? 6 : 4);
  });
  if (items.length > max) {
    w.addSpacer(4);
    text(w, `+ ${items.length - max} more`, Font.systemFont(10.5), C.muted);
  }
  w.addSpacer();
  return w;
}

function messageWidget(title, body) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = runUrl({});
  w.setPadding(14, 14, 14, 14);
  text(w, title, Font.boldSystemFont(14), C.text, 2);
  w.addSpacer(4);
  text(w, body, Font.systemFont(12), C.muted, 4);
  w.refreshAfterDate = new Date(Date.now() + 30 * 60e3);
  return w;
}

// ---------- In Scriptable: the checklist, marking paid and linking ----------

async function say(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message || "";
  a.addAction("OK");
  await a.presentAlert();
}

async function mark(d, item, action, transactionId) {
  const body = { month: d.month, action };
  if (transactionId) body.transactionId = transactionId;
  await api(`/api/widgets/monthly/${item.id}`, { method: "POST", body });
}

/** Lists that month's spending, best guesses first, with a search. Resolves to the chosen transaction or null. */
async function pickTransaction(d, item) {
  let chosen = null;
  let search = "";
  const t = new UITable();
  t.showSeparators = true;
  async function fill() {
    const res = await api(`/api/widgets/monthly/${item.id}?month=${d.month}${search ? `&q=${encodeURIComponent(search)}` : ""}`);
    t.removeAllRows();
    const head = new UITableRow();
    head.isHeader = true;
    head.addText(`Which transaction paid ${item.name}?`, search ? `Search: ${search}` : `${d.monthText} spending, best match first`);
    head.height = 60;
    t.addRow(head);
    const s = new UITableRow();
    s.addText("🔍  Search by name or amount…").titleColor = C.paid;
    s.dismissOnSelect = false;
    s.onSelect = async () => {
      const a = new Alert();
      a.title = "Search";
      a.addTextField("e.g. K-Electric or 25000", search);
      a.addAction("Search");
      a.addCancelAction("Cancel");
      if ((await a.presentAlert()) === -1) return;
      search = a.textFieldValue(0).trim();
      await fill().catch((e) => say("Couldn't search", e.message));
      t.reload();
    };
    t.addRow(s);
    if (!res.items.length) {
      const none = new UITableRow();
      none.addText(search ? "Nothing matches." : `No unlinked spending in ${d.monthText} yet.`).titleColor = C.muted;
      t.addRow(none);
    }
    res.items.forEach((x, n) => {
      const r = new UITableRow();
      r.height = 56;
      const left = r.addText(x.title, `${x.dateText}${n === 0 && !search && x.score >= 50 ? " · best match" : ""}`);
      left.widthWeight = 65;
      left.subtitleColor = C.muted;
      const right = r.addText(x.amount);
      right.rightAligned();
      right.widthWeight = 35;
      r.dismissOnSelect = true;
      r.onSelect = () => {
        chosen = x;
      };
      t.addRow(r);
    });
  }
  await fill();
  await t.present(false);
  return chosen;
}

/** What can be done with one payment. Resolves to true when it changed something. */
async function itemSheet(d, item) {
  const a = new Alert();
  a.title = item.name;
  const lines = [[item.amount, item.status].filter(Boolean).join(" · ")];
  if (item.linked.length) lines.push("Linked: " + item.linked.map((t) => t.text).join("\n"));
  a.message = lines.join("\n");
  const acts = [];
  const add = (label, fn, destructive) => {
    if (destructive) a.addDestructiveAction(label);
    else a.addAction(label);
    acts.push(fn);
  };
  const unpaid = item.state === "open" || item.state === "partial";
  if (unpaid && item.suggestion) {
    add(`Paid: link ${item.suggestion.text}`, () => mark(d, item, "paid", item.suggestion.id));
  }
  if (unpaid) {
    add(item.suggestion ? "Paid: choose another transaction…" : "Paid: choose the transaction…", async () => {
      const t = await pickTransaction(d, item);
      if (!t) return false;
      await mark(d, item, "paid", t.id);
    });
    add("Paid, nothing to link (cash, other account)", () => mark(d, item, "paid"));
    if (item.state === "open") add("Skip this month", () => mark(d, item, "skipped"));
  }
  if (!unpaid) add("Mark as not paid", () => mark(d, item, "undo"), true);
  add("Open in Mizan", async () => {
    Safari.open(d.appUrl);
    return false;
  });
  a.addCancelAction("Cancel");
  const i = await a.presentSheet();
  if (i < 0 || i >= acts.length) return false;
  try {
    return (await acts[i]()) !== false;
  } catch (e) {
    await say("That didn't work", e.message);
    return false;
  }
}

async function checklist(firstItemId, firstMonth) {
  let month = firstMonth || null;
  let d = await load(month);
  const t = new UITable();
  t.showSeparators = true;

  function render() {
    t.removeAllRows();
    const head = new UITableRow();
    head.isHeader = true;
    head.height = 70;
    const s = d.summary;
    const sub = s.due === 0 ? "Nothing on the list this month"
      : s.paid >= s.due ? "Everything is paid 🎉"
      : `${s.paid} of ${s.due} paid · ${s.left} still to pay${s.late ? ` · ${s.late} late` : ""}${d.stale ? " · offline" : ""}`;
    const title = head.addText(d.monthText, sub);
    title.widthWeight = 70;
    title.subtitleColor = s.late ? C.late : C.muted;
    const prev = UITableCell.button("‹");
    prev.widthWeight = 15;
    prev.onTap = () => go(-1);
    head.addCell(prev);
    const next = UITableCell.button("›");
    next.widthWeight = 15;
    next.onTap = () => go(1);
    head.addCell(next);
    t.addRow(head);

    let doneShown = false;
    d.items.forEach((item) => {
      const settled = item.state === "paid" || item.state === "skipped";
      if (settled && !doneShown) {
        doneShown = true;
        const h = new UITableRow();
        h.isHeader = true;
        h.addText("Done this month").titleColor = C.muted;
        t.addRow(h);
      }
      const r = new UITableRow();
      r.height = 60;
      const sym = symbol(TONE_SYMBOL[item.tone] || "circle", C[item.tone] || C.open, 18);
      const icon = r.addImage(sym.image);
      icon.widthWeight = 10;
      const sugg = item.suggestion && !settled ? ` · tap to link ${item.suggestion.amount} on ${item.suggestion.dateText}` : "";
      const label = r.addText(item.name, item.status + sugg);
      label.widthWeight = 60;
      label.titleColor = settled ? C.muted : C.text;
      label.subtitleColor = item.tone === "late" ? C.late : item.tone === "soon" ? C.soon : C.muted;
      const amt = r.addText(item.left || item.amount || "");
      amt.rightAligned();
      amt.widthWeight = 30;
      r.dismissOnSelect = false;
      r.onSelect = async () => {
        if (await itemSheet(d, item)) await refresh();
      };
      t.addRow(r);
    });
    if (!d.items.length) {
      const r = new UITableRow();
      r.addText("No monthly payments yet", "Add rent, bills and fees in Mizan › Monthly payments").subtitleColor = C.muted;
      t.addRow(r);
    }
    const open = new UITableRow();
    open.addText("Open Mizan").titleColor = C.paid;
    open.dismissOnSelect = false;
    open.onSelect = () => Safari.open(d.appUrl);
    t.addRow(open);
    t.reload();
  }
  async function refresh() {
    try {
      d = await load(month);
    } catch (e) {
      await say("Couldn't load", e.message);
    }
    render();
  }
  async function go(step) {
    const [y, m] = d.month.split("-").map(Number);
    const n = y * 12 + (m - 1) + step;
    const target = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
    if (target > d.today.slice(0, 7)) return;
    try {
      d = await load(target);
      month = d.month;
    } catch (e) {
      await say("Couldn't load", e.message);
    }
    render();
  }

  render();
  if (firstItemId) {
    const item = d.items.find((i) => i.id === firstItemId);
    if (item && (await itemSheet(d, item))) await refresh();
  }
  await t.present(false);
}

async function connectByHand() {
  const a = new Alert();
  a.title = "Connect to Mizan";
  a.message = "In Mizan, open Monthly payments › Home Screen widget. Type the address and the code shown there, or paste the whole pairing link in the first box.";
  a.addTextField("https://your-mizan.example.com", "");
  a.addTextField("Code, e.g. ABCD-2345", "");
  a.addAction("Connect");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return false;
  const link = pairLinkFrom(a.textFieldValue(0), a.textFieldValue(1));
  if (!link) {
    await say("Check the address and code", "The address starts with https:// and the code has 8 letters and numbers.");
    return false;
  }
  await pair(link);
  return true;
}

// ---------- Start ----------

async function main() {
  const q = args.queryParameters || {};
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    let w;
    if (!creds()) w = messageWidget("Mizan payments", "Tap to connect this widget to Mizan.");
    else {
      try {
        w = buildWidget(await load(), config.widgetFamily);
      } catch (e) {
        w = messageWidget("Mizan payments", e.message);
      }
    }
    Script.setWidget(w);
    return;
  }

  if (q.pair) {
    try {
      await pair(q.pair);
      await say("Connected", "This widget is connected to Mizan. Now add a Scriptable widget to your Home Screen and pick this script.");
    } catch (e) {
      await say("Couldn't connect", e.message);
      return;
    }
  }

  if (!creds()) {
    try {
      if (!(await connectByHand())) return;
      await say("Connected", "This widget is connected to Mizan. Now add a Scriptable widget to your Home Screen and pick this script.");
    } catch (e) {
      await say("Couldn't connect", e.message);
      return;
    }
  }

  try {
    await checklist(q.item, q.month);
  } catch (e) {
    if (e.status === 401) {
      const a = new Alert();
      a.title = "Not connected";
      a.message = e.message;
      a.addAction("Connect again");
      a.addCancelAction("Cancel");
      if ((await a.presentAlert()) === 0) {
        Keychain.remove(KEY);
        try {
          if (await connectByHand()) await checklist();
        } catch (err) {
          await say("Couldn't connect", err.message);
        }
      }
      return;
    }
    await say("Couldn't load your payments", e.message);
  }
}

await main();
Script.complete();
