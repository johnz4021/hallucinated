"use client";

import { useState } from "react";

// Flat tee silhouette; the real print files sit where they were placed on the order
// (front: wordmark 10" wide, back: map ~11" wide on a ~20" body).
const FRONT = "M212 38 C238 92 362 92 388 38 L490 72 L590 196 L516 252 L478 214 L478 636 L122 636 L122 214 L84 252 L10 196 L110 72 Z";
const BACK = "M212 38 C246 58 354 58 388 38 L490 72 L590 196 L516 252 L478 214 L478 636 L122 636 L122 214 L84 252 L10 196 L110 72 Z";

export default function Tee() {
  const [side, setSide] = useState<"back" | "front">("back");
  return (
    <figure className="tee">
      <div className="tee-stage">
        <svg viewBox="0 0 600 650" role="img" aria-label={side === "back"
          ? "Back of the black tee: > git reset --hard above a line-art map of San Francisco"
          : "Front of the black tee: the Hallucinated wordmark across the chest"}>
          <g className={`tee-side ${side === "front" ? "is-on" : ""}`}>
            <path d={FRONT} className="tee-body" />
            <path d="M212 38 C238 92 362 92 388 38" className="tee-collar" />
            <image href="/wordmark.svg" x="210" y="150" width="180" height="29.5" preserveAspectRatio="xMidYMid meet" />
          </g>
          <g className={`tee-side ${side === "back" ? "is-on" : ""}`}>
            <path d={BACK} className="tee-body" />
            <path d="M212 38 C246 58 354 58 388 38" className="tee-collar" />
            <image href="/back-print.png" x="186" y="104" width="228" height="257" preserveAspectRatio="xMidYMid meet" />
          </g>
        </svg>
      </div>
      <figcaption className="tee-toggle" role="group" aria-label="Show side">
        <button type="button" aria-pressed={side === "front"} onClick={() => setSide("front")}>Front</button>
        <button type="button" aria-pressed={side === "back"} onClick={() => setSide("back")}>Back</button>
      </figcaption>
    </figure>
  );
}
