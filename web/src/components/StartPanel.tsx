import type { Sample } from "../../../src/shared/protocol";

export type StartPanelProps = {
  samples: Sample[];
  mode: "live" | "replay" | null;
  busy: boolean;
  onStart(input: { file: File | null; sampleId: string | null; question: string }): void;
  onCancel(): void;
};

export function StartPanel({ busy, onCancel }: StartPanelProps) {
  return (
    <section>
      <p>StartPanel</p>
      {busy ? (
        <>
          <p aria-live="polite">Reading the image</p>
          <button type="button" onClick={onCancel}>Cancel</button>
        </>
      ) : null}
    </section>
  );
}
