import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import { prisma } from "../prisma";
import { authenticate } from "../middleware/authenticate";
import { authorize, ROLES_INSTRUCTION } from "../middleware/authorize";
import { enregistrerAudit } from "../services/audit";
import { genererNumeroDemande } from "../utils/numero";

export const demandesRouter = Router();
demandesRouter.use(authenticate);

const upload = multer({
  dest: process.env.STORAGE_LOCAL_PATH || "./uploads",
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo par fichier
});

/**
 * 2. Déposer une nouvelle demande (brouillon)
 * 5. Enregistrer un brouillon pour terminer plus tard -> même endpoint, statut BROUILLON
 */
const creerDemandeSchema = z.object({
  typeAutorisationId: z.string().uuid(),
  donnees: z.record(z.any()).default({}),
});

demandesRouter.post("/", async (req, res) => {
  const parsed = creerDemandeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erreur: parsed.error.flatten() });

  const typeAutorisation = await prisma.typeAutorisation.findUnique({
    where: { id: parsed.data.typeAutorisationId },
  });
  if (!typeAutorisation) return res.status(404).json({ erreur: "Type d'autorisation introuvable." });

  const compteurAnnuel = (await prisma.demande.count()) + 1;

  const demande = await prisma.demande.create({
    data: {
      numero: genererNumeroDemande(compteurAnnuel),
      demandeurId: req.user!.userId,
      typeAutorisationId: parsed.data.typeAutorisationId,
      donnees: parsed.data.donnees,
      statut: "BROUILLON",
    },
  });

  await enregistrerAudit({ userId: req.user!.userId, action: "CREATION_BROUILLON", entite: "Demande", entiteId: demande.id });
  res.status(201).json(demande);
});

/**
 * 3. Remplir / modifier le formulaire tant que la demande est un brouillon
 * 12. Modifier certaines informations tant que la demande n'a pas encore été prise en charge
 */
demandesRouter.put("/:id", async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (demande.demandeurId !== req.user!.userId) return res.status(403).json({ erreur: "Accès refusé." });
  if (!["BROUILLON", "COMPLEMENT_REQUIS"].includes(demande.statut)) {
    return res.status(409).json({ erreur: "Cette demande n'est plus modifiable à ce stade." });
  }

  const updated = await prisma.demande.update({
    where: { id: demande.id },
    data: { donnees: req.body.donnees ?? demande.donnees },
  });
  res.json(updated);
});

/**
 * 3bis. Supprimer une demande — uniquement par son propriétaire, et
 * uniquement tant qu'elle n'a jamais été soumise (BROUILLON).
 */
demandesRouter.delete("/:id", async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (demande.demandeurId !== req.user!.userId) return res.status(403).json({ erreur: "Accès refusé." });
  if (demande.statut !== "BROUILLON") {
    return res.status(409).json({ erreur: "Seul un brouillon non soumis peut être supprimé." });
  }

  await prisma.pieceJustificative.deleteMany({ where: { demandeId: demande.id } });
  await prisma.historiqueDemande.deleteMany({ where: { demandeId: demande.id } });
  await prisma.demande.delete({ where: { id: demande.id } });
  res.status(204).send();
});

/**
 * 4. Joindre des pièces justificatives
 */
demandesRouter.post("/:id/pieces", upload.array("fichiers", 10), async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (demande.demandeurId !== req.user!.userId) return res.status(403).json({ erreur: "Accès refusé." });

  const fichiers = (req.files as Express.Multer.File[]) || [];
  const pieces = await Promise.all(
    fichiers.map((f) =>
      prisma.pieceJustificative.create({
        data: {
          demandeId: demande.id,
          nomFichier: f.originalname,
          cheminStockage: f.path,
          typeMime: f.mimetype,
          tailleOctets: f.size,
        },
      })
    )
  );
  res.status(201).json(pieces);
});

/**
 * 6. Soumettre la demande à l'administration
 */
demandesRouter.post("/:id/submit", async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (demande.demandeurId !== req.user!.userId) return res.status(403).json({ erreur: "Accès refusé." });
  if (!["BROUILLON", "COMPLEMENT_REQUIS"].includes(demande.statut)) {
    return res.status(409).json({ erreur: "Cette demande a déjà été soumise." });
  }

  const typeAutorisation = await prisma.typeAutorisation.findUnique({ where: { id: demande.typeAutorisationId } });
  const premiereEtape = typeAutorisation
    ? (await prisma.workflowEtape.findFirst({ where: { typeAutorisationId: typeAutorisation.id }, orderBy: { ordre: "asc" } }))
    : null;

  const updated = await prisma.demande.update({
    where: { id: demande.id },
    data: {
      statut: "EN_COURS",
      dateDepot: demande.dateDepot ?? new Date(),
      etapeActuelle: premiereEtape?.nom ?? null,
    },
  });

  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "SOUMISSION" },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "SOUMISSION_DEMANDE", entite: "Demande", entiteId: demande.id });

  res.json(updated);
});

/**
 * 7. Suivre l'état d'avancement en temps réel
 * 10. Consulter l'historique de toutes ses demandes
 */
demandesRouter.get("/", async (req, res) => {
  const estAgent = ROLES_INSTRUCTION.includes(req.user!.role) || req.user!.role !== "DEMANDEUR";
  const demandes = await prisma.demande.findMany({
    where: estAgent ? {} : { demandeurId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    include: { typeAutorisation: true },
  });
  res.json(demandes);
});

demandesRouter.get("/:id", async (req, res) => {
  const demande = await prisma.demande.findUnique({
    where: { id: req.params.id },
    include: { typeAutorisation: true, pieces: true, historique: { orderBy: { createdAt: "asc" } }, autorisation: true },
  });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  const estProprietaire = demande.demandeurId === req.user!.userId;
  const estAgent = req.user!.role !== "DEMANDEUR";
  if (!estProprietaire && !estAgent) return res.status(403).json({ erreur: "Accès refusé." });
  res.json(demande);
});

/**
 * 8. Répondre à une demande de complément
 */
demandesRouter.post("/:id/complement", async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (demande.demandeurId !== req.user!.userId) return res.status(403).json({ erreur: "Accès refusé." });
  if (demande.statut !== "COMPLEMENT_REQUIS") {
    return res.status(409).json({ erreur: "Aucun complément n'est attendu sur cette demande." });
  }

  const updated = await prisma.demande.update({
    where: { id: demande.id },
    data: { statut: "EN_COURS", donnees: req.body.donnees ?? demande.donnees },
  });
  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "COMPLEMENT_FOURNI", commentaire: req.body.commentaire },
  });
  res.json(updated);
});

/**
 * 11. Demander le renouvellement d'une autorisation existante
 * -> crée une nouvelle demande liée au même type d'autorisation, en brouillon
 */
demandesRouter.post("/:id/renouveler", async (req, res) => {
  const ancienne = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!ancienne) return res.status(404).json({ erreur: "Demande introuvable." });
  if (ancienne.demandeurId !== req.user!.userId) return res.status(403).json({ erreur: "Accès refusé." });
  if (ancienne.statut !== "APPROUVEE") {
    return res.status(409).json({ erreur: "Seule une autorisation approuvée peut être renouvelée." });
  }

  const compteurAnnuel = (await prisma.demande.count()) + 1;
  const nouvelle = await prisma.demande.create({
    data: {
      numero: genererNumeroDemande(compteurAnnuel),
      demandeurId: req.user!.userId,
      typeAutorisationId: ancienne.typeAutorisationId,
      donnees: ancienne.donnees as any,
      statut: "BROUILLON",
    },
  });
  res.status(201).json(nouvelle);
});

/**
 * 14. Échanger avec l'instructeur via une messagerie intégrée
 * (implémentation simple : messages stockés dans l'historique de la demande)
 */
demandesRouter.post("/:id/messages", async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  const estProprietaire = demande.demandeurId === req.user!.userId;
  const estAgent = req.user!.role !== "DEMANDEUR";
  if (!estProprietaire && !estAgent) return res.status(403).json({ erreur: "Accès refusé." });

  const message = await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "MESSAGE", commentaire: req.body.commentaire },
  });
  res.status(201).json(message);
});

/**
 * 17. Consulter les échéances (autorisations arrivant à expiration)
 * Renvoie les demandes APPROUVEE du demandeur dont la date d'expiration
 * arrive dans les 90 prochains jours (à brancher sur un job de rappel automatique).
 */
demandesRouter.get("/echeances/proches", async (req, res) => {
  const dansNoventeJours = new Date();
  dansNoventeJours.setDate(dansNoventeJours.getDate() + 90);

  const demandes = await prisma.demande.findMany({
    where: {
      demandeurId: req.user!.userId,
      statut: "APPROUVEE",
      dateExpiration: { lte: dansNoventeJours, gte: new Date() },
    },
    orderBy: { dateExpiration: "asc" },
  });
  res.json(demandes);
});
