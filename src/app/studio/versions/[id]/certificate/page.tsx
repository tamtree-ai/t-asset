import { notFound } from "next/navigation";

import { PrintButton } from "./PrintButton";
import { studioMember } from "@/lib/studio/member";
import { bytesLabel } from "@/lib/studio/format";
import { getBrand } from "@/services/studio/brand";
import { certificateData } from "@/services/studio/export";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval certificate" };

/** A printable record of who signed off which exact file, and when. Print it to PDF from the browser. */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await studioMember();
  const data = await certificateData(member.orgId, id);
  if (!data) notFound();
  const brand = await getBrand(member.orgId);
  const { version, file, decisions } = data;
  const approvals = decisions.filter((d) => d.decision === "approved");
  const backHref = `/studio/assets/${data.assetId}?option=${version.variationId}&v=${version.id}`;
  const when = (d: Date) => d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  return (
    <main className="mx-auto my-8 w-full max-w-[820px] bg-white p-10 text-[#18181b] shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none" style={{ colorScheme: "light" }}>
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <a href={backHref} className="text-[13px] text-[#6b6b73] hover:underline">
          ← Back to the asset
        </a>
        <PrintButton />
      </div>

      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6b6b73]">{brand.studioName}</p>
      <h1 className="mt-1 font-display text-[44px] leading-[1.05]">Approval certificate</h1>
      <p className="mt-3 text-[15px] text-[#3f3f46]">
        {approvals.length > 0 ? "This records the sign-off of the file described below." : "No one has signed this version off yet. This is the record so far."}
      </p>

      <dl className="mt-8 grid grid-cols-[150px_1fr] gap-x-6 gap-y-3 border-y border-[#e4e2dd] py-6 text-[14px]">
        <dt className="text-[#6b6b73]">Client</dt>
        <dd>{data.clientName}</dd>
        <dt className="text-[#6b6b73]">Project</dt>
        <dd>{data.project.name}</dd>
        <dt className="text-[#6b6b73]">Asset</dt>
        <dd>
          {data.asset} · {data.variation} · v{version.number}
        </dd>
        <dt className="text-[#6b6b73]">File</dt>
        <dd>
          {file.originalName} ({bytesLabel(file.bytes)}
          {file.width && file.height ? `, ${file.width}×${file.height}` : ""})
        </dd>
        <dt className="text-[#6b6b73]">SHA-256</dt>
        <dd className="break-all font-mono text-[12.5px]">{file.sha256}</dd>
        <dt className="text-[#6b6b73]">Status</dt>
        <dd>{version.status === "approved" ? "Approved" : version.status === "changes_requested" ? "Changes requested" : "In review"}</dd>
      </dl>

      <h2 className="mt-8 text-[17px] font-semibold">Decisions</h2>
      {decisions.length === 0 ? (
        <p className="mt-2 text-[14px] text-[#6b6b73]">None yet.</p>
      ) : (
        <table className="mt-3 w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#e4e2dd] text-[11px] uppercase tracking-[0.06em] text-[#6b6b73]">
              <th className="py-2 pr-3 font-semibold">Decision</th>
              <th className="py-2 pr-3 font-semibold">Signed by</th>
              <th className="py-2 pr-3 font-semibold">Email</th>
              <th className="py-2 pr-3 font-semibold">Time</th>
              <th className="py-2 font-semibold">From</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.id} className="break-inside-avoid border-b border-[#efede8] align-top">
                <td className="py-2.5 pr-3 font-medium">
                  {d.decision === "approved" ? "Approved" : "Changes requested"}
                  {d.note && <div className="mt-0.5 font-normal text-[#6b6b73]">“{d.note}”</div>}
                  {d.fileSha256 !== file.sha256 && <div className="mt-0.5 font-normal text-[#b42318]">The file’s fingerprint differs from the current file.</div>}
                </td>
                <td className="py-2.5 pr-3">{d.signedName}</td>
                <td className="py-2.5 pr-3">{d.email}</td>
                <td className="num py-2.5 pr-3">{when(d.createdAt)}</td>
                <td className="py-2.5 text-[12px] text-[#6b6b73]">
                  {d.ip ?? "unknown address"}
                  <div className="max-w-[200px] truncate" title={d.ua ?? ""}>
                    {d.ua}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-10 text-[12px] leading-relaxed text-[#6b6b73]">
        Each decision stores the typed name, the email, the time, the network address and the SHA-256 fingerprint of the exact file that was on screen. The record can’t be edited. Generated {when(new Date())}.
      </p>
    </main>
  );
}
