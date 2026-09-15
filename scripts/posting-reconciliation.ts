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

export function facebookPublicationConfirmed(result: { id?: string; published?: boolean; privacy?: { value?: string }; status?: { video_status?: string }; from?: { id?: string } }, videoId: string, pageId: string) {
  return result.id === videoId && result.from?.id === pageId && result.published === true
    && result.privacy?.value === 'EVERYONE' && result.status?.video_status === 'ready';
}

export async function reconcilePendingFacebookPosts() {
  const { decryptToken } = await import('../src/lib/socialTokenCrypto.ts');
  const posts = await prisma.scheduledPost.findMany({
    where: { status: 'PRIVATE_ONLY_UNVERIFIED', platform: 'FACEBOOK', externalPostId: { not: null } },
    select: { id: true, organizationId: true, socialAccountId: true, externalPostId: true },
    orderBy: { updatedAt: 'asc' }, take: 25,
  });
  for (const post of posts) {
    try {
      if (!post.socialAccountId || !post.organizationId) continue;
      const credential = await prisma.socialCredential.findFirst({where: {
        socialAccountId: post.socialAccountId, organizationId: post.organizationId,
        provider: 'META_FACEBOOK', status: 'CONNECTED',
      }});
      if (!credential) continue;
      const response = await fetch(`https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION?.trim() || 'v23.0'}/${encodeURIComponent(post.externalPostId!)}?fields=id,published,privacy,status,permalink_url,from`, {
        headers: { authorization: `Bearer ${decryptToken(credential.accessTokenCiphertext, credential)}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) continue;
      const result = await response.json();
      if (!facebookPublicationConfirmed(result, post.externalPostId!, credential.externalAccountId)) continue;
      const permalink = typeof result.permalink_url === 'string' ? new URL(result.permalink_url, 'https://www.facebook.com') : null;
      if (!permalink || permalink.protocol !== 'https:' || !['www.facebook.com', 'facebook.com'].includes(permalink.hostname)) continue;
      await prisma.scheduledPost.updateMany({where: {id: post.id, status: 'PRIVATE_ONLY_UNVERIFIED', externalPostId: post.externalPostId},
        data: {status: 'POSTED', workerStatus: 'SUCCEEDED', finalPrivacyStatus: 'public', publishedUrl: permalink.href, publishError: null}});
    } catch { /* Keep unresolved receipts protected from automatic re-upload. */ }
  }
}
