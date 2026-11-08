"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Banner } from "@/lib/content-schema";

export default function Hero({ banners }: { banners: Banner[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => {
    if (banners.length < 2 || paused || reduced.current) return;
    const t = setTimeout(() => setI((n) => (n + 1) % banners.length), 7000);
    return () => clearTimeout(t);
  }, [i, paused, banners.length]);
  if (!banners.length) return null;

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Campaigns"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {banners.map((b, n) => (
        <div
          key={b.id}
          className={`hero-slide focus-${b.focus ?? "right"} fit-${b.fit ?? "cover"} ${n === i ? "is-on" : ""}`}
          aria-roledescription="slide"
          aria-label={`${n + 1} of ${banners.length}`}
          aria-hidden={n !== i}
        >
          <div className="hero-img">
            <Image src={b.image} alt={b.image_alt} fill priority={n === 0} sizes={b.fit === "contain" ? "(max-width: 700px) 100vw, 60vw" : "100vw"} />
          </div>
          <div className="hero-copy">
            {b.kicker && <p className="hero-kicker">{b.kicker}</p>}
            <h2 className={`hero-title${b.title.length > 40 ? " long" : ""}`}>
              {b.title.split(" ").map((w, k) => (
                <span key={k}>{k > 0 && " "}{w.includes("-") ? <span className="nw">{w}</span> : w}</span>
              ))}
            </h2>
            {b.subtitle && <p className="hero-sub">{b.subtitle}</p>}
            {b.cta_href && (
              <Link href={b.cta_href} className="btn" tabIndex={n === i ? 0 : -1}>
                {b.cta_label ?? "Shop now"}
              </Link>
            )}
          </div>
        </div>
      ))}
      {banners.length > 1 && (
        <div className="hero-dots">
          {banners.map((b, n) => (
            <button key={b.id} type="button" aria-label={`Show campaign ${n + 1}: ${b.title}`} aria-pressed={n === i} onClick={() => setI(n)} />
          ))}
        </div>
      )}
    </section>
  );
}
