export function shouldBlockBackNavigationAction(action: string): boolean {
  return action === "BACK";
}
