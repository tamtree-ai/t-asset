# Invoices without the studio running

```bash
cp invoices/studio.example.json invoices/studio.json   # once: your ABN, address, bank, logo
cp invoices/PD0000.example.json invoices/PD6326.json   # per invoice
pnpm invoice invoices/PD6326.json                       # → invoices/out/PD6326.pdf
```

Everything in this folder except the examples and this file is git-ignored.

- Prices are per unit, before any discount. The only discount is `discount` on the whole invoice: `{ "amount": 110 }` or `{ "percent": 25 }`.
- The count goes in `qty`, not in the description ("3", not "4x screens"). The script warns when they disagree.
- `expectTotal` makes the script refuse a PDF whose total differs.
- `dueDate` defaults to `issueDate` plus `termsDays` from `studio.json`.
- `gstRegistered: true` makes it a Tax Invoice with 10% GST on the discounted subtotal.

The studio's Invoices page (`/studio/invoices`) does the same, and keeps the numbering and the record.
