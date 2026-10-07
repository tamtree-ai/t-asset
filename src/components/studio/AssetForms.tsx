"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { addVariationAction, archiveAssetAction, createAssetAction, deleteAssetAction, deleteVariationAction, renameAssetAction, renameVariationAction } from "@/app/studio/actions";

import { ActionButton, Field, FormError, useRunner } from "./Actions";
import { FormDialog } from "./FormDialog";
import { cardCls, inputCls, primaryBtn, quietBtn } from "./kit";

export function NewAssetForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  return (
    <>
      <button type="button" className={primaryBtn} onClick={() => setOpen(true)}>
        New asset
      </button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="New asset">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createAssetAction(projectId, { title, kind }), (d) => router.push(`/studio/assets/${d.id}`));
          }}
        >
          <Field label="Title">
            <input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Instagram banner 1080×1350" />
          </Field>
          <fieldset className="flex gap-4 text-[13px] text-fg-2">
            <legend className="mb-1.5 text-[12.5px] text-fg-3">What is it?</legend>
            {(["image", "video"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                {k === "image" ? "Image (banner, poster, logo)" : "Video"}
              </label>
            ))}
          </fieldset>
          <FormError message={error} />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={primaryBtn}>
              Add asset
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

/** Rename and add/remove options (variations) on the asset page. */
export function AssetSettings({
  asset,
  variations,
  activeVariationId,
  canDelete,
}: {
  asset: { id: string; title: string; projectId: string };
  variations: { id: string; label: string }[];
  activeVariationId: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [title, setTitle] = useState(asset.title);
  const [newLabel, setNewLabel] = useState("");
  const active = variations.find((v) => v.id === activeVariationId) ?? variations[0]!;
  const [label, setLabel] = useState(active.label);
  return (
    <details className={`${cardCls} group`}>
      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] text-fg-3 hover:text-fg">Asset settings</summary>
      <div className="flex flex-col gap-5 border-t border-rule p-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameAssetAction(asset.id, title));
          }}
        >
          <Field label="Asset title">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <button type="submit" disabled={pending} className={quietBtn}>
            Rename
          </button>
        </form>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameVariationAction(active.id, label));
          }}
        >
          <Field label={`Rename option “${active.label}”`}>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <button type="submit" disabled={pending} className={quietBtn}>
            Rename
          </button>
          {variations.length > 1 && (
            <ActionButton kind="danger" confirm={`Delete the option “${active.label}” with its versions and comments?`} action={() => deleteVariationAction(active.id)} onDone={() => router.push(`/studio/assets/${asset.id}`)}>
              Delete option
            </ActionButton>
          )}
        </form>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addVariationAction(asset.id, newLabel), (d) => {
              setNewLabel("");
              router.push(`/studio/assets/${asset.id}?option=${d.id}`);
            });
          }}
        >
          <Field label="Add another option" hint="A parallel direction, like “Option B: bold”">
            <input className={inputCls} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Option B: bold" />
          </Field>
          <button type="submit" disabled={pending} className={quietBtn}>
            Add option
          </button>
        </form>
        <FormError message={error} />

        <div className="flex gap-2 border-t border-rule pt-4">
          <ActionButton action={() => archiveAssetAction(asset.id, asset.projectId)}>Archive asset</ActionButton>
          {canDelete && (
            <ActionButton kind="danger" confirm={`Delete “${asset.title}” with every option, version, file and comment? This can't be undone.`} action={() => deleteAssetAction(asset.id, asset.projectId)}>
              Delete asset
            </ActionButton>
          )}
        </div>
      </div>
    </details>
  );
}
