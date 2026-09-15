import { describe, it, expect, vi, beforeEach } from 'vitest';
const findMany = vi.hoisted(()=>vi.fn());
const updateMany = vi.hoisted(()=>vi.fn());
vi.mock('@prisma/client',()=>({PrismaClient:class {scheduledPost={findMany,updateMany}}}));
import { reconcilePendingZernioPosts } from '../posting-reconciliation';
import { resolveZernioOutcome } from '../../src/server/integrations/zernioClient';
import { encryptToken, decryptToken } from '../../src/lib/socialTokenCrypto';
beforeEach(()=>{vi.restoreAllMocks();findMany.mockReset();updateMany.mockReset();vi.stubEnv('ZERNIO_API_KEY','test');vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY','test');});
describe('publishing recovery',()=>{
 it('reads tenant-bound v2 and legacy v1 tokens and rejects swapped tenant context',()=>{
 const c={organizationId:'church-1',provider:'META_FACEBOOK' as const,externalAccountId:'page-1'};
 expect(decryptToken(encryptToken('secret',c),c)).toBe('secret');
 expect(decryptToken(encryptToken('legacy'),c)).toBe('legacy');
 expect(()=>decryptToken(encryptToken('secret',c),{...c,organizationId:'church-2'})).toThrow();
 });
 it('reports platform failures accurately with the actionable error',()=>{
 expect(resolveZernioOutcome({_id:'p',platforms:[{platform:'tiktok',status:'failed',errorMessage:'Capacity exhausted'}]},'tiktok')).toMatchObject({status:'FAILED',publishError:'Capacity exhausted'});
 });
 it('does not call a processing receipt posted',()=>{
 expect(resolveZernioOutcome({_id:'p',status:'processing'},'instagram').status).toBe('PRIVATE_ONLY_UNVERIFIED');
 });
 it('reconciles an accepted upload without submitting another post',async()=>{
 findMany.mockResolvedValue([{id:'local',externalPostId:'remote',platform:'INSTAGRAM',socialAccount:{externalAccountId:'account'}}]);
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({post:{_id:'remote',platforms:[{platform:'instagram',accountId:{_id:'account'},status:'published',platformPostUrl:'https://www.instagram.com/reel/test/'}]}})));
 await reconcilePendingZernioPosts();
 expect(fetchMock).toHaveBeenCalledTimes(1);
 expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
 expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'local',status:'PRIVATE_ONLY_UNVERIFIED',externalPostId:'remote'},data:expect.objectContaining({status:'POSTED',publishError:null})}));
 });
 it('rejects a provider receipt for a different connected account',async()=>{
 findMany.mockResolvedValue([{id:'local',externalPostId:'remote',platform:'INSTAGRAM',socialAccount:{externalAccountId:'account'}}]);
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({post:{_id:'remote',platforms:[{platform:'instagram',accountId:'other',status:'published',platformPostUrl:'https://www.instagram.com/reel/test/'}]}})));
 await reconcilePendingZernioPosts();expect(updateMany).not.toHaveBeenCalled();
 });
});
