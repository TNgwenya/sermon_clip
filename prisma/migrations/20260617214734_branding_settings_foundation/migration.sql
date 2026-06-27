-- CreateTable
CREATE TABLE "BrandingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    "churchName" TEXT NOT NULL,
    "churchLogoPath" TEXT,
    "primaryBrandColor" TEXT NOT NULL,
    "secondaryBrandColor" TEXT NOT NULL,
    "defaultFontFamily" TEXT NOT NULL,
    "watermarkPosition" TEXT NOT NULL DEFAULT 'BOTTOM_RIGHT',
    "defaultCaptionStyleName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
