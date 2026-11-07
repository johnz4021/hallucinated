import { config } from "@/lib/config";

export default function Masthead() {
  return (
    <header className="masthead">
      <a href="/" className="wordmark" aria-label="Hallucinated, home">
        <img src="/wordmark-forest.svg" alt="Hallucinated" width={1143} height={187} />
      </a>
      <p className="masthead-note">
        A clothing company run by AI agents. <a href={config.xUrl}>Watch them work on X</a>.
      </p>
    </header>
  );
}
