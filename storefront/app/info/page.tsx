import type { Metadata } from "next";
import SizeGuide from "@/components/SizeGuide";
import { config, sentence } from "@/lib/config";

export const metadata: Metadata = { title: "Info and FAQ" };

export default function Info() {
  return (
    <div className="wrap page info">
      <header className="page-head"><h1>Info</h1></header>

      <section id="agents" className="info-block">
        <h2>Run by AI agents</h2>
        <p>
          Hallucinated is a clothing label run by AI agents. A product agent designs each piece and checks its own print files. A CEO agent
          approves or rejects them, with reasons. An ops agent orders from a print shop in San Francisco, and a growth agent posts on{" "}
          <a href={config.xUrl}>X as {config.xHandle}</a>. A person approves anything that spends money, and pays.
        </p>
      </section>

      <section id="pickup" className="info-block">
        <h2>Pickup and shipping</h2>
        <p>{sentence(config.fulfilment)} We don&rsquo;t ship yet. The pickup email has the address and times.</p>
      </section>

      <section id="preorders" className="info-block">
        <h2>How pre-orders work</h2>
        <details open>
          <summary>When am I charged?</summary>
          <p>When the drop launches. At checkout you save a card; nothing is charged then. The price and the estimated launch month are on each product.</p>
        </details>
        <details>
          <summary>What if it never launches?</summary>
          <p>Then you&rsquo;re never charged. We only charge for pieces we actually make.</p>
        </details>
        <details>
          <summary>Can I cancel?</summary>
          <p>Yes, any time before launch. Email {config.contactEmail} from the address you used at checkout.</p>
        </details>
        <details>
          <summary>Why can&rsquo;t I check out pre-orders with in-stock items?</summary>
          <p>In-stock items are paid now and pre-orders are paid at launch, so they go through separate checkouts. Check out one bag, then the other.</p>
        </details>
      </section>

      <section className="info-block">
        <h2>Sizing</h2>
        <SizeGuide open />
      </section>

      <section id="imagery" className="info-block">
        <h2>About our imagery</h2>
        <p>
          Campaign, lookbook and pre-order product images are AI-generated, and the people in them aren&rsquo;t real. Flat product images of drop 1
          are made from the actual print files. The shirts are real.
        </p>
      </section>

      <section id="contact" className="info-block">
        <h2>Contact</h2>
        <p>
          Email <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>. An agent reads it first; anything about money goes to a human.
        </p>
      </section>
    </div>
  );
}
