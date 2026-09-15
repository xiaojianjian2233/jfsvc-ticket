function withoutTrailingSlash(value: string): string {
  return value === "/" ? "" : value.replace(/\/$/, "");
}

/**
 * API calls live under the same deployment prefix as the SPA by default.
 * VITE_API_BASE remains available for deployments whose API uses another origin/path.
 */
export const API_BASE = withoutTrailingSlash(
  (import.meta.env.VITE_API_BASE as string | undefined) ?? import.meta.env.BASE_URL,
);

/** Build an application URL that works both at / and under a sub-path. */
export function appPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${withoutTrailingSlash(import.meta.env.BASE_URL)}${normalizedPath}`;
}
