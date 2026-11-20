import type { CheckReport } from "../../../src/core/schema";

export type CheckReportViewProps = { report: CheckReport; attempt: number };

export function CheckReportView(_props: CheckReportViewProps) {
  return <section>CheckReportView</section>;
}
