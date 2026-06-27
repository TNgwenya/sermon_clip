export type OpportunityCategory = "SOCIAL" | "DEVOTIONAL" | "DISCIPLESHIP" | "PROMOTION" | "WRITTEN" | "ENGAGEMENT" | "RECAP";
export type OpportunityStatus = "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "USED" | "ARCHIVED";

export type OpportunityListItem = {
  id: string;
  sermonId: string;
  category: OpportunityCategory;
  opportunityType: string;
  status: OpportunityStatus;
  relatedScripture?: string | null;
  topicTags?: string[];
  ministryMomentType?: string | null;
};

export type OpportunityFilters = {
  sermonId?: string;
  category?: OpportunityCategory | "ALL";
  opportunityType?: string | "ALL";
  status?: OpportunityStatus | "ALL";
  topic?: string;
  scripture?: string;
  ministryMomentType?: string;
};

export function filterContentOpportunities(
  opportunities: OpportunityListItem[],
  filters: OpportunityFilters,
): OpportunityListItem[] {
  return opportunities.filter((item) => {
    if (filters.sermonId && item.sermonId !== filters.sermonId) {
      return false;
    }

    if (filters.category && filters.category !== "ALL" && item.category !== filters.category) {
      return false;
    }

    if (filters.opportunityType && filters.opportunityType !== "ALL" && item.opportunityType !== filters.opportunityType) {
      return false;
    }

    if (filters.status && filters.status !== "ALL" && item.status !== filters.status) {
      return false;
    }

    if (filters.topic) {
      const normalizedTopic = filters.topic.toLowerCase();
      const hasTopic = item.topicTags?.some((topic) => topic.toLowerCase().includes(normalizedTopic));
      if (!hasTopic) {
        return false;
      }
    }

    if (filters.scripture) {
      const normalizedScripture = filters.scripture.toLowerCase();
      if (!item.relatedScripture?.toLowerCase().includes(normalizedScripture)) {
        return false;
      }
    }

    if (filters.ministryMomentType) {
      if (item.ministryMomentType !== filters.ministryMomentType) {
        return false;
      }
    }

    return true;
  });
}

export function groupOpportunitiesByCategory(
  opportunities: OpportunityListItem[],
): Record<OpportunityCategory, OpportunityListItem[]> {
  return opportunities.reduce(
    (acc, item) => {
      acc[item.category].push(item);
      return acc;
    },
    {
      SOCIAL: [],
      DEVOTIONAL: [],
      DISCIPLESHIP: [],
      PROMOTION: [],
      WRITTEN: [],
      ENGAGEMENT: [],
      RECAP: [],
    } as Record<OpportunityCategory, OpportunityListItem[]>,
  );
}
