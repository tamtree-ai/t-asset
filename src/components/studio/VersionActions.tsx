"use client";

import { useState } from "react";

import { deleteVersionAction, setChangeNoteAction } from "@/app/studio/actions";

import { ActionButton, FormError, useRunner } from "./Actions";
import { inputCls, quietBtn } from "./kit";

export function ChangeNoteEditor({ versionId, note }: { versionId: string; note: string }) {
  const { run, error, pending } = useRunner();
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => setChangeNoteAction(versionId, value), () => setSaved(true));
      }}
    >
      <label className="flex flex-col gap-1.5 text-[12.5px] text-fg-3">
        What changed in this version
        <span className="flex gap-2">
          <input className={inputCls} value={value} maxLength={2000} onChange={(e) => setValue(e.target.value)} placeholder="Say what you changed since the last version" />
          <button type="submit" disabled={pending || value === note} className={quietBtn}>
            Save
          </button>
        </span>
      </label>
      {saved && <span className="text-[12px] text-fg-3">Saved.</span>}
      <FormError message={error} />
    </form>
  );
}

export function DeleteVersionButton({ versionId, number }: { versionId: string; number: number }) {
  return (
    <ActionButton kind="danger" confirm={`Delete v${number}, its file and its comments? This can't be undone.`} action={() => deleteVersionAction(versionId)}>
      Delete v{number}
    </ActionButton>
  );
}
