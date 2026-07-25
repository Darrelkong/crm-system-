export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Lightweight server clock for watermark calibration.
 * Returns Date.now() only — no database or session lookups.
 */
export async function GET() {
  return Response.json(
    { now: Date.now() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "CDN-Cache-Control": "no-store",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
