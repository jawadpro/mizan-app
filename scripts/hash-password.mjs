// Usage: npm run hash-password -- 'your passphrase'
// Prints a value for the ADMIN_PASSWORD_HASH environment variable.
import crypto from "node:crypto";

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error("Provide a passphrase of at least 12 characters.");
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
console.log(`scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`);
