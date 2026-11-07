"use client";

import { useEffect, useRef } from "react";

// Muted inline loop. Plays only while on screen, and never on its own if the visitor prefers reduced motion.
export default function AdVideo({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.controls = true;
      return;
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.4 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <video ref={ref} className="ad-media" src={src} poster={poster} muted loop playsInline preload="metadata" aria-label={label} />
  );
}
