import "server-only";
import { answer } from "./assistant";
import { HELP_TEXT } from "./assistant-commands";
import { runConfirmed, type Proposal } from "./assistant-tools";
import { setDisplayCurrency } from "./money";
import { rateLimit } from "./ratelimit";
import { getPrefs } from "./repo";
import { confirmReply, fitWhatsApp, linkCodeIn, type InboundMessage } from "./whatsapp";
import type { WhatsAppSettings } from "./whatsapp-config";
import {
  addTurns, clearTurns, firstDelivery, numberByPhone, recentTurns, redeemLinkCode, sendImage, sendText, setPending, showTyping, takePending, touchNumber,
  uploadImage,
} from "./whatsapp-repo";
import { invoiceRef, invoiceText, type InvoiceTx } from "./invoice-data";
import { invoicePngServer } from "./invoice-image";

// One incoming WhatsApp message, start to finish: who sent it, linking, YES/NO for a waiting change, then the answer.

const NOT_LINKED = "This number isn't linked to Mizan. To link it, open Mizan › Settings › WhatsApp, tap *Link a number* and send me the code shown there.";

export async function handleInbound(s: WhatsAppSettings, m: InboundMessage): Promise<void> {
  if (!(await firstDelivery(m.id))) return;
  const reply = (text: string) => sendText(s, m.from, fitWhatsApp(text));
  try {
    const linked = await numberByPhone(m.from);
    if (!linked) {
      const code = m.text ? linkCodeIn(m.text) : null;
      if (code) {
        // Codes are short, so guesses are limited per sender and overall.
        if (!(await rateLimit(`wa-link:${m.from}`, 5, 3600)) || !(await rateLimit("wa-link", 30, 3600))) return;
        const r = await redeemLinkCode(code, m.from, m.profileName);
        if (r.ok) await reply(`✅ Linked! This number now talks to your Mizan as *${r.number.name}*.\n\n${HELP_TEXT}`);
        else if (r.reason === "limit") await reply("This Mizan already has the most numbers it can link. Unlink one in Settings › WhatsApp first.");
        else await reply("That code didn't work. Codes last 15 minutes and work once. Make a new one in Mizan › Settings › WhatsApp.");
        return;
      }
      // Strangers get one short answer every few hours and nothing else.
      if (await rateLimit(`wa-unknown:${m.from}`, 1, 6 * 3600)) await reply(NOT_LINKED);
      return;
    }
    if (!(await rateLimit(`wa-msg:${linked.id}`, 60, 3600))) {
      if (await rateLimit(`wa-slow:${linked.id}`, 1, 3600)) await reply("That's a lot of messages in an hour. Give me a little while and try again.");
      return;
    }
    await touchNumber(linked.id);
    if (!m.text?.trim()) {
      await reply("I can only read text messages for now. Send *help* to see what I understand.");
      return;
    }
    const text = m.text.trim();
    await showTyping(s, m.id);
    const prefs = await getPrefs().catch(() => null);
    if (prefs) setDisplayCurrency(prefs.currency);

    if (/^(reset|clear|start over|new chat)$/i.test(text)) {
      await clearTurns(linked.id);
      await takePending(linked.id);
      await reply("Fresh start. What would you like to know?");
      return;
    }

    // A change waiting for YES: confirm it, cancel it, or drop it when the owner moves on to something else.
    const yn = confirmReply(text);
    const pending = await takePending(linked.id);
    if (pending && yn) {
      const out = yn === "yes" ? await runConfirmed(pending.action as Proposal) : "Okay, cancelled. Nothing was saved.";
      await reply(out);
      await addTurns(linked.id, [{ role: "user", body: text }, { role: "assistant", body: out }]);
      return;
    }
    if (!pending && yn) {
      const out = yn === "yes" ? "There's nothing waiting to be saved right now (changes wait 15 minutes)." : "Okay.";
      await reply(out);
      return;
    }

    const history = await recentTurns(linked.id);
    const a = await answer(s, history, text, pending?.summary ?? null);
    if (a.proposal) await setPending(linked.id, a.proposal.action, a.proposal.summary);
    await reply(a.reply);
    if (a.invoices?.length) await sendInvoices(s, m.from, a.invoices);
    const sent = a.invoices?.length ? `${a.reply}\n(Sent invoices: ${a.invoices.map((t) => `${invoiceRef(t.id)} [id ${t.id}]`).join(", ")})` : a.reply;
    await addTurns(linked.id, [{ role: "user", body: text }, { role: "assistant", body: sent }]);
  } catch (e) {
    console.error("[mizan] whatsapp message failed", (e as Error)?.name, (e as { code?: string })?.code ?? "");
    await reply("Sorry, something went wrong on my side. Please try again in a moment.").catch(() => {});
  }
}

/** Each invoice as a picture with a one-line caption. One that fails is sent as text instead, so nothing goes missing. */
async function sendInvoices(s: WhatsAppSettings, to: string, list: InvoiceTx[]) {
  for (const t of list) {
    try {
      const png = await invoicePngServer(t);
      const id = await uploadImage(s, png, `mizan-${invoiceRef(t.id)}.png`);
      await sendImage(s, to, id, invoiceText(t));
    } catch (e) {
      console.error("[mizan] invoice picture failed", (e as Error)?.name, (e as Error)?.message?.slice(0, 120));
      await sendText(s, to, `🧾 ${invoiceText(t)}\n_(Couldn't make the picture for this one.)_`).catch(() => {});
    }
  }
}
