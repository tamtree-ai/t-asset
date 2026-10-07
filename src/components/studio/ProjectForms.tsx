"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { archiveProjectAction, createProjectAction, deleteProjectAction, updateProjectAction } from "@/app/studio/actions";

import { ActionButton, Field, FormError, useRunner } from "./Actions";
import { FormDialog } from "./FormDialog";
import { cardCls, inputCls, primaryBtn, quietBtn } from "./kit";

export function NewProjectForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [rounds, setRounds] = useState("2");
  return (
    <>
      <button type="button" className={primaryBtn} onClick={() => setOpen(true)}>
        New project
      </button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="New project">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createProjectAction(clientId, { name, dueDate, roundsIncluded: rounds }), (d) => router.push(`/studio/projects/${d.id}`));
          }}
        >
          <Field label="Project name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring campaign 2026" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Revision rounds included" hint="From your contract">
              <input type="number" min={0} max={20} className={inputCls} value={rounds} onChange={(e) => setRounds(e.target.value)} />
            </Field>
          </div>
          <FormError message={error} />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={primaryBtn}>
              Add project
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

export function ProjectEditor({ project }: { project: { id: string; clientId: string; name: string; dueDate: string | null; roundsIncluded: number; status: "active" | "paused" | "delivered"; archived: boolean } }) {
  const { run, error, pending } = useRunner();
  const [name, setName] = useState(project.name);
  const [dueDate, setDueDate] = useState(project.dueDate ?? "");
  const [rounds, setRounds] = useState(String(project.roundsIncluded));
  const [status, setStatus] = useState(project.status);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className={`${cardCls} flex flex-col gap-4 p-5`}
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => updateProjectAction(project.id, { name, dueDate, roundsIncluded: rounds, status }), () => setSaved(true));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="Project name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Due date">
          <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Rounds included">
          <input type="number" min={0} max={20} className={inputCls} value={rounds} onChange={(e) => setRounds(e.target.value)} />
        </Field>
      </div>
      <Field label="Project state">
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="delivered">Delivered</option>
        </select>
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primaryBtn}>
          Save project
        </button>
        {saved && <span className="text-[12.5px] text-fg-3">Saved.</span>}
        <span className="flex-1" />
        <ActionButton action={() => archiveProjectAction(project.id, !project.archived)}>{project.archived ? "Restore" : "Archive"}</ActionButton>
        <ActionButton kind="danger" confirm={`Delete ${project.name} with every asset, file, comment and sign-off? This can't be undone.`} action={() => deleteProjectAction(project.id, project.clientId)}>
          Delete
        </ActionButton>
      </div>
        </form>
  );
}
