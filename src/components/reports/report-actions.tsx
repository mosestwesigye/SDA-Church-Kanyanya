"use client";

import { useState } from "react";
import { PrivacyNotice } from "@/components/members/directory-client";
import { Dialog } from "@/components/ui/dialog";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      Print
    </button>
  );
}

/** Download as PDF or Excel after acknowledging the privacy notice (logged on the server). */
export function DownloadReport({ reportKey, search, title }: { reportKey: string; search: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf");
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Download
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={`Download ${title}`}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
            <form method="post" action={`/api/reports/${reportKey}${search}`} onSubmit={() => setTimeout(close, 300)}>
              <input type="hidden" name="format" value={format} />
              <input type="hidden" name="ack" value="1" />
              <button className="btn btn-primary">I understand — download</button>
            </form>
          </>
        }
      >
        <PrivacyNotice />
        <fieldset className="mt-4">
          <legend className="field-label">Format</legend>
          <div className="flex gap-4">
            {(["pdf", "xlsx"] as const).map((f) => (
              <label key={f} className="flex min-h-[44px] items-center gap-2">
                <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} /> {f === "pdf" ? "PDF" : "Excel (.xlsx)"}
              </label>
            ))}
          </div>
        </fieldset>
      </Dialog>
    </>
  );
}
