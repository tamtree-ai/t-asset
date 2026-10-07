import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";

import { uploadingFile } from "@/services/studio/files";
import { ownerOrNull } from "@/services/studio/owner-route";

/**
 * Vercel Blob multipart uploads from the owner's browser (`uploadPresigned` with `multipart: true`).
 * The client sends the file id as its payload; the token only allows that file's key, type and size.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadPresignedBody;
  try {
    const res = await handleUploadPresigned({
      body,
      request: req,
      // The SDK refuses to run without a webhook key, but it only checks one on upload-completed
      // callbacks, which this route never asks for. A placeholder keeps it from throwing.
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || "unused",
      getSignedToken: async (pathname, clientPayload) => {
        const member = await ownerOrNull();
        if (!member) throw new Error("Sign in first.");
        const file = clientPayload ? await uploadingFile(member.orgId, clientPayload) : null;
        if (!file || file.originalKey !== pathname) throw new Error("That upload was not found. Start it again.");
        const validUntil = Date.now() + 60 * 60_000;
        const token = await issueSignedToken({ pathname, operations: ["put"], allowedContentTypes: [file.mime], maximumSizeInBytes: file.bytes, validUntil });
        return { token, urlOptions: { allowedContentTypes: [file.mime], maximumSizeInBytes: file.bytes, addRandomSuffix: false, allowOverwrite: true, validUntil } };
      },
    });
    return Response.json(res);
  } catch (e) {
    console.error("[upload sign]", e);
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
