import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: "https://d9e62d21f585aa2c60b50e5f4023e07d@o4509446862274560.ingest.us.sentry.io/4511294368972800",

  // Verbose SDK logs — prints every event/span dispatched and any transport
  // errors. Useful for confirming spans are being created and flushed. Remove
  // once gen_ai instrumentation is verified.
  debug: true,

  sendDefaultPii: true,
  includeLocalVariables: true,

  integrations: [nodeProfilingIntegration()],

  // Performance Monitoring.
  // NODE_ENV isn't reliably passed through turbo to workspace dev scripts
  // (it's not in turbo.json's globalEnv), so the previous
  // `NODE_ENV === "development" ? 1.0 : 0.1` conditional silently fell to 0.1
  // and dropped ~90% of spans. Hardcoding 1.0 matches the local-only DSN
  // setup in this file. Tighten if/when this app ships beyond local dev.
  tracesSampleRate: 1.0,

  // Profiling
  profileSessionSampleRate: 1.0,
  profileLifecycle: "trace",

  // Logging
  enableLogs: true,
});
