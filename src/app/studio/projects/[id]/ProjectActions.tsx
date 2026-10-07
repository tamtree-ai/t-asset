import Link from "next/link";

import { NewAssetForm } from "@/components/studio/AssetForms";
import { quietBtn } from "@/components/studio/kit";

/** The two header actions on a project: add an asset, and make a review link (once something is uploaded). */
export function ProjectActions({ projectId, canShare }: { projectId: string; canShare: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {canShare && (
        <Link href={`/studio/projects/${projectId}/share`} className={quietBtn}>
          New review link
        </Link>
      )}
      <NewAssetForm projectId={projectId} />
    </div>
  );
}
