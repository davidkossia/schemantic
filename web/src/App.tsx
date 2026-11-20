import { AnswerCard } from "./components/AnswerCard";
import { CheckReportView } from "./components/CheckReportView";
import { ModeBadge } from "./components/ModeBadge";
import { ReviewPanel } from "./components/ReviewPanel";
import { SolvePanel } from "./components/SolvePanel";
import { StartPanel } from "./components/StartPanel";
import { useSession } from "./useSession";

export function App() {
  const { state, start, approve, edit, reopen, cancel, dismissError } = useSession();
  const { phase } = state;

  const reports = state.reports.map((report, i) => (
    <CheckReportView key={i} report={report} attempt={Math.min(i + 1, 2)} />
  ));

  return (
    <div className="mx-auto max-w-6xl p-4 text-slate-900 dark:text-slate-100">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Schemantic</h1>
        <ModeBadge mode={state.mode} connected={state.connected} />
      </header>
      <div aria-live="polite">
        {state.error ? (
          <div role="alert" className="mb-4 flex items-start justify-between gap-2 rounded border border-red-400 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
            <span>{state.error.message}</span>
            <button type="button" onClick={dismissError} className="rounded px-2 underline focus-visible:outline-2 focus-visible:outline-offset-2">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
      <main className="space-y-4">
        {phase === "idle" || phase === "reading" ? (
          <StartPanel
            samples={state.samples}
            mode={state.mode}
            busy={phase === "reading"}
            onStart={(input) => void start(input)}
            onCancel={cancel}
          />
        ) : null}
        {phase === "awaiting_review" && state.structure ? (
          <ReviewPanel
            imageUrl={state.imageUrl}
            structure={state.structure}
            warnings={state.warnings}
            onEdit={edit}
            onApprove={approve}
            onCancel={cancel}
          />
        ) : null}
        {phase === "solving" || phase === "checking" || phase === "done" ? (
          <>
            <SolvePanel
              attempt={state.attempt}
              steps={state.steps}
              text={state.text}
              busy={phase !== "done"}
              onCancel={cancel}
            />
            {reports}
          </>
        ) : null}
        {phase === "done" && state.result ? (
          <AnswerCard result={state.result} onReopen={reopen} onNew={cancel} />
        ) : null}
      </main>
    </div>
  );
}
