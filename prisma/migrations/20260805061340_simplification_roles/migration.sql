/*
  Warnings:

  - The values [ADMIN_FONCTIONNEL,AGENT_INSTRUCTEUR,CHEF_SERVICE,DIRECTEUR] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('DEMANDEUR', 'SUPER_ADMIN', 'INSTRUCTEUR', 'SIGNATAIRE');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "workflow_etapes" ALTER COLUMN "roleResponsable" TYPE "Role_new" USING ("roleResponsable"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'DEMANDEUR';
COMMIT;
