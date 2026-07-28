-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DEMANDEUR', 'SUPER_ADMIN', 'ADMIN_FONCTIONNEL', 'AGENT_INSTRUCTEUR', 'CHEF_SERVICE', 'DIRECTEUR', 'SIGNATAIRE');

-- CreateEnum
CREATE TYPE "TypeProfil" AS ENUM ('PARTICULIER', 'ENTREPRISE', 'HOPITAL', 'LABORATOIRE', 'INDUSTRIE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutDemande" AS ENUM ('BROUILLON', 'SOUMISE', 'EN_COURS', 'COMPLEMENT_REQUIS', 'APPROUVEE', 'REJETEE', 'EXPIREE');

-- CreateEnum
CREATE TYPE "CanalNotification" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "StatutNotification" AS ENUM ('EN_ATTENTE', 'ENVOYEE', 'ECHEC');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "telephone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'DEMANDEUR',
    "typeProfil" "TypeProfil",
    "organisation" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "types_autorisation" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "formulaireSchema" JSONB NOT NULL,
    "piecesRequises" JSONB NOT NULL,
    "dureeValiditeMois" INTEGER NOT NULL DEFAULT 12,
    "frais" DECIMAL(12,2),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "types_autorisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_etapes" (
    "id" TEXT NOT NULL,
    "typeAutorisationId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "roleResponsable" "Role" NOT NULL,
    "delaiJours" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "workflow_etapes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demandes" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "demandeurId" TEXT NOT NULL,
    "typeAutorisationId" TEXT NOT NULL,
    "statut" "StatutDemande" NOT NULL DEFAULT 'BROUILLON',
    "donnees" JSONB NOT NULL,
    "instructeurId" TEXT,
    "etapeActuelle" TEXT,
    "dateDepot" TIMESTAMP(3),
    "dateDecision" TIMESTAMP(3),
    "dateExpiration" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demandes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces_justificatives" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "nomFichier" TEXT NOT NULL,
    "cheminStockage" TEXT NOT NULL,
    "typeMime" TEXT NOT NULL,
    "tailleOctets" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pieces_justificatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historique_demandes" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "parUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_demandes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canal" "CanalNotification" NOT NULL,
    "sujet" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "statut" "StatutNotification" NOT NULL DEFAULT 'EN_ATTENTE',
    "envoyeeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modeles_documents" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "typeAutorisationId" TEXT,
    "contenuTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modeles_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autorisations_delivrees" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "pdfCheminStockage" TEXT NOT NULL,
    "qrCodeValeur" TEXT NOT NULL,
    "signeParId" TEXT NOT NULL,
    "dateSignature" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autorisations_delivrees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "types_autorisation_nom_key" ON "types_autorisation"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_etapes_typeAutorisationId_ordre_key" ON "workflow_etapes"("typeAutorisationId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "demandes_numero_key" ON "demandes"("numero");

-- CreateIndex
CREATE INDEX "demandes_statut_idx" ON "demandes"("statut");

-- CreateIndex
CREATE INDEX "demandes_demandeurId_idx" ON "demandes"("demandeurId");

-- CreateIndex
CREATE UNIQUE INDEX "autorisations_delivrees_demandeId_key" ON "autorisations_delivrees"("demandeId");

-- CreateIndex
CREATE INDEX "audit_logs_entite_entiteId_idx" ON "audit_logs"("entite", "entiteId");

-- AddForeignKey
ALTER TABLE "workflow_etapes" ADD CONSTRAINT "workflow_etapes_typeAutorisationId_fkey" FOREIGN KEY ("typeAutorisationId") REFERENCES "types_autorisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes" ADD CONSTRAINT "demandes_demandeurId_fkey" FOREIGN KEY ("demandeurId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes" ADD CONSTRAINT "demandes_typeAutorisationId_fkey" FOREIGN KEY ("typeAutorisationId") REFERENCES "types_autorisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes" ADD CONSTRAINT "demandes_instructeurId_fkey" FOREIGN KEY ("instructeurId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_justificatives" ADD CONSTRAINT "pieces_justificatives_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "demandes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_demandes" ADD CONSTRAINT "historique_demandes_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "demandes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_demandes" ADD CONSTRAINT "historique_demandes_parUserId_fkey" FOREIGN KEY ("parUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modeles_documents" ADD CONSTRAINT "modeles_documents_typeAutorisationId_fkey" FOREIGN KEY ("typeAutorisationId") REFERENCES "types_autorisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorisations_delivrees" ADD CONSTRAINT "autorisations_delivrees_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "demandes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorisations_delivrees" ADD CONSTRAINT "autorisations_delivrees_signeParId_fkey" FOREIGN KEY ("signeParId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
