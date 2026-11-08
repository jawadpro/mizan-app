/** How to forward bank alerts from iPhone Messages to Mizan with a Shortcuts automation. */
export default function ShortcutSteps({ endpoint }: { endpoint: string }) {
  return (
    <ol className="shortcut-steps">
      <li>Open <strong>Shortcuts</strong>, then the <strong>Automation</strong> tab, then <strong>+</strong> and <strong>Message</strong>.</li>
      <li>Set <strong>Sender</strong> to your bank&apos;s contact or sender ID (one automation per bank) and <strong>Message Contains</strong> to <code>PKR</code> (or <code>Rs</code>). Choose <strong>Run Immediately</strong>, then <strong>Next</strong> and <strong>New Blank Automation</strong>.</li>
      <li>Add <strong>Current Date</strong>, then <strong>Format Date</strong> with Date Format <strong>ISO 8601</strong> and Include Time on.</li>
      <li>Add <strong>Get Contents of URL</strong>: URL <code>{endpoint}</code>, Method <strong>POST</strong>.</li>
      <li>Headers: <code>Authorization</code> = <code>Bearer &lt;your SMS token&gt;</code>, <code>Content-Type</code> = <code>application/json</code>.</li>
      <li>Request Body <strong>JSON</strong>: <code>sender</code> = Shortcut Input → <em>Sender</em>; <code>text</code> = Shortcut Input → <em>Content</em>; <code>receivedAt</code> = <em>Formatted Date</em>.</li>
      <li>Optional: add <strong>Show Notification</strong> with the response so you see “imported”, “review” or “duplicate”.</li>
    </ol>
  );
}
