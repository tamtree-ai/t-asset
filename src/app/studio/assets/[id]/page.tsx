import Link from "next/link";
import { notFound } from "next/navigation";

import { AssetSettings } from "@/components/studio/AssetForms";
import { AutoRefresh } from "@/components/studio/AutoRefresh";
import { bytesLabel, Empty, Page, quietBtn, StatusLine, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { Workspace } from "@/components/review/Workspace";
import { ProcessingNotice } from "@/components/studio/ProcessingNotice";
import { UploadPanel } from "@/components/studio/UploadPanel";
import { ChangeNoteEditor, DeleteVersionButton } from "@/components/studio/VersionActions";
import type { ReviewApi, RoomAssetView } from "@/lib/studio/room-types";
import { ownerCommentAction, ownerDeleteAction, ownerEditAction, ownerHideAction, ownerReplyAction, ownerResolveAction, ownerThreadsAction } from "../../review-actions";
import { brandCss } from "@/lib/studio/color";
import { studioMember } from "@/lib/studio/member";
import { assetDetail } from "@/services/studio/assets";
import { getBrand } from "@/services/studio/brand";
import { getClient } from "@/services/studio/clients";
import { listThreads, ownerScope } from "@/services/studio/comments";
import { latestSignoffs } from "@/services/studio/room-data";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ option?: string; v?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const member = await studioMember();
  const detail = await assetDetail(member.orgId, id);
  if (!detail) notFound();
  const { asset, project, variations } = detail;
  const client = await getClient(member.orgId, project.clientId);
  const variation = variations.find((v) => v.id === sp.option) ?? variations[0]!;
  const version = variation.versions.find((v) => v.id === sp.v) ?? variation.versions[0] ?? null;
  const anyPending = variations.some((v) => v.versions.some((x) => x.file.processing === "pending"));

  const brand = await getBrand(member.orgId);
  const signoffs = await latestSignoffs(variations.flatMap((v) => v.versions.map((x) => x.id)));
  const roomAssets = toOwnerView(asset, variations, signoffs);
  const scope = version ? await ownerScope(member.orgId, version.id) : null;
  const initialThreads = scope ? await listThreads(scope, { memberId: member.memberId }) : [];
  const api: ReviewApi = {
    threads: ownerThreadsAction,
    comment: ownerCommentAction,
    reply: ownerReplyAction,
    resolve: ownerResolveAction,
    edit: ownerEditAction,
    remove: ownerDeleteAction,
    hide: ownerHideAction,
  };

  return (
    <>
      <AutoRefresh active={anyPending} />
      <StudioHeader trail={[{ label: client?.name ?? "Client", href: `/studio/clients/${project.clientId}` }, { label: project.name, href: `/studio/projects/${project.id}` }, { label: asset.title }]} />
      <Page wide>
        <Title sub={`${asset.kind === "video" ? "Video" : "Image"} · ${variations.length} ${variations.length === 1 ? "option" : "options"}`}>{asset.title}</Title>

        <nav aria-label="Options" className="flex flex-wrap gap-1 border-b border-rule">
          {variations.map((v) => (
            <Link
              key={v.id}
              href={`/studio/assets/${id}?option=${v.id}`}
              aria-current={v.id === variation.id ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-[13.5px] ${v.id === variation.id ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg"}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-w-0 flex-col gap-6">
            {variation.versions.length > 0 && (
              <nav aria-label="Versions" className="flex gap-2 overflow-x-auto pb-1">
                {variation.versions.map((v) => (
                  <Link
                    key={v.id}
                    href={`/studio/assets/${id}?option=${variation.id}&v=${v.id}`}
                    aria-current={version?.id === v.id ? "true" : undefined}
                    className={`flex shrink-0 flex-col gap-1 rounded-[10px] border px-3.5 py-2.5 hover:bg-hover ${version?.id === v.id ? "border-accent bg-hover" : "border-rule bg-panel"}`}
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span className="text-[13.5px] font-medium">v{v.number}</span>
                      <StatusLine status={v.status} />
                    </span>
                    <span className="num text-[11.5px] text-fg-muted">
                      {v.openComments} open · {v.totalComments} {v.totalComments === 1 ? "comment" : "comments"}
                    </span>
                  </Link>
                ))}
              </nav>
            )}
            {version ? (
              <>
                {version.file.processing !== "ready" && <ProcessingNotice fileId={version.file.id} assetId={id} state={version.file.processing} error={version.file.error} />}
                <div className="room overflow-hidden rounded-xl" style={{ minHeight: 0 }}>
                  <style>{brandCss(brand.accentHex, "light")}</style>
                <Workspace
                  key={`${version.id}:${version.file.processing}`}
                  audience="owner"
                  token={null}
                  embedded
                  hideSwitchers
                  assets={roomAssets}
                  initial={{ assetId: asset.id, variationId: variation.id, versionId: version.id }}
                  initialThreads={initialThreads}
                  api={api}
                  commentsOpen
                  brand={{ studioName: brand.studioName, hasLogo: false }}
                  title={asset.title}
                  downloadPolicy="always"
                />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[15px] font-semibold">v{version.number}</span>
                    <StatusLine status={version.status} />
                    <span className="text-[12.5px] text-fg-muted">
                      {version.file.width && version.file.height ? `${version.file.width}×${version.file.height} · ` : ""}
                      {bytesLabel(version.file.bytes)} · {version.file.originalName}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/studio/projects/${project.id}/share?asset=${id}`} className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-accent-ink hover:brightness-110">
                      Share with client
                    </Link>
                    <a href={`/api/studio/export?version=${version.id}`} className={quietBtn}>
                      Export comments (CSV)
                    </a>
                    {version.status !== "in_review" && (
                      <Link href={`/studio/versions/${version.id}/certificate`} className={quietBtn}>
                        Sign-off record
                      </Link>
                    )}
                    <DeleteVersionButton versionId={version.id} number={version.number} />
                  </div>
                </div>
                <ChangeNoteEditor key={version.id} versionId={version.id} note={version.changeNote} />
              </>
            ) : (
              <Empty title="Nothing uploaded to this option yet">Upload the first version below. Comments and approvals belong to a version.</Empty>
            )}

            <UploadPanel assetId={id} variationId={variation.id} kind={asset.kind} nextNumber={(variation.versions[0]?.number ?? 0) + 1} />
          </div>

          <AssetSettings asset={{ id, title: asset.title, projectId: project.id }} variations={variations.map((v) => ({ id: v.id, label: v.label }))} activeVariationId={variation.id} canDelete={member.role === "owner"} />
        </div>
      </Page>
    </>
  );
}

/** The asset page's own data in the shape the room takes. The studio sees clean files, so nothing is marked. */
function toOwnerView(
  asset: { id: string; title: string; kind: "image" | "video" },
  variations: { id: string; label: string; versions: { id: string; number: number; status: "in_review" | "changes_requested" | "approved"; changeNote: string; createdAt: Date; file: { id: string; mime: string; width: number | null; height: number | null; durationS: number | null; fpsNum: number | null; fpsDen: number | null; processing: "uploading" | "pending" | "ready" | "failed"; bytes: number; originalName: string } }[] }[],
  signoffs: Awaited<ReturnType<typeof latestSignoffs>>,
): RoomAssetView[] {
  return [
    {
      id: asset.id,
      title: asset.title,
      kind: asset.kind,
      variations: variations
        .filter((v) => v.versions.length > 0)
        .map((v) => ({
          id: v.id,
          label: v.label,
          // The page lists versions newest first; the room wants oldest first.
          versions: [...v.versions].reverse().map((x, i, all) => ({
            id: x.id,
            number: x.number,
            status: x.status,
            changeNote: x.changeNote,
            createdAt: x.createdAt.toISOString(),
            file: { id: x.file.id, mime: x.file.mime, width: x.file.width, height: x.file.height, durationS: x.file.durationS, fpsNum: x.file.fpsNum, fpsDen: x.file.fpsDen, processing: x.file.processing, bytes: x.file.bytes, originalName: x.file.originalName },
            marked: false,
            canDownload: true,
            latest: i === all.length - 1,
            signoff: signoffs.get(x.id) ?? null,
          })),
        })),
    },
  ];
}
