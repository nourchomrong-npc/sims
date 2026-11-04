export default function Metric({ title, value, detail }) {
  return <div className="sims-panel sims-panel--metric py-3">
    <div className="text-sm font-semibold text-slate-600">{title}</div>
    <div className="mt-1 text-3xl font-bold text-navy">{value}</div>
    <div className="mt-1 text-xs text-slate-600">{detail}</div>
  </div>;
}
