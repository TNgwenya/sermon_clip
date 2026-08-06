const workerJobModules = [
  "../src/server/pipeline/processSermonPipeline.ts",
  "../src/server/agents/videoDownloadAgent.ts",
  "../src/server/agents/audioExtractionAgent.ts",
  "../src/server/agents/transcriptionAgent.ts",
  "../src/server/agents/sermonIntelligenceService.ts",
  "../src/server/agents/contentOpportunityJobService.ts",
  "../src/server/agents/clipRedoService.ts",
  "../src/server/agents/clipIntelligenceAgent.ts",
  "../src/server/agents/worshipMomentService.ts",
  "../src/server/agents/clipReviewAssetService.ts",
  "../src/server/agents/teachingVideoAnalysisService.ts",
  "../src/server/agents/teachingVideoExportService.ts",
  "../src/server/agents/clipRenderService.ts",
  "../src/server/agents/captionService.ts",
  "../src/server/agents/clipQualityRefreshService.ts",
  "../src/server/agents/captionBurnService.ts",
  "../src/server/agents/clipOverlayService.ts",
  "../src/server/agents/clipExportService.ts",
  "../src/server/integrations/youtubeAutomaticIntake.ts",
] as const;

for (const modulePath of workerJobModules) {
  await import(modulePath);
}

console.log(
  `Media worker runtime imported ${workerJobModules.length} production job modules successfully.`,
);

export {};
