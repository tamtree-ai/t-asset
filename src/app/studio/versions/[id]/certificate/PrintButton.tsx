"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="h-9 rounded-lg bg-[#18181b] px-4 text-[13px] font-semibold text-white">
      Print or save as PDF
    </button>
  );
}
