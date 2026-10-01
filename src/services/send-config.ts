/**
 * Email transport configuration, shared by the web app and the worker (architecture §25).
 *
 *   EMAIL_TRANSPORT              fake (default) | live
 *   SENDING_ENABLED              kill switch; "false" stops the worker from sending anything
 *   UNSUBSCRIBE_SIGNING_SECRET   HMAC key for unsubscribe links (≥ 32 characters)
 *   UNSUBSCRIBE_BASE_URL         public base URL for unsubscribe links (defaults to APP_BASE_URL)
 *
 * "fake" never contacts anyone: messages are recorded as sent by the in-process fake provider.
 * "live" needs a real provider adapter, and none is registered in this build, so live sending
 * stays disabled until a provider is purchased and connected (a separate, controlled step).
 */
export type SendConfig = {
  transport: "fake" | "live";
  sendingEnabled: boolean;
  appEnv: string;
  unsubscribeSecret: string | undefined;
  unsubscribeBaseUrl: string;
};

export function sendConfig(env: NodeJS.ProcessEnv = process.env): SendConfig {
  const transport = env.EMAIL_TRANSPORT === "live" ? "live" : "fake";
  return {
    transport,
    sendingEnabled: env.SENDING_ENABLED !== "false",
    appEnv: env.APP_ENV ?? "local",
    unsubscribeSecret: env.UNSUBSCRIBE_SIGNING_SECRET,
    unsubscribeBaseUrl: (
      env.UNSUBSCRIBE_BASE_URL ||
      env.APP_BASE_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, ""),
  };
}

/** Simulated replies/bounces exist only with the fake transport outside production. */
export function simulationAllowed(cfg: SendConfig = sendConfig()): boolean {
  return cfg.transport === "fake" && cfg.appEnv !== "production";
}
