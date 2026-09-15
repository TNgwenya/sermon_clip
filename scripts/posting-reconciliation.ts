import { PrismaClient } from "@prisma/client";
import { getZernioPost, resolveZernioOutcome } from "../src/server/integrations/zernioClient.ts";

const prisma = new PrismaClient();
export async function reconcilePendingZernioPosts() {
  if (!process.env.ZERNIO_API_KEY?.trim()) return;
  const posts = await prisma.scheduledPost.findMany({
    where: { status: "PRIVATE_ONLY_UNVERIFIED", externalPostId: { not: null },
      socialAccount: { externalProvider: "zernio" }, platform: { in: ["TIKTOK", "INSTAGRAM"] } },
    select: { id: true, externalPostId: true, platform: true, socialAccount: { select: { externalAccountId: true } } },
    orderBy: { updatedAt: "asc" }, take: 25,
  });
  for (const post of posts) {
    try {
      const remote = await getZernioPost(post.externalPostId!);
      if (!remote || remote._id !== post.externalPostId) continue;
      const platform = post.platform === "TIKTOK" ? "tiktok" : "instagram";
      const target = remote.platforms?.find(item => item.platform === platform);
      const account = typeof target?.accountId === "string" ? target.accountId
        : (target?.accountId as { _id?: string } | undefined)?._id;
      if (!account || account !== post.socialAccount?.externalAccountId) continue;
      const result = resolveZernioOutcome(remote, platform);
      await prisma.scheduledPost.updateMany({
        where: { id: post.id, status: "PRIVATE_ONLY_UNVERIFIED", externalPostId: post.externalPostId },
        data: { status: result.status, workerStatus: result.status === "FAILED" ? "FAILED" : "SUCCEEDED",
          finalPrivacyStatus: result.finalPrivacyStatus, publishedUrl: result.publishedUrl ?? null,
          publishError: result.publishError ?? null },
      });
    } catch { /* Keep the accepted receipt intact; retry this read during the next sync. */ }
  }
}
