/**
 * Links that open the Mizan Shortcut. Pure, so the browser, the server and tests share them.
 *
 * Uses the x-callback-url form: current iOS opens `shortcuts://run-shortcut?…` unreliably from Safari and home-screen
 * apps, while `shortcuts://x-callback-url/run-shortcut?…` works on every iOS version that has Shortcuts.
 */
export function shortcutRunUrl(shortcutName: string, text: string): string {
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(text)}`;
}

/** What the Shortcut receives to pair: a link to this Mizan with the one-time code. Never a device token. */
export const pairPayload = (server: string, code: string) => `${server}/api/devices/pair?code=${code}`;

/** The Scriptable script people add for the monthly payments widget. Its name is how links open it. */
export const WIDGET_SCRIPT_NAME = "Mizan Payments";
/** Where Mizan serves the script, to copy into Scriptable. */
export const WIDGET_SCRIPT_PATH = "/widgets/mizan-payments.js";

/** Opens a Scriptable script on the iPhone, with query parameters it reads from args.queryParameters. */
export function scriptableRunUrl(scriptName: string, params: Record<string, string> = {}): string {
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `scriptable:///run/${encodeURIComponent(scriptName)}${qs ? `?${qs}` : ""}`;
}
