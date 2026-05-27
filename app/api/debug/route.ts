export async function GET() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "NOT SET";
  return Response.json({
    key_prefix: key.substring(0, 10),
    key_length: key.length,
  });
}
