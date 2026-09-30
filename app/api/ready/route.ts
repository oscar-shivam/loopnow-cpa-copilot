import { NextResponse } from "next/server";

import { checkDatabaseConnection } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { status: "not_ready", checks: { database: "unconfigured" } },
      { status: 503 },
    );
  }

  try {
    await checkDatabaseConnection();
    return NextResponse.json({ status: "ready", checks: { database: "ok" } });
  } catch {
    return NextResponse.json(
      { status: "not_ready", checks: { database: "unavailable" } },
      { status: 503 },
    );
  }
}
