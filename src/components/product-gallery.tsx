"use client";

import Image from "next/image";
import { useState } from "react";

/** Main photo with thumbnails. Only the main photo loads with priority (SPEC.md 6.6). */
export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [selected, setSelected] = useState(0);
  const main = images[selected] ?? images[0];

  return (
    <div className="flex flex-col gap-3 md:flex-row-reverse">
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-shelf">
        {main ? (
          <Image
            key={main}
            src={main}
            alt={title}
            fill
            priority
            sizes="(min-width: 1024px) 560px, (min-width: 768px) 50vw, 100vw"
            className="object-contain p-6"
          />
        ) : null}
      </div>

      {images.length > 1 ? (
        <ul className="flex shrink-0 gap-2 md:w-16 md:flex-col" aria-label="Product photos">
          {images.map((image, i) => (
            <li key={image}>
              <button
                type="button"
                onClick={() => setSelected(i)}
                aria-label={`Show photo ${i + 1} of ${images.length}`}
                aria-pressed={i === selected}
                className={`relative block size-16 overflow-hidden rounded-md bg-shelf ${
                  i === selected ? "ring-2 ring-ink" : "ring-1 ring-line hover:ring-ink"
                }`}
              >
                <Image src={image} alt="" fill sizes="64px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
