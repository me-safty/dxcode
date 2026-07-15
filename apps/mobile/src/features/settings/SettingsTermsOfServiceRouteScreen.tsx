import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { resolveLegalDocumentUrl } from "./lib/legal-document-url";

const TERMS_OF_SERVICE_URL = resolveLegalDocumentUrl(
  "https://t3.codes/terms-of-service",
  process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL,
);

export function SettingsTermsOfServiceRouteScreen() {
  return (
    <SettingsLegalDocumentRouteScreen
      documentName="Terms of Service"
      documentUrl={TERMS_OF_SERVICE_URL}
    />
  );
}
