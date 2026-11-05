export function configuredFrontendOrigin(): string {
  const raw = process.env["FRONTEND_URL"] ?? "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function allowedFrontendOrigin(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin === configuredFrontendOrigin()) return url.origin;
  if (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return url.origin;
  }
  if (
    url.protocol === "https:" &&
    (url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app"))
  ) {
    return url.origin;
  }
  return null;
}
