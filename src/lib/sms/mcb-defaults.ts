/**
 * MCB's message types, from real alerts (6222 "MCB Card", 8222 "MCB Transfers"), October 2026.
 * Migration 010 copies these into the Settings list once, where the owner can edit or remove them;
 * Settings can add any that are missing again. Keep both in step (tests/sms-templates.test.ts checks).
 */
import type { SmsTemplate } from "./templates";

export const MCB_DEFAULT_TEMPLATES: SmsTemplate[] = [
  {
    bank: "MCB", sender: "MCB*, 6222", kind: "expense", category: null, hold: false,
    example: "PKR 6,392.60 was charged at NANDOS - MAIN BLVD, LAHORE PAK via MCB Debit Card 4321 on 16-10-2026 at 19:49. Helpline: 042111000622",
    payee: "NANDOS - MAIN BLVD, LAHORE PAK",
  },
  {
    bank: "MCB", sender: "MCB*, 6222", kind: "expense", category: "Bank charges", hold: false,
    example: "PKR 250.00 plus tax has been deducted from your account as the monthly fee for SMS Alerts Service on branch transactions",
    payee: "",
  },
  {
    bank: "MCB", sender: "MCB*, 6222", kind: "income", category: null, hold: false,
    example: "PKR 1,000.00 received via IBFT from ALI RAZA KHAN A/C*9012 on 18-10-2026 19:59. Tx ID 000000123456",
    payee: "ALI RAZA KHAN",
  },
  {
    bank: "MCB", sender: "MCB*, 6222", kind: "income", category: null, hold: false,
    example: "PKR 500.00 received from Ali Raza Khan SadaPay in your MCB A/C*1234 via RAAST on 19-10-2026 16:35 Tx ID:112233445",
    payee: "Ali Raza Khan SadaPay",
  },
  {
    bank: "MCB", sender: "MCB*, 8222", kind: "expense", category: "Transfers", hold: true,
    example: "PKR20,000.00 sent to ALI RAZA KHAN A/C *5678 from A/C *1234 via IBFT on 17-10-2026 03:59 Tx ID PC1100000000000001",
    payee: "ALI RAZA KHAN",
  },
  {
    bank: "MCB", sender: "MCB*, 8222", kind: "expense", category: "Transfers", hold: true,
    example: "PKR12,000.00 sent to SARA AHMED UBL from A/C *1234 via RAAST on 17-10-2026 12:22 Tx ID PC1100000000000002",
    payee: "SARA AHMED UBL",
  },
];
