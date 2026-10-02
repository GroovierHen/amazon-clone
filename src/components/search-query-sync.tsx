"use client";

import { useEffect } from "react";
import { SEARCH_INPUT_ID } from "./search-box";

/**
 * Puts the current query into the header search box while a results page is
 * showing, so a search can be edited rather than retyped, and clears it when
 * the visitor leaves. The header itself stays static and cacheable.
 */
export function SearchQuerySync({ q }: { q: string }) {
  useEffect(() => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (!(input instanceof HTMLInputElement)) return;
    input.value = q;
    return () => {
      input.value = "";
    };
  }, [q]);

  return null;
}
