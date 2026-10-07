/** Contacts edit as plain text, one per line, and are parsed back into `{name, email, role}`. */

export type Contact = { name: string; email: string; role?: string };

/** One line each, so contacts edit as plain text. */
export function contactsToText(c: Contact[]): string {
  return c.map((x) => [x.name, x.email, x.role].filter(Boolean).join(" · ")).join("\n");
}

/** Lines like `Sam Lee · sam@acme.com · Marketing` or just `sam@acme.com`. */
export function parseContacts(text: string): Contact[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[·|,]\s*/).map((p) => p.trim()).filter(Boolean);
      const emailAt = parts.findIndex((p) => p.includes("@"));
      const email = emailAt >= 0 ? parts[emailAt]! : "";
      const rest = parts.filter((_, i) => i !== emailAt);
      return { name: rest[0] ?? "", email, ...(rest[1] ? { role: rest[1] } : {}) };
    });
}
