export const T3WORK_PATH_PREFIX = "/t3work/projects/";
export const T3WORK_THREADS_SEGMENT = "/threads/";

export function parseActiveThreadFromPath(pathname: string): {
  projectId: string;
  threadId: string;
} | null {
  if (!pathname.startsWith(T3WORK_PATH_PREFIX)) {
    return null;
  }

  const suffix = pathname.slice(T3WORK_PATH_PREFIX.length);
  const splitAt = suffix.indexOf("/");
  if (splitAt <= 0) {
    return null;
  }

  const projectId = decodeURIComponent(suffix.slice(0, splitAt));
  const remainder = suffix.slice(splitAt);
  if (!remainder.startsWith(T3WORK_THREADS_SEGMENT)) {
    return null;
  }

  const encodedThreadId = remainder.slice(T3WORK_THREADS_SEGMENT.length);
  if (!encodedThreadId) {
    return null;
  }

  return {
    projectId,
    threadId: decodeURIComponent(encodedThreadId),
  };
}
