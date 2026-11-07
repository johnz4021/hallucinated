"use client";

import Image from "next/image";
import { useState } from "react";

export default function Gallery({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <div className="gallery-main" />;
  return (
    <div className="gallery">
      <div className="gallery-main">
        <Image src={images[i]} alt={`${name}, image ${i + 1} of ${images.length}`} fill priority sizes="(max-width: 900px) 100vw, 55vw" />
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs" role="group" aria-label="Choose image">
          {images.map((src, n) => (
            <button key={src} type="button" aria-pressed={n === i} aria-label={`Image ${n + 1}`} onClick={() => setI(n)}>
              <Image src={src} alt="" fill sizes="96px" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
