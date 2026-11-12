import { describe, expect, it } from "vitest";
import { accountDigits, findAccountMentions } from "@/lib/sms/accounts";
import { parseSms } from "@/lib/sms/parser";

const receivedAt = new Date("2026-11-10T12:00:00Z");
/** The digits Mizan would pick an account by, read the way the parser reads the alert. */
const own = (text: string) => {
  const r = parseSms({ sender: "BANK", text, receivedAt, knownSender: true });
  if (r.status === "ignored") throw new Error("ignored");
  return r.fields;
};

// [bank, alert, the owner's digits first, then any unsure ones]. MCB, JS Bank and Bank Alfalah are real alerts
// (numbers changed); the others follow the formats those banks are known to send, so each masking style is covered.
const CASES: [string, string, string[]][] = [
  // MCB
  ["MCB", "PKR 6,392.60 was charged at NANDOS - MAIN BLVD, LAHORE PAK via MCB Debit Card 4321 on 16-10-2026 at 19:49. Helpline: 042111000622", ["4321"]],
  ["MCB", "PKR 1,000.00 received via IBFT from ALI RAZA KHAN A/C*9012 on 18-10-2026 19:59. Tx ID 000000123456", []],
  ["MCB", "PKR 500.00 received from Ali Raza Khan SadaPay in your MCB A/C*1234 via RAAST on 19-10-2026 16:35 Tx ID:112233445", ["1234"]],
  ["MCB", "PKR20,000.00 sent to ALI RAZA KHAN A/C *5678 from A/C *1234 via IBFT on 17-10-2026 03:59 Tx ID PC1100000000000001", ["1234"]],
  ["MCB", "PKR12,000.00 sent to SARA AHMED UBL from A/C *1234 via RAAST on 17-10-2026 12:22 Tx ID PC1100000000000002", ["1234"]],
  ["MCB", "Remittance of PKR 250,000.00 received via IBFT in A/C*1234 on 05-10-2026 20:32. Tx ID 261005000001", ["1234"]],
  ["MCB", "Dear Customer, PKR 2,450.00 has been debited from your A/C ****1234 on 15-Oct-2026 at 14:22 for POS purchase at FOODPANDA KARACHI. Avl Bal PKR 85,301.17", ["1234"]],
  ["MCB", "PKR 250.00 plus tax has been deducted from your account as the monthly fee for SMS Alerts Service on branch transactions", []],
  // JS Bank
  ["JS Bank", "Your A/c XX4248 is debited by PKR 7,800.00 via Mobile IBFT to XX8373-MUHAMMAD JAWAD ILYAS on 31-08-2026 at 12:21 FT26243CK86C Helpline:111-654-321", ["4248"]],
  ["JS Bank", "Acct. 15XXXX8 credited by  PKR 33,378.01 due to Inward Remittance at 13:25 hrs on 10/09/2026. Helpline:111-654-321", ["8"]],
  // Bank Alfalah
  ["Alfalah", "Dear Customer,\r\nPKR 10,000.00 and Tax/Charges 5.00 Debited from your A/C: 8350-1***6011 on 7-Nov-26 at 21:44:25\r\nBal: Reply with AB\r\n021111225111", ["6011"]],
  ["Alfalah", "PKR 30,000.00 received from MUHAMMAD SAAD BAF in your BAF A/C **6011 on 6-Nov-26 21:34:24 via FT Tx ID FT263100NG3HR7L2", ["6011"]],
  ["Alfalah", "Dear Customer,\r\nPKR 1,501,777.07 Credited to your A/C: 8350-1***4436 on 5-Nov-26 at 17:53:56\r\nBal: Reply with AB\r\n021111225111", ["4436"]],
  ["Alfalah", "PKR 1,250.00 spent at FOODPANDA via Debit Card xx7788 on 9-Nov-26 20:05:11", ["7788"]],
  ["Alfalah", "PKR 5,000.00 sent from your A/C 8350-1***6011 to AHMED ALI HBL A/C ***9921 on 9-Nov-26 at 10:00:01 via Raast", ["6011"]],
  // HBL
  ["HBL", "Dear Customer, your HBL A/C 1234XXXXXX5678 has been debited with PKR 5,000.00 on 10-Nov-26 at 14:05 for IBFT to ALI KHAN. Ref# 123456789", ["5678"]],
  ["HBL", "HBL: PKR 2,350.00 spent on your HBL Debit Card ending 4321 at IMTIAZ SUPER MARKET on 10-Nov-2026 18:22.", ["4321"]],
  ["HBL", "PKR 25,000.00 credited to your HBL account no. ****5678 from AHMED RAZA on 11/11/2026 09:15.", ["5678"]],
  // UBL
  ["UBL", "UBL: Your A/c # XXXXXXX9876 debited by Rs. 3,200.00 on 09-11-2026 13:40 at KFC DHA. Avl Bal Rs.45,000.00", ["9876"]],
  ["UBL", "Rs.15,000.00 has been credited to your UBL Account ***9876 via Raast from SARA AHMED on 09-11-2026 at 10:12. TID: 98765432", ["9876"]],
  ["UBL", "UBL Card 5544 used for PKR 1,200.00 at CAREEM on 10-Nov-2026 21:00", ["5544"]],
  // Meezan
  ["Meezan", "Meezan Bank: PKR 4,500.00 debited from A/C 0101XXXXXX2233 on 08-Nov-26 at 17:30 for purchase at DARAZ. Ref 556677889", ["2233"]],
  ["Meezan", "Dear Customer, PKR 60,000.00 has been credited in your Meezan Bank Account ending with 2233 on 01-Nov-2026 by ACME PVT LTD.", ["2233"]],
  ["Meezan", "Funds Transfer of PKR 10,000.00 from A/C 0101*****2233 to BILAL A/C 0202*****8899 on 08/11/2026 11:11. Ref:FT1234567", ["2233"]],
  ["Meezan", "Rs. 5,000 received in IBAN PK**MEZN****2233 from ALI on 08-11-2026", ["2233"]],
  // Allied Bank
  ["ABL", "ABL: Rs.7,500.00 withdrawn from your A/C ...3344 at ATM GULBERG on 09-11-2026 12:30.", ["3344"]],
  ["ABL", "Allied Bank: Your account 0010XXXX3344 has been credited by PKR 12,000.00 on 09-11-2026. Ref No. 7788990011", ["3344"]],
  // Bank Al Habib, Askari, Faysal, NBP, Standard Chartered, BankIslami, Dubai Islamic, Habib Metro
  ["Bank Al Habib", "Dear Customer, A/C No. XXXX-XXXX-5566 debited PKR 2,000.00 on 10-11-26 at 16:45 via IBFT to SADIA. Ref 44556677", ["5566"]],
  ["Askari", "Askari Bank: PKR 3,000.00 debited from Acct# ***1122 on 10-Nov-2026 10:10 POS at SHELL", ["1122"]],
  ["Faysal", "Faysal Bank: Your Card **** **** **** 6677 was used for PKR 899.00 at DARAZ on 10-Nov-2026.", ["6677"]],
  ["NBP", "NBP: A/C No.XXXXXXXX7788 Credited with Rs.50,000.00 on 01-11-2026 Salary. Bal Rs.80,000.00", ["7788"]],
  ["SCB", "Your SC Debit card ending 9900 has been charged PKR 3,450.00 at CARREFOUR on 10/11/26.", ["9900"]],
  ["BankIslami", "BankIslami: PKR 8,000.00 transferred from your a/c *4455 to ZAIN ALI on 10-11-2026 15:00. TRX ID 123123123", ["4455"]],
  ["DIB", "DIB: PKR 2,500.00 debited from your account ending in 8811 on 10-Nov-2026 via ATM.", ["8811"]],
  ["Habib Metro", "Dear Customer, your account 01XXXXXXXX3311 has been debited by PKR 1,000.00 on 10-NOV-2026", ["3311"]],
  ["Soneri", "Soneri Bank: A/C 0123456789012 credited with PKR 9,000.00 on 10-11-2026 from HAMZA", ["9012"]],
  // Wallets
  ["Easypaisa", "Rs 500.00 sent to 0300****567 ALI on 10/11/2026. TID 12345678901", []],
  ["SadaPay", "You received Rs. 2,000 from Ali Khan.", []],
  // Two of the owner's accounts in one alert: money out leaves the first.
  ["MCB", "PKR 20,000.00 transferred from your A/C ***1234 to your A/C ***5678 on 10-11-2026", ["1234", "5678"]],
];

describe("account digits in every bank's alerts", () => {
  for (const [bank, text, want] of CASES) {
    it(`${bank}: ${text.slice(0, 60)}`, () => {
      const f = own(text);
      expect(f.accountDigits).toEqual(want);
      // The stored hint is the owner's first number when it shows 3 or 4 digits.
      expect(f.accountHint).toBe(want[0] && want[0].length >= 3 ? want[0] : null);
    });
  }

  it("marks the other party's number", () => {
    const ms = findAccountMentions("PKR20,000.00 sent to ALI RAZA KHAN A/C *5678 from A/C *1234 via IBFT", "expense");
    expect(ms.map((m) => [m.digits, m.side])).toEqual([["5678", "other"], ["1234", "own"]]);
  });
  it("does not read amounts, dates, phone numbers or references as accounts", () => {
    expect(accountDigits("PKR 1,234.00 debited on 10-11-2026 at 12:30. Ref 123456789. Call 021111000622", "expense")).toEqual([]);
  });
});
