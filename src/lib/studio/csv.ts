/** CSV for comment export (plan §2: table stakes). Excel opens it, and a cell can't run as a formula. */

/** A cell that starts with = + - @ (or a tab/CR) is a formula to a spreadsheet; a leading apostrophe makes it text. */
export function safeCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // The BOM tells Excel it's UTF-8, so “smart quotes” and names with accents survive.
  return `﻿${[header, ...rows].map((r) => r.map(safeCell).join(",")).join("\r\n")}\r\n`;
}
