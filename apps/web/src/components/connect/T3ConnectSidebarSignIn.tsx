import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import {
  ConfiguredT3ConnectSidebarAvatar,
  ConfiguredT3ConnectSidebarSignIn,
} from "./T3ConnectSidebarSignIn.configured";

export function T3ConnectSidebarSignIn() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredT3ConnectSidebarSignIn />;
}

export function T3ConnectSidebarAvatar() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredT3ConnectSidebarAvatar />;
}
