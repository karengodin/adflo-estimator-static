export async function POST(req: Request) {
  try {
    const body = await req.json();

    return Response.json({
      ok: true,
      received: body,
      note: "Replace this with the real Claude integration logic.",
    });
  } catch (error) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}