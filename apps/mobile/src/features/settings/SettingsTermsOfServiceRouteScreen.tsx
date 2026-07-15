import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { TERMS_OF_SERVICE_URL } from "./lib/legal-document-url";

export function SettingsTermsOfServiceRouteScreen() {
  return (
    <SettingsLegalDocumentRouteScreen
      documentName="Terms of Service"
      documentUrl={TERMS_OF_SERVICE_URL}
    />
  );
}
