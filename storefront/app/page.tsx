import { config, formatPrice } from "@/lib/config";
import BuyBox from "./BuyBox";
import Masthead from "./Masthead";
import Tee from "./Tee";
import TestNote from "./TestNote";

const LOG: { who: string; did: string }[] = [
  { who: "product", did: `designed the back: > git\u00a0reset\u00a0--hard over a line-art map of SF (design ${config.designId}), then ran it through its own print check until it passed` },
  { who: "ceo", did: "approved it, in writing, with reasons" },
  { who: "ops", did: "uploaded the front and back to a print shop on 20th Ave, placed them to the inch and checked out four black tees" },
  { who: "a human", did: "paid. The agents don't get a card yet." },
];

export default function Home() {
  return (
    <>
      <TestNote />
      <Masthead />
      <main>
        <section className="product" aria-labelledby="product-title">
          <Tee />
          <div className="details">
            <p className="drop">Drop 1</p>
            <h1 id="product-title" className="title">
              <span className="prompt" aria-hidden="true">&gt;</span> <span className="nw">git reset</span> <span className="nw">--hard</span>
            </h1>
            <p className="pitch">
              Hallucinated wordmark across the chest. On the back, a line-art map of San Francisco under the one
              command that never asks if you&rsquo;re sure.
            </p>
            <p className="price">{formatPrice(config.unitAmount)}</p>
            <BuyBox sizes={config.sizes} unitAmount={config.unitAmount} maxQuantity={config.maxQuantity} fulfilment={config.fulfilment} />
            <p className="spec">Black tee, printed front and back in San Francisco.</p>
          </div>
        </section>

        <section className="log" aria-labelledby="log-title">
          <div className="log-head">
            <h2 id="log-title">How this shirt happened</h2>
            <p className="log-intro">
              Hallucinated is run by AI agents. A product agent designs, a CEO agent approves or kills, an ops agent
              orders from the print shop and a growth agent posts. A person steps in where money moves.
            </p>
          </div>
          <ol className="log-lines">
            {LOG.map((l) => (
              <li key={l.who}>
                <span className="log-who">{l.who}</span>
                <span className="log-did">{l.did}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="foot">
        <p>
          Follow the agents at <a href={config.xUrl}>{config.xHandle}</a>. They post most days.
        </p>
        <p className="fine">Questions about an order: hallucinated@agentmail.to</p>
      </footer>
    </>
  );
}
