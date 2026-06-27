import type {
  ContentOpportunityCategory,
  ContentOpportunityType,
  MinistryMomentType,
  Prisma,
  ScriptureUsageType,
  SermonStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

const PROCESSED_SERMON_STATUSES: SermonStatus[] = [
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "REVIEWING",
  "EXPORTING",
  "EXPORTED",
];

export type KnowledgeBaseFilters = {
  query?: string;
  churchName?: string;
  preacher?: string;
  sermonDate?: string;
  scripture?: string;
  bibleBook?: string;
  scriptureUsageType?: ScriptureUsageType;
  primaryScriptureOnly?: boolean;
  topics?: string[];
  ministryMomentType?: MinistryMomentType;
  clipCategory?: string;
  contentCategory?: ContentOpportunityCategory;
  contentType?: ContentOpportunityType;
};

export type KnowledgeBaseResult = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  sermonDate: string | null;
  centralTheme: string | null;
  summary: string | null;
  primaryScripture: string | null;
  scriptures: string[];
  topTopics: string[];
  ministryMoments: string[];
  clipCount: number;
  approvedClipCount: number;
  contentOpportunityCount: number;
  approvedContentOpportunityCount: number;
  clipLinks: Array<{ id: string; title: string; category: string | null }>;
  contentLinks: Array<{ id: string; title: string; category: string; type: string }>;
};

export type DashboardDistributionItem = {
  label: string;
  count: number;
};

export type IntelligenceDashboardData = {
  totals: {
    sermonsProcessed: number;
    sermonsWithIntelligence: number;
    ministryMomentsDetected: number;
    clipsSuggested: number;
    clipsApproved: number;
    clipsRendered: number;
    contentOpportunitiesGenerated: number;
    contentOpportunitiesApproved: number;
    contentOpportunitiesUsed: number;
  };
  pastorLearning: {
    mostPreachedTopics: DashboardDistributionItem[];
    mostUsedScriptures: DashboardDistributionItem[];
    mostReferencedBooks: DashboardDistributionItem[];
    recurringThemes: DashboardDistributionItem[];
    recurringMinistryMoments: DashboardDistributionItem[];
    commonClipCategories: DashboardDistributionItem[];
    sermonsPerMonth: DashboardDistributionItem[];
    averageContentOpportunitiesPerSermon: number;
    sermonsWithNoGeneratedClips: number;
    sermonsWithNoApprovedContent: number;
  };
  churchLearning: {
    contentCategoriesProduced: DashboardDistributionItem[];
    scriptureUsageDistribution: DashboardDistributionItem[];
    topicDistribution: DashboardDistributionItem[];
    clipCategoryDistribution: DashboardDistributionItem[];
    ministryMomentTrend: DashboardDistributionItem[];
    approvedVsGeneratedClips: { approved: number; generated: number };
    approvedVsGeneratedContent: { approved: number; generated: number };
  };
  recentActivity: Array<{
    sermonId: string;
    title: string;
    updatedAt: string;
    centralTheme: string | null;
    clipCount: number;
    opportunityCount: number;
  }>;
};

export type RelatedSermon = {
  id: string;
  title: string;
  speakerName: string;
  sermonDate: string | null;
  overlapTopics: string[];
  overlapScriptures: string[];
  score: number;
};

export type KnowledgeBaseScopeAvailability = {
  sermonsProcessed: number;
  sermonsWithIntelligence: number;
};

type SimpleSermonSignal = {
  id: string;
  title: string;
  speakerName: string;
  sermonDate: Date | null;
  topics: string[];
  scriptures: string[];
};

function parseDateRange(dateValue?: string): { gte: Date; lt: Date } | null {
  if (!dateValue) {
    return null;
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const gte = new Date(parsed);
  gte.setHours(0, 0, 0, 0);
  const lt = new Date(gte);
  lt.setDate(lt.getDate() + 1);
  return { gte, lt };
}

export function buildKnowledgeBaseWhere(filters: KnowledgeBaseFilters): Prisma.SermonWhereInput {
  const trimmedQuery = filters.query?.trim();
  const trimmedChurch = filters.churchName?.trim();
  const trimmedPreacher = filters.preacher?.trim();
  const trimmedScripture = filters.scripture?.trim();
  const trimmedBook = filters.bibleBook?.trim();
  const trimmedClipCategory = filters.clipCategory?.trim();
  const dateRange = parseDateRange(filters.sermonDate);

  return {
    status: { in: PROCESSED_SERMON_STATUSES },
    AND: [
      trimmedQuery
        ? {
            OR: [
              { title: { contains: trimmedQuery } },
              { speakerName: { contains: trimmedQuery } },
              { intelligence: { generatedTitle: { contains: trimmedQuery } } },
              { intelligence: { summary: { contains: trimmedQuery } } },
              { intelligence: { centralTheme: { contains: trimmedQuery } } },
            ],
          }
        : {},
      trimmedChurch ? { churchName: { contains: trimmedChurch } } : {},
      trimmedPreacher ? { speakerName: { contains: trimmedPreacher } } : {},
      dateRange ? { sermonDate: { gte: dateRange.gte, lt: dateRange.lt } } : {},
      trimmedScripture
        ? {
            scriptureRefs: {
              some: {
                reference: { contains: trimmedScripture },
              },
            },
          }
        : {},
      trimmedBook
        ? {
            scriptureRefs: {
              some: {
                OR: [
                  { book: { contains: trimmedBook } },
                  { reference: { contains: trimmedBook } },
                ],
              },
            },
          }
        : {},
      filters.scriptureUsageType
        ? {
            scriptureRefs: {
              some: {
                usageType: filters.scriptureUsageType,
              },
            },
          }
        : {},
      filters.primaryScriptureOnly
        ? {
            scriptureRefs: {
              some: { isPrimary: true },
            },
          }
        : {},
      filters.topics && filters.topics.length > 0
        ? {
            topicTags: {
              some: {
                topic: { in: filters.topics },
              },
            },
          }
        : {},
      filters.ministryMomentType
        ? {
            ministryMoments: {
              some: {
                momentType: filters.ministryMomentType,
              },
            },
          }
        : {},
      trimmedClipCategory
        ? {
            clipCandidates: {
              some: {
                smartClipCategory: { contains: trimmedClipCategory },
              },
            },
          }
        : {},
      filters.contentCategory
        ? {
            contentOpportunities: {
              some: {
                category: filters.contentCategory,
                status: { not: "ARCHIVED" },
              },
            },
          }
        : {},
      filters.contentType
        ? {
            contentOpportunities: {
              some: {
                opportunityType: filters.contentType,
                status: { not: "ARCHIVED" },
              },
            },
          }
        : {},
    ],
  };
}

export function computeRelatedSermonScore(current: SimpleSermonSignal, candidate: SimpleSermonSignal): RelatedSermon {
  const topicSet = new Set(current.topics.map((topic) => topic.toLowerCase()));
  const scriptureSet = new Set(current.scriptures.map((scripture) => scripture.toLowerCase()));

  const overlapTopics = candidate.topics.filter((topic) => topicSet.has(topic.toLowerCase()));
  const overlapScriptures = candidate.scriptures.filter((scripture) => scriptureSet.has(scripture.toLowerCase()));

  const score = overlapTopics.length * 2 + overlapScriptures.length * 3;

  return {
    id: candidate.id,
    title: candidate.title,
    speakerName: candidate.speakerName,
    sermonDate: candidate.sermonDate ? candidate.sermonDate.toISOString() : null,
    overlapTopics,
    overlapScriptures,
    score,
  };
}

export async function searchSermonKnowledgeBase(
  filters: KnowledgeBaseFilters,
  options?: { take?: number },
): Promise<{ total: number; results: KnowledgeBaseResult[] }> {
  const where = buildKnowledgeBaseWhere(filters);
  const take = options?.take ?? 100;

  const [total, sermons] = await Promise.all([
    prisma.sermon.count({ where }),
    prisma.sermon.findMany({
      where,
      orderBy: [{ sermonDate: "desc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        title: true,
        speakerName: true,
        churchName: true,
        sermonDate: true,
        intelligence: {
          select: {
            centralTheme: true,
            summary: true,
          },
        },
        scriptureRefs: {
          select: {
            reference: true,
            isPrimary: true,
          },
          orderBy: [
            { isPrimary: "desc" },
            { confidenceScore: "desc" },
          ],
          take: 8,
        },
        topicTags: {
          select: { topic: true },
          orderBy: { confidenceScore: "desc" },
          take: 8,
        },
        ministryMoments: {
          select: { momentType: true },
          orderBy: { confidenceScore: "desc" },
          take: 8,
        },
        clipCandidates: {
          where: {
            OR: [
              { status: "APPROVED" },
              { status: "SUGGESTED" },
              { status: "EXPORTED" },
            ],
          },
          select: {
            id: true,
            title: true,
            smartClipCategory: true,
            status: true,
          },
          orderBy: { score: "desc" },
          take: 5,
        },
        contentOpportunities: {
          where: { status: { not: "ARCHIVED" } },
          select: {
            id: true,
            title: true,
            category: true,
            opportunityType: true,
            status: true,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    }),
  ]);

  const results: KnowledgeBaseResult[] = sermons.map((sermon) => {
    const primary = sermon.scriptureRefs.find((item) => item.isPrimary)?.reference ?? sermon.scriptureRefs[0]?.reference ?? null;
    const scriptures = sermon.scriptureRefs.map((item) => item.reference);
    const topics = sermon.topicTags.map((item) => item.topic);
    const moments = sermon.ministryMoments.map((item) => item.momentType);
    const clipCount = sermon.clipCandidates.length;
    const approvedClipCount = sermon.clipCandidates.filter((item) => item.status === "APPROVED" || item.status === "EXPORTED").length;
    const opportunityCount = sermon.contentOpportunities.length;
    const approvedOpportunityCount = sermon.contentOpportunities.filter((item) => item.status === "APPROVED" || item.status === "USED").length;

    return {
      id: sermon.id,
      title: sermon.title,
      speakerName: sermon.speakerName,
      churchName: sermon.churchName,
      sermonDate: sermon.sermonDate ? sermon.sermonDate.toISOString() : null,
      centralTheme: sermon.intelligence?.centralTheme ?? null,
      summary: sermon.intelligence?.summary ?? null,
      primaryScripture: primary,
      scriptures,
      topTopics: topics,
      ministryMoments: moments,
      clipCount,
      approvedClipCount,
      contentOpportunityCount: opportunityCount,
      approvedContentOpportunityCount: approvedOpportunityCount,
      clipLinks: sermon.clipCandidates.map((clip) => ({
        id: clip.id,
        title: clip.title,
        category: clip.smartClipCategory,
      })),
      contentLinks: sermon.contentOpportunities.map((opportunity) => ({
        id: opportunity.id,
        title: opportunity.title,
        category: opportunity.category,
        type: opportunity.opportunityType,
      })),
    };
  });

  return { total, results };
}

export async function getKnowledgeBaseScopeAvailability(options?: {
  churchName?: string;
}): Promise<KnowledgeBaseScopeAvailability> {
  const churchFilter = options?.churchName?.trim();

  const where: Prisma.SermonWhereInput = {
    status: { in: PROCESSED_SERMON_STATUSES },
    ...(churchFilter ? { churchName: { contains: churchFilter } } : {}),
  };

  const [sermonsProcessed, sermonsWithIntelligence] = await Promise.all([
    prisma.sermon.count({ where }),
    prisma.sermon.count({
      where: {
        ...where,
        intelligence: {
          is: {
            status: "COMPLETED",
          },
        },
      },
    }),
  ]);

  return {
    sermonsProcessed,
    sermonsWithIntelligence,
  };
}

function sortDistribution(map: Map<string, number>, limit = 10): DashboardDistributionItem[] {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function aggregateLabelCounts(labels: string[], limit = 10): DashboardDistributionItem[] {
  const map = new Map<string, number>();
  for (const label of labels) {
    const normalized = label.trim();
    if (!normalized) {
      continue;
    }
    map.set(normalized, (map.get(normalized) ?? 0) + 1);
  }

  return sortDistribution(map, limit);
}

function extractBook(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed) {
    return "Unknown";
  }

  const token = trimmed.split(" ")[0] ?? "Unknown";
  return token;
}

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function getIntelligenceDashboardData(
  options?: { churchName?: string; recentLimit?: number },
): Promise<IntelligenceDashboardData> {
  const churchFilter = options?.churchName?.trim();

  const sermonWhere: Prisma.SermonWhereInput = {
    status: { in: PROCESSED_SERMON_STATUSES },
    ...(churchFilter ? { churchName: { contains: churchFilter } } : {}),
  };

  const clipWhere: Prisma.ClipCandidateWhereInput = churchFilter
    ? { sermon: { churchName: { contains: churchFilter } } }
    : {};

  const opportunityWhere: Prisma.ContentOpportunityWhereInput = {
    status: { not: "ARCHIVED" },
    ...(churchFilter ? { sermon: { churchName: { contains: churchFilter } } } : {}),
  };

  const [
    sermons,
    scriptures,
    moments,
    clips,
    opportunities,
    topics,
    recent,
  ] = await Promise.all([
    prisma.sermon.findMany({
      where: sermonWhere,
      select: {
        id: true,
        sermonDate: true,
        createdAt: true,
        intelligence: { select: { centralTheme: true } },
      },
    }),
    prisma.sermonScriptureRef.findMany({
      where: churchFilter ? { sermon: { churchName: { contains: churchFilter } } } : {},
      select: {
        reference: true,
        book: true,
        usageType: true,
      },
    }),
    prisma.ministryMoment.findMany({
      where: churchFilter ? { sermon: { churchName: { contains: churchFilter } } } : {},
      select: {
        momentType: true,
      },
    }),
    prisma.clipCandidate.findMany({
      where: clipWhere,
      select: {
        status: true,
        renderStatus: true,
        smartClipCategory: true,
      },
    }),
    prisma.contentOpportunity.findMany({
      where: opportunityWhere,
      select: {
        status: true,
        category: true,
      },
    }),
    prisma.sermonTopicTag.findMany({
      where: churchFilter ? { sermon: { churchName: { contains: churchFilter } } } : {},
      select: { topic: true },
    }),
    prisma.sermon.findMany({
      where: sermonWhere,
      orderBy: { updatedAt: "desc" },
      take: options?.recentLimit ?? 8,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        intelligence: { select: { centralTheme: true } },
        _count: {
          select: {
            clipCandidates: true,
            contentOpportunities: true,
          },
        },
      },
    }),
  ]);

  const topicMap = new Map<string, number>();
  const scriptureMap = new Map<string, number>();
  const bookMap = new Map<string, number>();
  const themeMap = new Map<string, number>();
  const momentMap = new Map<string, number>();
  const clipCategoryMap = new Map<string, number>();
  const contentCategoryMap = new Map<string, number>();
  const scriptureUsageMap = new Map<string, number>();
  const sermonsPerMonthMap = new Map<string, number>();

  for (const topic of topics) {
    topicMap.set(topic.topic, (topicMap.get(topic.topic) ?? 0) + 1);
  }

  for (const scripture of scriptures) {
    scriptureMap.set(scripture.reference, (scriptureMap.get(scripture.reference) ?? 0) + 1);
    const book = scripture.book ?? extractBook(scripture.reference);
    bookMap.set(book, (bookMap.get(book) ?? 0) + 1);
    scriptureUsageMap.set(scripture.usageType, (scriptureUsageMap.get(scripture.usageType) ?? 0) + 1);
  }

  for (const sermon of sermons) {
    const key = monthKey(sermon.sermonDate ?? sermon.createdAt);
    sermonsPerMonthMap.set(key, (sermonsPerMonthMap.get(key) ?? 0) + 1);

    const theme = sermon.intelligence?.centralTheme?.trim();
    if (theme) {
      themeMap.set(theme, (themeMap.get(theme) ?? 0) + 1);
    }
  }

  for (const moment of moments) {
    momentMap.set(moment.momentType, (momentMap.get(moment.momentType) ?? 0) + 1);
  }

  for (const clip of clips) {
    if (clip.smartClipCategory) {
      clipCategoryMap.set(clip.smartClipCategory, (clipCategoryMap.get(clip.smartClipCategory) ?? 0) + 1);
    }
  }

  for (const opportunity of opportunities) {
    contentCategoryMap.set(opportunity.category, (contentCategoryMap.get(opportunity.category) ?? 0) + 1);
  }

  const sermonsProcessed = sermons.length;
  const sermonsWithIntelligence = sermons.filter((sermon) => sermon.intelligence?.centralTheme?.trim()).length;
  const clipsSuggested = clips.length;
  const clipsApproved = clips.filter((clip) => clip.status === "APPROVED" || clip.status === "EXPORTED").length;
  const clipsRendered = clips.filter((clip) => clip.renderStatus === "COMPLETED").length;
  const contentGenerated = opportunities.length;
  const contentApproved = opportunities.filter((item) => item.status === "APPROVED").length;
  const contentUsed = opportunities.filter((item) => item.status === "USED").length;

  const sermonsWithNoGeneratedClips = await prisma.sermon.count({
    where: {
      ...sermonWhere,
      clipCandidates: { none: {} },
    },
  });

  const sermonsWithNoApprovedContent = await prisma.sermon.count({
    where: {
      ...sermonWhere,
      AND: [
        {
          clipCandidates: {
            none: {
              status: { in: ["APPROVED", "EXPORTED"] },
            },
          },
        },
        {
          contentOpportunities: {
            none: {
              status: { in: ["APPROVED", "USED"] },
            },
          },
        },
      ],
    },
  });

  const averageContentOpportunitiesPerSermon = sermonsProcessed > 0
    ? Number((contentGenerated / sermonsProcessed).toFixed(2))
    : 0;

  return {
    totals: {
      sermonsProcessed,
      sermonsWithIntelligence,
      ministryMomentsDetected: moments.length,
      clipsSuggested,
      clipsApproved,
      clipsRendered,
      contentOpportunitiesGenerated: contentGenerated,
      contentOpportunitiesApproved: contentApproved,
      contentOpportunitiesUsed: contentUsed,
    },
    pastorLearning: {
      mostPreachedTopics: sortDistribution(topicMap),
      mostUsedScriptures: sortDistribution(scriptureMap),
      mostReferencedBooks: sortDistribution(bookMap),
      recurringThemes: sortDistribution(themeMap),
      recurringMinistryMoments: sortDistribution(momentMap),
      commonClipCategories: sortDistribution(clipCategoryMap),
      sermonsPerMonth: sortDistribution(sermonsPerMonthMap, 24),
      averageContentOpportunitiesPerSermon,
      sermonsWithNoGeneratedClips,
      sermonsWithNoApprovedContent,
    },
    churchLearning: {
      contentCategoriesProduced: sortDistribution(contentCategoryMap),
      scriptureUsageDistribution: sortDistribution(scriptureUsageMap),
      topicDistribution: sortDistribution(topicMap),
      clipCategoryDistribution: sortDistribution(clipCategoryMap),
      ministryMomentTrend: sortDistribution(momentMap),
      approvedVsGeneratedClips: {
        approved: clipsApproved,
        generated: clipsSuggested,
      },
      approvedVsGeneratedContent: {
        approved: contentApproved + contentUsed,
        generated: contentGenerated,
      },
    },
    recentActivity: recent.map((item) => ({
      sermonId: item.id,
      title: item.title,
      updatedAt: item.updatedAt.toISOString(),
      centralTheme: item.intelligence?.centralTheme ?? null,
      clipCount: item._count.clipCandidates,
      opportunityCount: item._count.contentOpportunities,
    })),
  };
}

export async function getRelatedSermons(
  sermonId: string,
  options?: { limit?: number },
): Promise<RelatedSermon[]> {
  const current = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      sermonDate: true,
      topicTags: { select: { topic: true } },
      scriptureRefs: { select: { reference: true } },
    },
  });

  if (!current) {
    return [];
  }

  const currentTopics = current.topicTags.map((item) => item.topic);
  const currentScriptures = current.scriptureRefs.map((item) => item.reference);

  if (currentTopics.length === 0 && currentScriptures.length === 0) {
    return [];
  }

  const candidates = await prisma.sermon.findMany({
    where: {
      id: { not: sermonId },
      status: { in: PROCESSED_SERMON_STATUSES },
      OR: [
        currentTopics.length > 0
          ? {
              topicTags: {
                some: {
                  topic: { in: currentTopics },
                },
              },
            }
          : {},
        currentScriptures.length > 0
          ? {
              scriptureRefs: {
                some: {
                  reference: { in: currentScriptures },
                },
              },
            }
          : {},
      ],
    },
    select: {
      id: true,
      title: true,
      speakerName: true,
      sermonDate: true,
      topicTags: { select: { topic: true } },
      scriptureRefs: { select: { reference: true } },
    },
    take: 80,
  });

  const currentSignal: SimpleSermonSignal = {
    id: current.id,
    title: current.title,
    speakerName: current.speakerName,
    sermonDate: current.sermonDate,
    topics: currentTopics,
    scriptures: currentScriptures,
  };

  return candidates
    .map((candidate) => {
      const candidateSignal: SimpleSermonSignal = {
        id: candidate.id,
        title: candidate.title,
        speakerName: candidate.speakerName,
        sermonDate: candidate.sermonDate,
        topics: candidate.topicTags.map((item) => item.topic),
        scriptures: candidate.scriptureRefs.map((item) => item.reference),
      };

      return computeRelatedSermonScore(currentSignal, candidateSignal);
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options?.limit ?? 6);
}

export const __knowledgeIntelligenceTestUtils = {
  buildKnowledgeBaseWhere,
  computeRelatedSermonScore,
  aggregateLabelCounts,
};
