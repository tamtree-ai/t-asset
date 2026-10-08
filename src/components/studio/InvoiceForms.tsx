"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { createInvoiceAction, deleteDraftAction, duplicateInvoiceAction, issueInvoiceAction, reviseInvoiceAction, saveDraftAction, setPaidAction, voidInvoiceAction } from "@/app/studio/invoices/actions";
import { addDays, computeTotals, type InvoiceBillTo, type InvoiceDiscount, type InvoiceDoc, InvoiceError, type InvoiceLine, type InvoiceStudio, invoiceWarnings, money, parseMoney, qtyLabel } from "@/lib/studio/invoice";
import { renderInvoiceHtml } from "@/lib/studio/invoice-html";

import { ActionButton, Field, FormError, useRunner } from "./Actions";
import { FormDialog } from "./FormDialog";
import { cardCls, inputCls, primaryBtn, quietBtn, textareaCls } from "./kit";

type Option = { id: string; name: string };

/** "New invoice": pick the client (and a project, if it's for one). With a client fixed, it skips the dialog. */
export function NewInvoiceForm({ clients, projects = [], clientId, projectId, kind = "primary" }: { clients?: Option[]; projects?: (Option & { clientId: string })[]; clientId?: string; projectId?: string; kind?: "primary" | "quiet" }) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(clientId ?? clients?.[0]?.id ?? "");
  const [project, setProject] = useState(projectId ?? "");
  const create = (c: string, p: string) => run(() => createInvoiceAction({ clientId: c, projectId: p || null }), (d) => router.push(`/studio/invoices/${d.id}`));
  const cls = kind === "primary" ? primaryBtn : quietBtn;

  if (clientId)
    return (
      <span className="inline-flex flex-col gap-1">
        <button type="button" className={cls} disabled={pending} onClick={() => create(clientId, projectId ?? "")}>
          New invoice
        </button>
        <FormError message={error} />
      </span>
    );

  const theirs = projects.filter((p) => p.clientId === client);
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)} disabled={!clients?.length} title={clients?.length ? undefined : "Add a client first."}>
        New invoice
      </button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="New invoice">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create(client, project);
          }}
        >
          <Field label="Client">
            <select
              className={inputCls}
              value={client}
              onChange={(e) => {
                setClient(e.target.value);
                setProject("");
              }}
            >
              {clients!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project (optional)">
            <select className={inputCls} value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">No project</option>
              {theirs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <FormError message={error} />
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !client} className={primaryBtn}>
              Start the invoice
            </button>
            <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </FormDialog>
    </>
  );
}

/** The invoice page at A4 size (794 × 1123 CSS px), scaled down to the width it's given. */
export function InvoicePreview({ html, title }: { html: string; title: string }) {
  const [scale, setScale] = useState(0.5);
  const box = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e!.contentRect.width / 794));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="overflow-hidden rounded-[10px] border border-line bg-white" style={{ aspectRatio: "794 / 1123" }}>
      <iframe title={title} srcDoc={html} sandbox="" className="block origin-top-left border-0" style={{ width: 794, height: 1123, transform: `scale(${scale})` }} />
    </div>
  );
}

type LineText = { description: string; detail: string; qty: string; price: string };
type Draft = {
  id: string;
  projectId: string | null;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  discount: InvoiceDiscount;
  notes: string;
};

const toText = (l: InvoiceLine): LineText => ({ description: l.description, detail: l.detail ?? "", qty: qtyLabel(l.qty), price: money(l.unitCents).replace(/,/g, "") });
const blank: LineText = { description: "", detail: "", qty: "1", price: "" };

/**
 * Lines on the left, the page as the client will see it on the right. Nothing here has a number until it's issued.
 * With `revise`, it edits an issued invoice in place: same number, saved straight back, no draft buttons.
 */
export function InvoiceEditor({ draft, studio, billTo, projects, termsDays, revise }: { draft: Draft; studio: InvoiceStudio; billTo: InvoiceBillTo; projects: Option[]; termsDays: number; revise?: { number: string } }) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [lines, setLines] = useState<LineText[]>(draft.lines.length ? draft.lines.map(toText) : [blank]);
  const [discountKind, setDiscountKind] = useState<"none" | "amount" | "percent">(draft.discount?.kind ?? "none");
  const [discountValue, setDiscountValue] = useState(draft.discount?.kind === "amount" ? money(draft.discount.cents).replace(/,/g, "") : draft.discount?.kind === "percent" ? qtyLabel(draft.discount.percent) : "");
  const [discountLabel, setDiscountLabel] = useState(draft.discount?.label ?? "");
  const [issueDate, setIssueDate] = useState(draft.issueDate);
  const [dueDate, setDueDate] = useState(draft.dueDate);
  const [notes, setNotes] = useState(draft.notes);
  const [projectId, setProjectId] = useState(draft.projectId ?? "");
  const [saved, setSaved] = useState(false);

  const setLine = (i: number, k: keyof LineText, v: string) => {
    setSaved(false);
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  };
  const move = (i: number, d: -1 | 1) => setLines((ls) => (i + d < 0 || i + d >= ls.length ? ls : ls.map((l, j) => (j === i ? ls[i + d]! : j === i + d ? ls[i]! : l))));

  // What's on screen, as the server will take it; or the first thing that stops it.
  const parsed = useMemo((): { payload: Omit<Draft, "id">; problem: string | null } => {
    let problem: string | null = null;
    const out: InvoiceLine[] = [];
    lines.forEach((l, i) => {
      if (!l.description.trim() && !l.price.trim()) return; // an empty row is ignored
      const qty = Number(l.qty);
      const unitCents = parseMoney(l.price);
      if (!l.description.trim()) problem ??= `Line ${i + 1} needs a description.`;
      if (!(qty > 0)) problem ??= `Line ${i + 1}: the quantity must be a number above 0.`;
      if (unitCents === null) problem ??= `Line ${i + 1}: the price should look like 120 or 120.00.`;
      out.push({ description: l.description.trim(), detail: l.detail.trim() || undefined, qty: qty > 0 ? qty : 1, unitCents: unitCents ?? 0 });
    });
    let discount: InvoiceDiscount = null;
    if (discountKind === "amount") {
      const cents = parseMoney(discountValue);
      if (cents === null) problem ??= "The discount should look like 110 or 110.00.";
      discount = { kind: "amount", cents: cents ?? 0, label: discountLabel.trim() || undefined };
    } else if (discountKind === "percent") {
      const percent = Number(discountValue);
      if (!(percent >= 0 && percent <= 100)) problem ??= "A percentage discount is between 0 and 100.";
      discount = { kind: "percent", percent: percent >= 0 && percent <= 100 ? percent : 0, label: discountLabel.trim() || undefined };
    }
    return { payload: { projectId: projectId || null, issueDate, dueDate, lines: out, discount, notes }, problem };
  }, [lines, discountKind, discountValue, discountLabel, issueDate, dueDate, notes, projectId]);

  // The page as it would print, and anything that stops it adding up.
  const view = useMemo(() => {
    const p = parsed.payload;
    const doc: InvoiceDoc = { number: revise?.number ?? null, issueDate: p.issueDate, dueDate: p.dueDate, billTo, lines: p.lines, discount: p.discount, notes: p.notes, studio, status: revise ? "issued" : "draft" };
    try {
      const totals = computeTotals(doc.lines, doc.discount, studio.gstRegistered);
      return { totals, problem: null, warnings: invoiceWarnings(doc), html: renderInvoiceHtml(doc) };
    } catch (e) {
      return { totals: null, problem: e instanceof InvoiceError ? e.message : "These numbers don't add up.", warnings: invoiceWarnings(doc), html: null };
    }
  }, [parsed, billTo, studio, revise]);
  const { totals, warnings, html } = view;
  const problem = parsed.problem ?? view.problem;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <form
        className="flex flex-col gap-6"
        onChange={() => setSaved(false)}
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return;
          if (revise) {
            if (parsed.payload.lines.length === 0) return;
            run(() => reviseInvoiceAction(draft.id, parsed.payload), () => router.push(`/studio/invoices/${draft.id}`));
          } else run(() => saveDraftAction(draft.id, parsed.payload), () => setSaved(true));
        }}
      >
        <section className={`${cardCls} flex flex-col gap-4 p-5`} aria-labelledby="lines">
          <div className="flex items-baseline justify-between">
            <h2 id="lines" className="text-[15px] font-semibold">
              Lines
            </h2>
            <span className="text-[12px] text-fg-muted">Full price per unit. Put the count in Qty, not in the description.</span>
          </div>
          <div className="hidden grid-cols-[minmax(0,1fr)_72px_104px_96px_56px] gap-2 text-[11px] uppercase tracking-[0.06em] text-fg-muted sm:grid">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <ol className="flex flex-col gap-3">
            {lines.map((l, i) => {
              const qty = Number(l.qty);
              const unit = parseMoney(l.price);
              const amount = qty > 0 && unit !== null ? money(Math.round(qty * unit)) : "—";
              return (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_72px_104px] gap-2 sm:grid-cols-[minmax(0,1fr)_72px_104px_96px_56px]">
                  <div className="flex flex-col gap-1.5">
                    <input className={inputCls} aria-label={`Line ${i + 1} description`} placeholder="Backdrop design for print" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
                    <input className={`${inputCls} h-8 text-[12px]`} aria-label={`Line ${i + 1} detail`} placeholder="Detail (optional): 4 m × 2.2 m" value={l.detail} onChange={(e) => setLine(i, "detail", e.target.value)} />
                  </div>
                  <input className={`${inputCls} num text-right`} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} />
                  <input className={`${inputCls} num text-right`} inputMode="decimal" aria-label={`Line ${i + 1} unit price`} placeholder="0.00" value={l.price} onChange={(e) => setLine(i, "price", e.target.value)} />
                  <span className="num hidden h-9 items-center justify-end text-[13px] text-fg-2 sm:flex">{amount}</span>
                  <span className="col-span-3 flex items-start gap-0.5 sm:col-span-1">
                    <button type="button" className="h-9 w-6 text-fg-muted hover:text-fg disabled:opacity-30" aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="h-9 w-6 text-fg-muted hover:text-[#ff9a8a]" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => (ls.length === 1 ? [blank] : ls.filter((_, j) => j !== i)))}>
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <div>
            <button type="button" className={quietBtn} onClick={() => setLines((ls) => [...ls, blank])} disabled={lines.length >= 50}>
              Add a line
            </button>
          </div>
        </section>

        <section className={`${cardCls} grid gap-4 p-5 sm:grid-cols-3`} aria-label="Discount">
          <Field label="Discount on the whole invoice">
            <select className={inputCls} value={discountKind} onChange={(e) => setDiscountKind(e.target.value as typeof discountKind)}>
              <option value="none">No discount</option>
              <option value="amount">An amount ($)</option>
              <option value="percent">A percentage (%)</option>
            </select>
          </Field>
          {discountKind !== "none" && (
            <>
              <Field label={discountKind === "amount" ? "Amount off" : "Percent off"}>
                <input className={`${inputCls} num`} inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder={discountKind === "amount" ? "110.00" : "10"} />
              </Field>
              <Field label="Label (optional)">
                <input className={inputCls} value={discountLabel} maxLength={60} onChange={(e) => setDiscountLabel(e.target.value)} placeholder="Community discount" />
              </Field>
            </>
          )}
        </section>

        <section className={`${cardCls} grid gap-4 p-5 sm:grid-cols-3`} aria-label="Dates and project">
          <Field label="Invoice date">
            <input
              type="date"
              className={inputCls}
              value={issueDate}
              onChange={(e) => {
                setIssueDate(e.target.value);
                if (e.target.value) setDueDate(addDays(e.target.value, termsDays));
              }}
            />
          </Field>
          <Field label="Due date" hint={`Your terms: ${termsDays} days.`}>
            <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Project">
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-3">
            <Field label="Note on the invoice (optional)">
              <textarea className={textareaCls} rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Thank you for the work." />
            </Field>
          </div>
        </section>

        {totals && (
          <dl className="ml-auto grid w-full max-w-[300px] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13px]">
            <dt className="text-fg-3">Subtotal</dt>
            <dd className="num text-right">{money(totals.subtotalCents)}</dd>
            {totals.discountCents > 0 && (
              <>
                <dt className="text-fg-3">{discountLabel.trim() || "Discount"}</dt>
                <dd className="num text-right text-ready">{money(-totals.discountCents)}</dd>
              </>
            )}
            {studio.gstRegistered && (
              <>
                <dt className="text-fg-3">GST 10%</dt>
                <dd className="num text-right">{money(totals.gstCents)}</dd>
              </>
            )}
            <dt className="border-t border-line pt-2 font-semibold">Total due</dt>
            <dd className="num border-t border-line pt-2 text-right text-[15px] font-semibold">{money(totals.totalCents, true)}</dd>
          </dl>
        )}

        {(problem || warnings.length > 0) && (
          <ul className="flex flex-col gap-1.5 rounded-lg border border-attention-line bg-attention-soft px-4 py-3 text-[12.5px] text-attention">
            {problem && <li>{problem}</li>}
            {warnings.map((w) => (
              <li key={w}>▲ {w}</li>
            ))}
          </ul>
        )}

        <FormError message={error} />
        {revise ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || !!problem || parsed.payload.lines.length === 0} className={primaryBtn}>
              Save changes to {revise.number}
            </button>
            <Link href={`/studio/invoices/${draft.id}`} className={quietBtn}>
              Cancel
            </Link>
            <span className="text-[12.5px] text-fg-3">If the client already has it, send them the new PDF.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || !!problem} className={quietBtn}>
              Save draft
            </button>
            <button
              type="button"
              disabled={pending || !!problem || parsed.payload.lines.length === 0}
              className={primaryBtn}
              onClick={() => {
                if (!window.confirm(`Issue this invoice for ${totals ? money(totals.totalCents, true) : ""}? It takes the next number. You can still edit it until it's marked paid.`)) return;
                run(() => issueInvoiceAction(draft.id, parsed.payload));
              }}
            >
              Issue invoice
            </button>
            {saved && <span className="text-[12.5px] text-fg-3">Saved.</span>}
            <span className="flex-1" />
            <ActionButton kind="danger" confirm="Delete this draft?" action={() => deleteDraftAction(draft.id)} onDone={() => router.push("/studio/invoices")}>
              Delete draft
            </ActionButton>
          </div>
        )}
      </form>

      <aside aria-label="Preview" className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-[13px] text-fg-3">Preview</h2>
        {html ? <InvoicePreview html={html} title="Invoice preview" /> : <div className={`${cardCls} p-6 text-[13px] text-fg-muted`}>The preview comes back once the numbers add up.</div>}
        <p className="text-[12px] text-fg-muted">
          Studio details come from{" "}
          <Link href="/settings/invoicing" className="underline hover:text-fg">
            Invoicing settings
          </Link>
          , the billing address from the client. {revise ? "Saving takes a fresh copy of both." : "Issuing keeps a copy of both."}
        </p>
      </aside>
    </div>
  );
}

/** An issued invoice: print it, record payment, void it, or start the next one from it. */
export function IssuedInvoiceActions({ id, status }: { id: string; status: "issued" | "paid" | "void" }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-start gap-2">
      <a href={`/studio/invoices/${id}/document`} target="_blank" rel="noopener" className={primaryBtn}>
        Print or save as PDF
      </a>
      {status === "issued" && (
        <Link href={`/studio/invoices/${id}?edit=1`} className={quietBtn}>
          Edit
        </Link>
      )}
      {status === "issued" && <ActionButton action={() => setPaidAction(id, true)}>Mark paid</ActionButton>}
      {status === "paid" && <ActionButton action={() => setPaidAction(id, false)}>Mark unpaid</ActionButton>}
      <ActionButton action={() => duplicateInvoiceAction(id).then((r) => (r.ok && router.push(`/studio/invoices/${r.data.id}`), r))}>Duplicate</ActionButton>
      {status !== "void" && (
        <ActionButton kind="danger" confirm="Void this invoice? It keeps its number and is marked VOID. This can't be undone." action={() => voidInvoiceAction(id)}>
          Void
        </ActionButton>
      )}
    </div>
  );
}
