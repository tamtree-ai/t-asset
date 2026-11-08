import { Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { getCurrentMember } from "@/lib/auth";
import { listApiTokens } from "@/services/studio/api-tokens";

import { TokenList } from "./TokenList";

export const dynamic = "force-dynamic";

/** Review API tokens: how tamshoot and pipeline scripts put work in the room (docs/review-api.md). */
export default async function ApiTokensPage() {
  const member = await getCurrentMember();
  if (member.role !== "owner") {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-[14px] text-fg-muted">API tokens stay with the workspace owner.</p>
      </main>
    );
  }
  const tokens = await listApiTokens(member.orgId);
  return (
    <>
      <StudioHeader trail={[{ label: "API tokens" }]} />
      <Page>
        <Title sub={<>A tool that makes the work (tamshoot, a pipeline script) uses a token to send versions here and read the client’s comments. A token is shown once; revoke it the moment it leaks.</>}>API tokens</Title>
        <TokenList
          tokens={tokens.map((t) => ({ id: t.id, name: t.name, hint: t.tokenHint, scopes: t.scopes, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() }))}
        />
      </Page>
    </>
  );
}
