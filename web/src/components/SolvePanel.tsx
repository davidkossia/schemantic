import type { UiState } from "../state";

export type SolvePanelProps = {
  attempt: 1 | 2 | null;
  steps: UiState["steps"];
  text: string;
  busy: boolean;
  onCancel(): void;
};

export function SolvePanel(_props: SolvePanelProps) {
  return <section>SolvePanel</section>;
}
