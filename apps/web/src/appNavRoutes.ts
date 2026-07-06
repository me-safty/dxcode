export function isChatSurfacePathname(pathname: string): boolean {
  return (
    pathname === "/chat" ||
    pathname.startsWith("/draft/") ||
    (!pathname.startsWith("/settings") && /^\/[^/]+\/[^/]+/u.test(pathname))
  );
}

export function isEmailSurfacePathname(pathname: string): boolean {
  return pathname === "/email" || pathname.startsWith("/email/");
}

export function shouldShowSecondarySidebar(pathname: string): boolean {
  return (
    pathname.startsWith("/settings") ||
    isChatSurfacePathname(pathname) ||
    isEmailSurfacePathname(pathname)
  );
}
