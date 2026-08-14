-- Le QR code de vérification et la génération automatique du PDF signé
-- ne sont pas encore implémentés (prévu en Phase 8 : signature
-- électronique + QR code). En attendant, l'admin peut uploader
-- manuellement le document d'attestation, donc qrCodeValeur devient
-- optionnel et on ajoute le nom de fichier d'origine pour l'affichage.
ALTER TABLE "autorisations_delivrees" ALTER COLUMN "qrCodeValeur" DROP NOT NULL;
ALTER TABLE "autorisations_delivrees" ADD COLUMN "pdfNomFichier" TEXT;
