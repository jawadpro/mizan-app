/**
 * Links that open the Mizan Shortcut. Pure, so the browser, the server and tests share them.
 *
 * Uses the x-callback-url form: current iOS opens `shortcuts://run-shortcut?…` unreliably from Safari and home-screen
 * apps, while `shortcuts://x-callback-url/run-shortcut?…` works on every iOS version that has Shortcuts.
 */
export function shortcutRunUrl(shortcutName: string, text: string, back?: { success?: string; error?: string }): string {
  let url = `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(text)}`;
  // Where Shortcuts goes when it's done, e.g. back to the queue widget's script to show the result.
  if (back?.success) url += `&x-success=${encodeURIComponent(back.success)}`;
  if (back?.error) url += `&x-error=${encodeURIComponent(back.error)}`;
  return url;
}

/** What the Shortcut receives to pair: a link to this Mizan with the one-time code. Never a device token. */
export const pairPayload = (server: string, code: string) => `${server}/api/devices/pair?code=${code}`;

/** The Scriptable script people add for the monthly payments widget. Its name is how links open it. */
export const WIDGET_SCRIPT_NAME = "Mizan Payments";
/** Where Mizan serves the script, to copy into Scriptable. */
export const WIDGET_SCRIPT_PATH = "/widgets/mizan-payments.js";

/** The queued messages widget: shows alerts the Shortcut saved while offline, and imports them in one tap. */
export const QUEUE_SCRIPT_NAME = "Mizan Queue";
export const QUEUE_SCRIPT_PATH = "/widgets/mizan-queue.js";
/** The name of the Scriptable file bookmark that points at the Shortcut's queue folder. */
export const QUEUE_BOOKMARK = "Mizan Queue";

/** Opens a Scriptable script on the iPhone, with query parameters it reads from args.queryParameters. */
export function scriptableRunUrl(scriptName: string, params: Record<string, string> = {}): string {
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `scriptable:///run/${encodeURIComponent(scriptName)}${qs ? `?${qs}` : ""}`;
}

/** The Home Screen widgets Mizan offers, by id: which Scriptable script each one is. */
export type WidgetId = "payments" | "queue";
export const WIDGET_SCRIPTS: Record<WidgetId, { name: string; path: string }> = {
  payments: { name: WIDGET_SCRIPT_NAME, path: WIDGET_SCRIPT_PATH },
  queue: { name: QUEUE_SCRIPT_NAME, path: QUEUE_SCRIPT_PATH },
};
