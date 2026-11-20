import type { UiState } from "../state";

export type AnswerCardProps = {
  result: NonNullable<UiState["result"]>;
  onReopen(): void;
  onNew(): void;
};

export function AnswerCard(_props: AnswerCardProps) {
  return <section>AnswerCard</section>;
}
