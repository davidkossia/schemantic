import { useState } from "react";
import type { Sample } from "../../../src/shared/protocol";

export type StartPanelProps = {
  samples: Sample[];
  mode: "live" | "replay" | null;
  busy: boolean;
  onStart(input: { file: File | null; sampleId: string | null; question: string }): void;
  onCancel(): void;
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_QUESTION = 1000;
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2";

export function StartPanel({ samples, mode, busy, onStart, onCancel }: StartPanelProps) {
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const canStart = (sampleId !== null || file !== null) && question.trim() !== "";

  function choose(sample: Sample) {
    setSampleId(sample.id);
    setFile(null);
    setFileError(null);
    setQuestion(sample.question.slice(0, MAX_QUESTION));
  }

  function submit() {
    if (!canStart || busy) return;
    if (file && file.size > MAX_BYTES) {
      setFileError("The image is larger than 5 MB.");
      return;
    }
    setFileError(null);
    onStart({ file, sampleId: file ? null : sampleId, question });
  }

  return (
    <section className="space-y-4">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {samples.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={sampleId === s.id && file === null}
              onClick={() => choose(s)}
              className={`flex w-full items-center gap-3 rounded border p-2 text-left disabled:opacity-50 aria-pressed:border-2 aria-pressed:border-blue-600 ${focus}`}
            >
              <img src={s.imageUrl} alt="" className="h-16 w-24 shrink-0 rounded object-contain" />
              <span className="min-w-0 break-words">{s.title}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="space-y-1">
        <label htmlFor="start-file" className="block font-medium">
          Image
        </label>
        <input
          id="start-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || mode === "replay"}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) setSampleId(null);
            setFileError(f && f.size > MAX_BYTES ? "The image is larger than 5 MB." : null);
          }}
          className={`block w-full max-w-full text-sm ${focus}`}
        />
        {mode === "replay" ? <p className="text-sm">Uploads need live mode.</p> : null}
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {fileError}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="start-question" className="block font-medium">
          Question
        </label>
        <textarea
          id="start-question"
          value={question}
          maxLength={MAX_QUESTION}
          rows={3}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
          className={`block w-full rounded border bg-transparent p-2 ${focus}`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !canStart}
          onClick={submit}
          className={`rounded border px-4 py-2 font-medium disabled:opacity-50 ${focus}`}
        >
          Read image
        </button>
        {busy ? (
          <>
            <span aria-live="polite">Reading the image</span>
            <button type="button" onClick={onCancel} className={`rounded border px-4 py-2 ${focus}`}>
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
