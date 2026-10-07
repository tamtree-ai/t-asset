"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { archiveClientAction, createClientAction, deleteClientAction, updateClientAction } from "@/app/studio/actions";

import { type Contact, contactsToText, parseContacts } from "@/lib/studio/contacts";

import { ActionButton, Field, FormError, useRunner } from "./Actions";
import { FormDialog } from "./FormDialog";
import { cardCls, inputCls, primaryBtn, quietBtn, textareaCls } from "./kit";

export function NewClientForm() {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  return (
    <>
      <button type="button" className={primaryBtn} onClick={() => setOpen(true)}>
        New client
      </button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="New client">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createClientAction({ name, company }), (d) => router.push(`/studio/clients/${d.id}`));
          }}
        >
          <Field label="Client name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Coffee" />
          </Field>
          <Field label="Company (optional)">
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <FormError message={error} />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={primaryBtn}>
              Add client
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

export function ClientEditor({ client }: { client: { id: string; name: string; company: string | null; notes: string; contacts: Contact[]; archived: boolean } }) {
  const { run, error, pending } = useRunner();
  const [name, setName] = useState(client.name);
  const [company, setCompany] = useState(client.company ?? "");
  const [notes, setNotes] = useState(client.notes);
  const [contacts, setContacts] = useState(contactsToText(client.contacts));
  const [saved, setSaved] = useState(false);
  return (
    <form
      className={`${cardCls} flex flex-col gap-4 p-5`}
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => updateClientAction(client.id, { name, company, notes, contacts: parseContacts(contacts) }), () => setSaved(true));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Company">
          <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
      </div>
      <Field label="Contacts" hint="One per line: Name · email · role">
        <textarea className={textareaCls} rows={3} value={contacts} onChange={(e) => setContacts(e.target.value)} placeholder="Sam Lee · sam@acme.com · Marketing" />
      </Field>
      <Field label="Notes (only you see these)">
        <textarea className={textareaCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primaryBtn}>
          Save client
        </button>
        {saved && <span className="text-[12.5px] text-fg-3">Saved.</span>}
        <span className="flex-1" />
        <ActionButton action={() => archiveClientAction(client.id, !client.archived)}>{client.archived ? "Restore" : "Archive"}</ActionButton>
        <ActionButton kind="danger" confirm={`Delete ${client.name} and every project, file and comment under it? This can't be undone.`} action={() => deleteClientAction(client.id)}>
          Delete
        </ActionButton>
      </div>
        </form>
  );
}
