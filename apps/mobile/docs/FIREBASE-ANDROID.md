# Firebase / FCM — Android dev client

FCM push tokens require a **custom dev client** — not Expo Go.

## Package names by variant

| `APP_VARIANT` | Android package              |
| ------------- | ---------------------------- |
| `development` | `com.t3tools.t3code.dev`     |
| `preview`     | `com.t3tools.t3code.preview` |
| `production`  | `com.t3tools.t3code`         |

`app.config.ts` wires `android.googleServicesFile` per variant:

- Local default: `apps/mobile/secrets/google-services.<variant>.json`
- EAS / CI override: `GOOGLE_SERVICES_JSON` file secret (path injected at build time)

The `withAndroidGoogleServices` config plugin fails prebuild with a clear error when the file is missing.

## Human setup (before GATE-M0 / step s09)

1. Firebase Console → project for T3 Code mobile
2. Register the Android app for the variant package you are building (see table above)
3. Download `google-services.json`
4. Local dev client:

```bash
mkdir -p apps/mobile/secrets
cp ~/Downloads/google-services.json apps/mobile/secrets/google-services.development.json
cd apps/mobile
vp run android:dev
```

5. EAS dev / preview builds:

```bash
cd apps/mobile
eas secret:create --name GOOGLE_SERVICES_JSON --type file --value ./secrets/google-services.development.json
eas build --profile development -p android
```

Use a `google-services.json` whose `package_name` matches the profile's `APP_VARIANT` package. For preview builds, upload the preview Firebase app JSON to the same secret before `eas build --profile preview:dev`.

6. Install the APK on a physical device for push testing.

## Agent wiring (step s08)

- `app.config.ts` — `android.googleServicesFile` + `withAndroidGoogleServices` plugin
- `eas.json` — `development` and `preview:dev` profiles are the Android FCM rebuild targets
- Never commit `google-services.json` or `secrets/google-services.*.json`

## Verify

```bash
cd apps/mobile
vp test src/features/agent-awareness/remoteRegistration.test.ts
vp test src/features/agent-awareness/notificationPermissions.test.ts
```

After sign-in on device, registration should emit `token.type === "android"`.
