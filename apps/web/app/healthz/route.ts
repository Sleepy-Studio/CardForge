/** Liveness probe for the web container. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ service: "cardforge-web", status: "ok" });
}
