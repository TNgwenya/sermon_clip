import {beforeEach, expect, it, vi} from "vitest";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),find:vi.fn(),credentials:vi.fn(),audit:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/server/auth/requestAuthorization",()=>({requireRequestCapability:mocks.authorize}));
vi.mock("@/server/liveIntake/service",()=>({provisionLiveIntake:vi.fn()}));
vi.mock("@/server/liveIntake/cloudflareStream",()=>({getCloudflareLiveInputCredentials:mocks.credentials}));
vi.mock("@/lib/prisma",()=>({prisma:{liveIntake:{findFirst:mocks.find},auditEvent:{create:mocks.audit}}}));
import {revealLiveIntakeAction} from "./actions";
beforeEach(()=>{vi.resetAllMocks();mocks.authorize.mockResolvedValue({organizationId:"church-a",campusId:"campus-a",actorId:"admin-a"});mocks.find.mockResolvedValue({id:"intake-a",providerInputId:"provider-a"});mocks.credentials.mockResolvedValue({ingestUrl:"rtmps://fixture",streamKey:"fixture-key"});mocks.audit.mockResolvedValue({});});
it("authorizes and scopes credential retrieval, auditing without the key",async()=>{
  expect((await revealLiveIntakeAction()).success).toBe(true);
  expect(mocks.authorize).toHaveBeenCalledWith("channels.manage");
  expect(mocks.find).toHaveBeenCalledWith({where:{organizationId:"church-a",campusId:"campus-a",status:"READY",provider:"CLOUDFLARE_STREAM"}});
  expect(mocks.credentials).toHaveBeenCalledWith("provider-a");
  expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("fixture-key");
});
it("never requests provider credentials after authorization fails",async()=>{mocks.authorize.mockRejectedValue(new Error("denied"));expect((await revealLiveIntakeAction()).success).toBe(false);expect(mocks.find).not.toHaveBeenCalled();expect(mocks.credentials).not.toHaveBeenCalled();});
it("never accepts a provider input supplied by another church",async()=>{mocks.find.mockResolvedValue(null);expect((await revealLiveIntakeAction()).success).toBe(false);expect(mocks.credentials).not.toHaveBeenCalled();});
