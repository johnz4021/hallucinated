import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap page note-page">
      <h1 className="mono-title"><span className="prompt" aria-hidden="true">&gt;</span> 404: pathspec did not match</h1>
      <p className="note-lead">That page doesn&rsquo;t exist. Maybe it never did.</p>
      <p><Link href="/shop" className="section-link">Shop everything</Link></p>
    </div>
  );
}
