/** Fail fast at server boot if required configuration is missing or malformed. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("@/env/server");
    serverEnv();
  }
}
