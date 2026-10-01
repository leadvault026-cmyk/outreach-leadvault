import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { withUserContext } from "@/db/client";
import { profiles } from "@/db/schema";
import { requireUser } from "./auth";

export const getMyProfile = cache(async () => {
  const user = await requireUser();
  const rows = await withUserContext(user.userId, (tx) =>
    tx
      .select({
        fullName: profiles.fullName,
        isPlatformAdmin: profiles.isPlatformAdmin,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.userId, user.userId))
      .limit(1),
  );
  return {
    ...user,
    fullName: rows[0]?.fullName ?? null,
    createdAt: rows[0]?.createdAt ?? null,
    isPlatformAdmin: rows[0]?.isPlatformAdmin ?? false,
  };
});
