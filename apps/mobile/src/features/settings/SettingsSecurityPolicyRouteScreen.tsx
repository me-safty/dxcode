import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { SECURITY_POLICY_URL } from "./lib/legal-document-url";

export function SettingsSecurityPolicyRouteScreen() {
  return (
    <SettingsLegalDocumentRouteScreen
      documentName="Security Policy"
      documentUrl={SECURITY_POLICY_URL}
    />
  );
}
