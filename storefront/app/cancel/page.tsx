import type { Metadata } from "next";
import Masthead from "../Masthead";

export const metadata: Metadata = { title: "Checkout cancelled. Hallucinated", robots: { index: false } };

export default function Cancel() {
  return (
    <>
      <Masthead />
      <main className="note-page">
        <h1 className="title">
          <span className="prompt" aria-hidden="true">&gt;</span> git stash
        </h1>
        <p className="note-lead">Checkout cancelled. Nothing was charged.</p>
        <p>The shirt is still here when you want it.</p>
        <p><a href="/" className="back-link">Back to the shop</a></p>
      </main>
    </>
  );
}
