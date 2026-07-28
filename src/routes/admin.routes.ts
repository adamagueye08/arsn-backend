import { Router } from "express";
import { prisma } from "../prisma";
import { authenticate } from "../middleware/authenticate";
import { authorize, ROLES_INSTRUCTION, ROLES_ADMIN_TOUS } from "../middleware/authorize";
import { enregistrerAudit } from "../services/audit";

export const adminRouter = Router();
adminRouter.use(authenticate, authorize(ROLES_ADMIN_TOUS));

/**
 * 5. Gestion des demandes (côté admin)
 * - Consulter toutes les demandes / rechercher
 */
adminRouter.get("/demandes", async (req, res) => {
  const { q, statut, typeAutorisationId } = req.query as Record<string, string | undefined>;

  const demandes = await prisma.demande.findMany({
    where: {
      statut: statut ? (statut as any) : undefined,
      typeAutorisationId: typeAutorisationId || undefined,
      OR: q
        ? [
            { numero: { contains: q, mode: "insensitive" } },
            { demandeur: { nom: { contains: q, mode: "insensitive" } } },
            { demandeur: { prenom: { contains: q, mode: "insensitive" } } },
            { demandeur: { organisation: { contains: q, mode: "insensitive" } } },
          ]
        : undefined,
    },
    include: { demandeur: true, typeAutorisation: true, instructeur: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(demandes);
});

/**
 * Affecter un dossier à un instructeur / le réaffecter
 */
adminRouter.post("/demandes/:id/affecter", authorize(["SUPER_ADMIN", "CHEF_SERVICE", "ADMIN_FONCTIONNEL"]), async (req, res) => {
  const { instructeurId } = req.body as { instructeurId: string };
  const demande = await prisma.demande.update({
    where: { id: req.params.id },
    data: { instructeurId },
  });
  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "AFFECTATION", commentaire: `Affecté à ${instructeurId}` },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "AFFECTATION_DEMANDE", entite: "Demande", entiteId: demande.id });
  res.json(demande);
});

/**
 * Valider un dossier (étape intermédiaire ou décision finale selon le rôle)
 */
adminRouter.post("/demandes/:id/valider", authorize(ROLES_INSTRUCTION), async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });

  const estDecisionFinale = req.body.decisionFinale === true; // ex: cochée par le Directeur/Signataire
  const updated = await prisma.demande.update({
    where: { id: demande.id },
    data: estDecisionFinale
      ? { statut: "APPROUVEE", dateDecision: new Date() }
      : { etapeActuelle: req.body.etapeSuivante ?? demande.etapeActuelle },
  });

  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "VALIDATION", commentaire: req.body.commentaire },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "VALIDATION_DEMANDE", entite: "Demande", entiteId: demande.id });
  res.json(updated);
});

/**
 * Rejeter un dossier
 */
adminRouter.post("/demandes/:id/rejeter", authorize(ROLES_INSTRUCTION), async (req, res) => {
  const demande = await prisma.demande.update({
    where: { id: req.params.id },
    data: { statut: "REJETEE", dateDecision: new Date() },
  });
  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "REJET", commentaire: req.body.motif },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "REJET_DEMANDE", entite: "Demande", entiteId: demande.id });
  res.json(demande);
});

/**
 * Retourner un dossier au demandeur (demande de complément)
 */
adminRouter.post("/demandes/:id/retourner", authorize(ROLES_INSTRUCTION), async (req, res) => {
  const demande = await prisma.demande.update({
    where: { id: req.params.id },
    data: { statut: "COMPLEMENT_REQUIS" },
  });
  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "DEMANDE_COMPLEMENT", commentaire: req.body.commentaire },
  });
  res.json(demande);
});

/**
 * 1. Tableau de bord - statistiques
 */
adminRouter.get("/dashboard", async (req, res) => {
  const [recues, enAttente, approuvees, rejetees, expirees, parType] = await Promise.all([
    prisma.demande.count(),
    prisma.demande.count({ where: { statut: { in: ["SOUMISE", "EN_COURS", "COMPLEMENT_REQUIS"] } } }),
    prisma.demande.count({ where: { statut: "APPROUVEE" } }),
    prisma.demande.count({ where: { statut: "REJETEE" } }),
    prisma.demande.count({ where: { statut: "EXPIREE" } }),
    prisma.demande.groupBy({ by: ["typeAutorisationId"], _count: true }),
  ]);

  res.json({
    demandesRecues: recues,
    demandesEnAttente: enAttente,
    demandesApprouvees: approuvees,
    demandesRejetees: rejetees,
    demandesExpirees: expirees,
    parType,
  });
});

/**
 * 2. Gestion des utilisateurs
 */
adminRouter.get("/users", authorize(["SUPER_ADMIN", "ADMIN_FONCTIONNEL"]), async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  res.json(users.map((u) => {
    const { motDePasseHash, ...userSansMotDePasse } = u;
    return userSansMotDePasse;
  }));
});

adminRouter.patch("/users/:id", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const { role, actif } = req.body as { role?: string; actif?: boolean };
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role: role as any, actif },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "MODIFICATION_UTILISATEUR", entite: "User", entiteId: user.id, detail: req.body });
  const { motDePasseHash, ...userSansMotDePasse } = user;
  res.json(userSansMotDePasse);
});

/**
 * 10. Journal d'audit
 */
adminRouter.get("/audit", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { email: true, nom: true, prenom: true } } },
  });
  res.json(logs);
});

/**
 * 3. Gestion des types d'autorisation (paramétrage)
 */
adminRouter.get("/types-autorisation", authorize(["SUPER_ADMIN", "ADMIN_FONCTIONNEL"]), async (req, res) => {
  const types = await prisma.typeAutorisation.findMany({ include: { etapesWorkflow: true } });
  res.json(types);
});

adminRouter.post("/types-autorisation", authorize(["SUPER_ADMIN", "ADMIN_FONCTIONNEL"]), async (req, res) => {
  const type = await prisma.typeAutorisation.create({ data: req.body });
  await enregistrerAudit({ userId: req.user!.userId, action: "CREATION_TYPE_AUTORISATION", entite: "TypeAutorisation", entiteId: type.id });
  res.status(201).json(type);
});
