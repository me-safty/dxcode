import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://09574f0c4afde19df8e9d5d4c64c7de2@o4509446862274560.ingest.us.sentry.io/4511299398008832",
  environment: import.meta.env.MODE,

  sendDefaultPii: true,

  integrations: [
    Sentry.replayIntegration(),
    Sentry.browserTracingIntegration({
      shouldCreateSpanForRequest: (url) => !url.includes("/api/observability/"),
    }),
  ],

  tracesSampleRate: 1.0,
  tracePropagationTargets: ["localhost", /^\//],

  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,
});
