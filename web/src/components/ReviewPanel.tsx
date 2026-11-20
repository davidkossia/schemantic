import type { Structure, Warning } from "../../../src/core/schema";

export type ReviewPanelProps = {
  imageUrl: string | null;
  structure: Structure;
  warnings: Warning[];
  onEdit(s: Structure): void;
  onApprove(): void;
  onCancel(): void;
};

export function ReviewPanel(_props: ReviewPanelProps) {
  return <section>ReviewPanel</section>;
}
