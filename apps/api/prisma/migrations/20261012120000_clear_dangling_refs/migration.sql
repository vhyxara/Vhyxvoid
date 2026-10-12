-- Data only. References kept as plain ids (no foreign key) that deletes racing
-- with writes, or mock deletes, could leave pointing at nothing (found
-- 2026-10-12). The routes now prevent new ones; this clears the old ones.

-- Docs and folders whose folder was deleted: back to the top level.
UPDATE "team_docs" d SET "folderId" = NULL
WHERE d."folderId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "team_folders" f WHERE f."id" = d."folderId");
UPDATE "team_folders" c SET "parentId" = NULL
WHERE c."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "team_folders" f WHERE f."id" = c."parentId");

-- Comments on deleted documents and issues.
DELETE FROM "team_comments" c
WHERE (c."targetKind" = 'doc' AND NOT EXISTS (SELECT 1 FROM "team_docs" d WHERE d."id" = c."targetId"))
   OR (c."targetKind" = 'issue' AND NOT EXISTS (SELECT 1 FROM "team_issues" i WHERE i."id" = c."targetId"));

-- Docs try-it on a deleted mock.
UPDATE "api_specs" s SET "tryMockId" = NULL
WHERE s."tryMockId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "mock_apis" m WHERE m."id" = s."tryMockId");

-- Monitors on a deleted environment are left as they are: each run now fails
-- saying so, and the owner picks another environment.
