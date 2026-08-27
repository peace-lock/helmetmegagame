-- Replaces the 4-drawback COUNT cap with a 6-POINT cap: a character's
-- point-bought drawbacks may give back at most this many points in total,
-- not at most this many tags. See docs/systemdocs/TAGS.md §4a.

-- AlterTable
ALTER TABLE "GameConfig" RENAME COLUMN "maxNegativeTags" TO "maxDrawbackPoints";
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackPoints" SET DEFAULT 6;

-- The live row holds 4, carried over from the old tag-count cap. As a point
-- budget that's a materially tighter (and accidental) rule, not the default
-- anyone chose — reset it to the new default.
UPDATE "GameConfig" SET "maxDrawbackPoints" = 6;
