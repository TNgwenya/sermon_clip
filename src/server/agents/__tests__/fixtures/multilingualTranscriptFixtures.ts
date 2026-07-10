import type { MultilingualTranscriptSegment } from "@/server/agents/multilingualTranscriptAnalysis";

export const englishSermonSegments: MultilingualTranscriptSegment[] = [
  {
    startTimeSeconds: 0,
    endTimeSeconds: 8,
    text: "God is faithful, and the church can trust him in every season.",
    confidence: 0.94,
  },
  {
    startTimeSeconds: 8,
    endTimeSeconds: 16,
    text: "Today you should pray with faith because Jesus remains with you.",
    confidence: 0.91,
  },
];

export const zuluSermonSegments: MultilingualTranscriptSegment[] = [
  {
    startTimeSeconds: 20,
    endTimeSeconds: 30,
    text: "UNkulunkulu uthembekile futhi abantu bakhe kufanele bakholwe.",
    confidence: 0.91,
  },
  {
    startTimeSeconds: 30,
    endTimeSeconds: 40,
    text: "Manje khetha ukholo, themba uJesu, futhi thandaza.",
    confidence: 0.89,
  },
];

export const sothoSermonSegments: MultilingualTranscriptSegment[] = [
  {
    startTimeSeconds: 50,
    endTimeSeconds: 60,
    text: "Modimo o tshepahala, hobane batho ba hae ba phela ka tumelo.",
    confidence: 0.9,
  },
  {
    startTimeSeconds: 60,
    endTimeSeconds: 70,
    text: "Joale tšepa Jesu, rapela, mme o latele Morena.",
    confidence: 0.88,
  },
];

export const zuluEnglishCodeSwitchSegments: MultilingualTranscriptSegment[] = [
  {
    startTimeSeconds: 80,
    endTimeSeconds: 90,
    text: "God is faithful, and you can trust him today.",
    confidence: 0.93,
  },
  {
    startTimeSeconds: 90,
    endTimeSeconds: 100,
    text: "Ngoba uNkulunkulu uthembekile, khetha ukholo manje.",
    confidence: 0.92,
  },
  {
    startTimeSeconds: 100,
    endTimeSeconds: 110,
    text: "The church should pray, ngoba uJesu unathi.",
    confidence: 0.9,
  },
];

export const lowConfidenceMixedSegments: MultilingualTranscriptSegment[] = [
  {
    startTimeSeconds: 120,
    endTimeSeconds: 130,
    text: "The church can trust God in this season.",
    confidence: 0.92,
  },
  {
    startTimeSeconds: 130,
    endTimeSeconds: 140,
    text: "UNkulunkulu uthembekile futhi khetha ukholo.",
    confidence: 0.58,
  },
  {
    startTimeSeconds: 140,
    endTimeSeconds: 150,
    text: "Manje thandaza, ngoba uJesu unathi.",
    confidence: 0.55,
  },
];

export const missingConfidenceSegments: MultilingualTranscriptSegment[] = [
  {
    startTimeSeconds: 160,
    endTimeSeconds: 170,
    text: "Modimo o tshepahala, mme batho ba tshwanetse ho rapela.",
  },
  {
    startTimeSeconds: 170,
    endTimeSeconds: 180,
    text: "Joale dumela, tšepa Jesu, mme o latele Morena.",
    confidence: null,
  },
];
