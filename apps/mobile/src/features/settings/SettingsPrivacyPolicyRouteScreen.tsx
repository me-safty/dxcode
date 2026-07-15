import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { PRIVACY_POLICY_URL } from "./lib/legal-document-url";

export function SettingsPrivacyPolicyRouteScreen() {
  return (
    <SettingsLegalDocumentRouteScreen
      documentName="Privacy Policy"
      documentUrl={PRIVACY_POLICY_URL}
    />
  );
}
