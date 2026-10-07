import { Ended } from "@/components/review/Ended";
import { Gate } from "@/components/review/Gate";
import { Identify } from "@/components/review/Identify";
import { Workspace } from "@/components/review/Workspace";
import type { ReviewApi } from "@/lib/studio/room-types";
import { touchReviewer } from "@/services/studio/access";
import { getBrand } from "@/services/studio/brand";
import { guestScope, listThreads } from "@/services/studio/comments";
import { guestState } from "@/services/studio/guest";
import { getProject, projectRounds } from "@/services/studio/projects";
import { initialSelection, latestSignoffs, projectClientName, toView } from "@/services/studio/room-data";
import { loadShareContent } from "@/services/studio/room";
import { commentAction, decideAction, deleteAction, editAction, replyAction, resolveAction, threadsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ v?: string; c?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const g = await guestState(token);

  if (g.kind === "missing") return <Ended token={token} studioName="" hasLogo={false} supportEmail={null} website={null} reason="missing" />;

  const brand = await getBrand(g.share.orgId);
  const hasLogo = false;
  if (g.kind === "ended") return <Ended token={token} studioName={brand.studioName} hasLogo={hasLogo} supportEmail={brand.supportEmail} website={brand.website} reason={g.reason} />;

  const clientName = await projectClientName(g.share.projectId);
  if (g.kind === "gate") return <Gate token={token} studioName={brand.studioName} hasLogo={hasLogo} title={g.share.title} clientName={clientName} />;
  if (g.kind === "identify") return <Identify token={token} studioName={brand.studioName} hasLogo={hasLogo} />;

  const { share, reviewer } = g;
  await touchReviewer(reviewer.id);
  const content = await loadShareContent(share);
  if (content.length === 0) return <Ended token={token} studioName={brand.studioName} hasLogo={hasLogo} supportEmail={brand.supportEmail} website={brand.website} reason="revoked" />;

  const versionIds = content.flatMap((a) => a.variations.flatMap((v) => v.versions.map((x) => x.id)));
  const [signoffs, project] = await Promise.all([latestSignoffs(versionIds), getProject(share.orgId, share.projectId)]);
  const rounds = project ? await projectRounds(share.orgId, project) : null;
  const initial = initialSelection(content, sp.v);
  const scope = await guestScope(share, initial.versionId);
  const initialThreads = scope ? await listThreads(scope, { reviewerId: reviewer.id }) : [];

  const api: ReviewApi = {
    threads: threadsAction.bind(null, token),
    comment: commentAction.bind(null, token),
    reply: replyAction.bind(null, token),
    resolve: resolveAction.bind(null, token),
    edit: editAction.bind(null, token),
    remove: deleteAction.bind(null, token),
    decide: decideAction.bind(null, token),
  };

  return (
    <Workspace
      audience="client"
      token={token}
      assets={toView(share, content, signoffs)}
      initial={{ ...initial, commentId: sp.c ?? null }}
      initialThreads={initialThreads}
      api={api}
      commentsOpen={share.commentsOpen}
      brand={{ studioName: brand.studioName, hasLogo }}
      title={share.title}
      viewerName={reviewer.name}
      clientName={clientName}
      rounds={rounds ? { label: rounds.label, over: rounds.over, note: rounds.note } : null}
      cover={{ key: share.id, message: share.message, notes: share.notes }}
      downloadPolicy={share.downloadPolicy}
    />
  );
}
