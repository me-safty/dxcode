import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { resolveLegalDocumentUrl } from "./lib/legal-document-url";

const SECURITY_POLICY_URL = resolveLegalDocumentUrl(
  "https://t3.codes/security-policy",
  process.env.EXPO_PUBLIC_SECURITY_POLICY_URL,
);

export function SettingsSecurityPolicyRouteScreen() {
  return (
    <SettingsLegalDocumentRouteScreen
      documentName="Security Policy"
      documentUrl={SECURITY_POLICY_URL}
    />
  );
}
