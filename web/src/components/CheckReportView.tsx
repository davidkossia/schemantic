import type { CheckReport, Unit } from "../../../src/core/schema";
import { formatQuantity } from "../../../src/core/units";

export type CheckReportViewProps = { report: CheckReport; attempt: number };

function toUnit(unit: string): Unit {
  switch (unit) {
    case "ohm":
    case "V":
    case "A":
    case "W":
      return unit;
    default:
      return "";
  }
}

export function CheckReportView({ report, attempt }: CheckReportViewProps) {
  const title = report.verified ? "Check passed" : "Check failed";
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{attempt === 2 ? `${title}, attempt 2` : title}</h2>
      {report.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="pr-3">Name</th>
                <th scope="col" className="pr-3">Claimed</th>
                <th scope="col" className="pr-3">Measured</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item, i) => (
                <tr key={`${item.name}-${i}`}>
                  <td className="pr-3">{item.name}</td>
                  <td className="pr-3">{formatQuantity(item.claimed, toUnit(item.unit))}</td>
                  <td className="pr-3">{formatQuantity(item.measured, toUnit(item.unit))}</td>
                  <td>{item.ok ? "Pass" : "Fail"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {report.notes.length > 0 ? (
        <ul className="list-disc pl-6">
          {report.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : null}
      {report.residuals ? (
        <details>
          <summary className="cursor-pointer">Residuals</summary>
          <dl className="text-sm">
            <dt>KCL max</dt>
            <dd>{report.residuals.kclMax.toExponential(3)}</dd>
            <dt>Source max</dt>
            <dd>{report.residuals.sourceMax.toExponential(3)}</dd>
            <dt>Power balance</dt>
            <dd>{report.residuals.powerBalance.toExponential(3)}</dd>
          </dl>
        </details>
      ) : null}
    </section>
  );
}
