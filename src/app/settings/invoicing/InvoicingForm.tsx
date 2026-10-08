"use client";

import { useState } from "react";

import { saveInvoiceSettingsAction } from "@/app/studio/invoices/actions";
import { Field, FormError, useRunner } from "@/components/studio/Actions";
import { cardCls, inputCls, primaryBtn, quietBtn, textareaCls } from "@/components/studio/kit";

type Values = {
  legalName: string;
  abn: string;
  address: string;
  gstRegistered: boolean;
  paymentTermsDays: number;
  invoiceTerms: string;
  bankAccountName: string;
  bankBsb: string;
  bankAccountNo: string;
  payByPost: boolean;
  invoicePrefix: string;
  nextInvoiceNo: number;
  invoiceLogo: string | null;
};

const MAX_LOGO_BYTES = 150_000;

export function InvoicingForm({ initial }: { initial: Values }) {
  const { run, error, pending, setError } = useRunner();
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setSaved(false);
    setV((p) => ({ ...p, [k]: val }));
  };

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setError("The logo must be a PNG, JPEG, WebP or SVG.");
    if (file.size > MAX_LOGO_BYTES) return setError("Keep the logo under 150 KB. A 1000 px wide PNG is plenty for print.");
    const r = new FileReader();
    r.onload = () => set("invoiceLogo", String(r.result));
    r.readAsDataURL(file);
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => saveInvoiceSettingsAction(v), () => setSaved(true));
      }}
    >
      <section className={`${cardCls} flex flex-col gap-4 p-5`} aria-labelledby="business">
        <h2 id="business" className="text-[15px] font-semibold">
          Business
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name on invoices" hint="Leave blank to use the studio name.">
            <input className={inputCls} value={v.legalName} maxLength={100} onChange={(e) => set("legalName", e.target.value)} placeholder="Trading name" />
          </Field>
          <Field label="ABN">
            <input className={inputCls} value={v.abn} onChange={(e) => set("abn", e.target.value)} placeholder="11 digits" inputMode="numeric" />
          </Field>
        </div>
        <Field label="Address" hint="As it should print, one line per row.">
          <textarea className={textareaCls} rows={3} value={v.address} maxLength={300} onChange={(e) => set("address", e.target.value)} placeholder={"Street\nSuburb STATE postcode"} />
        </Field>
        <Field label="Logo" hint="PNG, JPEG, WebP or SVG, under 150 KB. Without one, the name is printed in its place.">
          <span className="flex flex-wrap items-center gap-3">
            {v.invoiceLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.invoiceLogo} alt="Current logo" className="h-12 max-w-[200px] rounded bg-white object-contain p-1" />
            )}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="Choose a logo" className="text-[12.5px] text-fg-3 file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-fg-2" onChange={(e) => pickLogo(e.target.files?.[0])} />
            {v.invoiceLogo && (
              <button type="button" className={quietBtn} onClick={() => set("invoiceLogo", null)}>
                Remove logo
              </button>
            )}
          </span>
        </Field>
        <label className="flex items-start gap-2.5 text-[13px] text-fg-2">
          <input type="checkbox" className="mt-0.5" checked={v.gstRegistered} onChange={(e) => set("gstRegistered", e.target.checked)} />
          <span>
            Registered for GST
            <span className="block text-[12px] text-fg-muted">On: a “Tax Invoice” with 10% GST added after the discount. Off: an “Invoice” that says no GST was charged.</span>
          </span>
        </label>
      </section>

      <section className={`${cardCls} flex flex-col gap-4 p-5`} aria-labelledby="payment">
        <h2 id="payment" className="text-[15px] font-semibold">
          Getting paid
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Account name">
            <input className={inputCls} value={v.bankAccountName} maxLength={100} onChange={(e) => set("bankAccountName", e.target.value)} placeholder="Name on the account" />
          </Field>
          <Field label="BSB">
            <input className={inputCls} value={v.bankBsb} onChange={(e) => set("bankBsb", e.target.value)} placeholder="000-000" inputMode="numeric" />
          </Field>
          <Field label="Account number">
            <input className={inputCls} value={v.bankAccountNo} onChange={(e) => set("bankAccountNo", e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <p className="-mt-2 text-[12px] text-fg-muted">Leave the bank fields empty to leave bank transfer off the invoice.</p>
        <label className="flex items-center gap-2.5 text-[13px] text-fg-2">
          <input type="checkbox" checked={v.payByPost} onChange={(e) => set("payByPost", e.target.checked)} />
          Accept payment by post, to the address above
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Payment terms (days)">
            <input className={`${inputCls} num`} type="number" min={0} max={365} value={v.paymentTermsDays} onChange={(e) => set("paymentTermsDays", Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Terms printed on every invoice">
          <textarea className={textareaCls} rows={3} value={v.invoiceTerms} maxLength={1200} onChange={(e) => set("invoiceTerms", e.target.value)} />
        </Field>
      </section>

      <section className={`${cardCls} flex flex-col gap-4 p-5`} aria-labelledby="numbering">
        <h2 id="numbering" className="text-[15px] font-semibold">
          Numbering
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Prefix">
            <input className={inputCls} value={v.invoicePrefix} maxLength={10} onChange={(e) => set("invoicePrefix", e.target.value)} />
          </Field>
          <Field label="Next number" hint={`The next invoice issued is ${v.invoicePrefix}${v.nextInvoiceNo}.`}>
            <input className={`${inputCls} num`} type="number" min={1} value={v.nextInvoiceNo} onChange={(e) => set("nextInvoiceNo", Number(e.target.value))} />
          </Field>
        </div>
      </section>

      <FormError message={error} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryBtn}>
          Save invoicing
        </button>
        {saved && <span className="text-[12.5px] text-fg-3">Saved.</span>}
      </div>
    </form>
  );
}
