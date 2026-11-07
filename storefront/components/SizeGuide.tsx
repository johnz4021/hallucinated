// Approximate garment measurements for a standard unisex tee, laid flat. Confirm against the blank before going live.
const ROWS = [
  ["S", "18–19", "28"],
  ["M", "20–21", "29"],
  ["L", "22–23", "30"],
  ["XL", "24–25", "31"],
];

export default function SizeGuide({ open = false }: { open?: boolean }) {
  return (
    <details id="size-guide" open={open}>
      <summary>Size guide</summary>
      <table className="size-table">
        <caption>Tee, measured flat, in inches (approximate)</caption>
        <thead>
          <tr><th scope="col">Size</th><th scope="col">Chest width</th><th scope="col">Length</th></tr>
        </thead>
        <tbody>
          {ROWS.map(([s, c, l]) => (
            <tr key={s}><th scope="row">{s}</th><td>{c}</td><td>{l}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="fine">Regular fit. Between sizes, size up. Questions: hallucinated@agentmail.to.</p>
    </details>
  );
}
