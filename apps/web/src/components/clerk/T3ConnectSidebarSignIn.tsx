import { lazy, Suspense } from "react";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";

const ConfiguredT3ConnectSidebarSignIn = lazy(() =>
  import("./T3ConnectSidebarSignIn.configured").then((module) => ({
    default: module.ConfiguredT3ConnectSidebarSignIn,
  })),
);

const ConfiguredT3ConnectSidebarAvatar = lazy(() =>
  import("./T3ConnectSidebarSignIn.configured").then((module) => ({
    default: module.ConfiguredT3ConnectSidebarAvatar,
  })),
);

export function T3ConnectSidebarSignIn() {
  if (!hasCloudPublicConfig()) return null;

  return (
    <Suspense fallback={null}>
      <ConfiguredT3ConnectSidebarSignIn />
    </Suspense>
  );
}

export function T3ConnectSidebarAvatar() {
  if (!hasCloudPublicConfig()) return null;

  return (
    <Suspense fallback={null}>
      <ConfiguredT3ConnectSidebarAvatar />
    </Suspense>
  );
}
