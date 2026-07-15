import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { resolveLegalDocumentUrl } from "./lib/legal-document-url";

const PRIVACY_POLICY_URL = resolveLegalDocumentUrl(
  "https://t3.codes/privacy-policy",
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
);

export function SettingsPrivacyPolicyRouteScreen() {
  return (
    <SettingsLegalDocumentRouteScreen
      documentName="Privacy Policy"
      documentUrl={PRIVACY_POLICY_URL}
    />
  );
}
