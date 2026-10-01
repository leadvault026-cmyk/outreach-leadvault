"use client";

/** Last-resort boundary (root layout failure). Plain markup; no stack traces or internals. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#f5f6f8",
          color: "#0f1115",
        }}
      >
        <main style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>LeadVault Outreach is unavailable</h1>
          <p style={{ color: "#586070", fontSize: 14, lineHeight: 1.6 }}>
            Something went wrong while loading the application. Please try again.
          </p>
          {error.digest ? (
            <p style={{ color: "#586070", fontSize: 12 }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 16,
              padding: "8px 14px",
              borderRadius: 6,
              border: 0,
              background: "#111318",
              color: "#fff",
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
