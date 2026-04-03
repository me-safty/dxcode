export function shouldReloadForServerInstanceChange(
  currentServerInstanceId: string | null,
  nextServerInstanceId: string,
): boolean {
  return currentServerInstanceId !== null && currentServerInstanceId !== nextServerInstanceId;
}
