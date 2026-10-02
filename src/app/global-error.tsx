"use client";

// Shown when the root layout itself fails, for example when the header cannot
// load. It replaces the whole document, so it carries its own minimal styles.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "4rem 1.5rem",
          fontFamily: '"Helvetica Neue", Arial, sans-serif',
          color: "#17201c",
          background: "#ffffff",
        }}
      >
        <title>Stockroom is not loading</title>
        <main style={{ maxWidth: "36rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Stockroom is not loading.</h1>
          <p style={{ color: "#55635c", lineHeight: 1.5 }}>
            The store could not reach its stock records. Nothing in your cart has changed. Try again, and if it keeps
            failing, come back in a few minutes.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "0.5rem",
              padding: "0.7rem 1.1rem",
              border: 0,
              borderRadius: "0.375rem",
              background: "#0e5a43",
              color: "#ffffff",
              font: "600 1rem inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
