import { cookies } from "next/headers";

/**
 * There are no accounts. A visitor is a random id in an httpOnly cookie,
 * created the first time something is added to a cart (SPEC.md 6.3).
 */
const VISITOR_COOKIE = "visitor_id";
const ONE_YEAR = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The visitor's id, or null when they have never added anything to a cart. */
export async function getVisitorId(): Promise<string | null> {
  const value = (await cookies()).get(VISITOR_COOKIE)?.value;
  return value && UUID.test(value) ? value : null;
}

/** Returns the visitor's id, setting the cookie first if needed. Server Actions only. */
export async function ensureVisitorId(): Promise<string> {
  const existing = await getVisitorId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  (await cookies()).set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return id;
}
