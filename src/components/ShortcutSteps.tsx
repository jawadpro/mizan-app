"use client";
import { useToast } from "./Toast";

/** Ready-made Shortcuts, shared from iCloud. Each user adds them and points them at their own Mizan. */
export const SHORTCUTS = {
  main: { name: "Expense Manager", url: "https://www.icloud.com/shortcuts/3600c130b51644a08061cfa967a1f0dd" },
  queue: { name: "Import Queued Messages", url: "https://www.icloud.com/shortcuts/cd9fee2b7f9c4774ac677dbc600a043e" },
};

function CopyUrl({ endpoint }: { endpoint: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(endpoint);
          toast("URL copied", "ok");
        } catch {
          toast("Couldn't copy; select it and copy by hand", "error");
        }
      }}
    >
      Copy URL
    </button>
  );
}

/** How to get bank alerts from iPhone Messages into Mizan with the two ready-made Shortcuts. */
export default function ShortcutSteps({ endpoint }: { endpoint: string }) {
  return (
    <div className="shortcut-guide">
      <div className="shortcut-cards">
        <a className="shortcut-card" href={SHORTCUTS.main.url} target="_blank" rel="noopener noreferrer">
          <strong>{SHORTCUTS.main.name}</strong>
          <span>Sends each bank alert to Mizan. With no internet, it saves the alert in a queue folder instead, so nothing is lost.</span>
          <span className="shortcut-add">Add Shortcut ↗</span>
        </a>
        <a className="shortcut-card" href={SHORTCUTS.queue.url} target="_blank" rel="noopener noreferrer">
          <strong>{SHORTCUTS.queue.name}</strong>
          <span>Run it yourself when you&apos;re back online. It sends the queued alerts to Mizan and clears the queue.</span>
          <span className="shortcut-add">Add Shortcut ↗</span>
        </a>
      </div>
      <ol className="shortcut-steps">
        <li>On your iPhone, tap <strong>Add Shortcut</strong> on both cards above.</li>
        <li>
          When asked (or by opening each Shortcut and editing it), enter your Mizan <strong>URL</strong> and <strong>SMS token</strong>:
          <div className="shortcut-url"><code>{endpoint}</code><CopyUrl endpoint={endpoint} /></div>
          <span className="small muted">The token is shown on this page; use Copy for Shortcut.</span>
        </li>
        <li>Open <strong>Settings</strong>, then <strong>Apps</strong>, then <strong>Shortcuts</strong> (on older iPhones, <strong>Settings</strong> then <strong>Shortcuts</strong>), then <strong>Advanced</strong>, and turn on <strong>Allow Deleting Without Confirmation</strong>. The Shortcuts clear the queue folder after sending.</li>
        <li>Run <strong>{SHORTCUTS.main.name}</strong> and <strong>{SHORTCUTS.queue.name}</strong> once each by hand. Whenever iPhone asks for permission, choose <strong>Always Allow</strong>, so they never stop to ask later.</li>
        <li>
          Make the automation: in Shortcuts, open the <strong>Automation</strong> tab, tap <strong>+</strong>, then <strong>Message</strong>. Set <strong>Sender</strong> to your bank (its name or short code, as it shows in Messages), choose <strong>Run Immediately</strong>, then <strong>Next</strong> and pick <strong>{SHORTCUTS.main.name}</strong>. Make one automation for each bank.
        </li>
        <li>Check it works: when your next bank alert arrives, it should show up in Mizan (or in Review) within a few seconds.</li>
      </ol>
    </div>
  );
}
