import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticate } from "../middleware/authenticate";
import { authorize, ROLES_INSTRUCTION, ROLES_ADMIN_TOUS } from "../middleware/authorize";
import { enregistrerAudit } from "../services/audit";
import { hashPassword } from "../utils/auth";

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
adminRouter.post("/demandes/:id/affecter", authorize(["SUPER_ADMIN"]), async (req, res) => {
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
  const [recues, enAttente, approuvees, rejetees, expirees, parTypeRaw, types, toutesDemandes] = await Promise.all([
    prisma.demande.count(),
    prisma.demande.count({ where: { statut: { in: ["SOUMISE", "EN_COURS", "COMPLEMENT_REQUIS"] } } }),
    prisma.demande.count({ where: { statut: "APPROUVEE" } }),
    prisma.demande.count({ where: { statut: "REJETEE" } }),
    prisma.demande.count({ where: { statut: "EXPIREE" } }),
    prisma.demande.groupBy({ by: ["typeAutorisationId"], _count: true }),
    prisma.typeAutorisation.findMany({ select: { id: true, nom: true } }),
    prisma.demande.findMany({ select: { createdAt: true } }),
  ]);

  // Associe chaque type d'autorisation à son nom, pour affichage direct sans requête supplémentaire côté client.
  const nomParTypeId = Object.fromEntries(types.map((t) => [t.id, t.nom]));
  const parType = parTypeRaw.map((g) => ({
    typeAutorisationId: g.typeAutorisationId,
    nom: nomParTypeId[g.typeAutorisationId] ?? "Inconnu",
    total: g._count,
  }));

  // Regroupe les demandes par mois sur les 6 derniers mois (pour le graphique mensuel).
  const maintenant = new Date();
  const parMois: { mois: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    const label = d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    const total = toutesDemandes.filter((demande) => {
      const dd = new Date(demande.createdAt);
      return dd.getFullYear() === d.getFullYear() && dd.getMonth() === d.getMonth();
    }).length;
    parMois.push({ mois: label, total });
  }

  res.json({
    demandesRecues: recues,
    demandesEnAttente: enAttente,
    demandesApprouvees: approuvees,
    demandesRejetees: rejetees,
    demandesExpirees: expirees,
    parType,
    parMois,
  });
});

/**
 * 2. Gestion des utilisateurs
 */
adminRouter.get("/users", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  res.json(users.map((u) => {
    const { motDePasseHash, ...userSansMotDePasse } = u;
    return userSansMotDePasse;
  }));
});

/**
 * Créer un compte agent (Instructeur ou Signataire) — le Super Admin
 * crée lui-même les comptes du personnel ARSN, contrairement aux
 * demandeurs qui s'inscrivent librement.
 */
const creerAgentSchema = z.object({
  email: z.string().email(),
  motDePasse: z.string().min(8),
  nom: z.string().min(1),
  prenom: z.string().min(1),
  role: z.enum(["SUPER_ADMIN", "INSTRUCTEUR", "SIGNATAIRE"]),
});

adminRouter.post("/users", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const parsed = creerAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erreur: parsed.error.flatten() });

  const existant = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existant) return res.status(409).json({ erreur: "Un compte existe déjà avec cet email." });

  const motDePasseHash = await hashPassword(parsed.data.motDePasse);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      motDePasseHash,
      nom: parsed.data.nom,
      prenom: parsed.data.prenom,
      role: parsed.data.role,
    },
  });

  await enregistrerAudit({ userId: req.user!.userId, action: "CREATION_UTILISATEUR", entite: "User", entiteId: user.id, detail: { role: user.role } });
  const { motDePasseHash: _omit, ...userSansMotDePasse } = user;
  res.status(201).json(userSansMotDePasse);
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
 * Réinitialiser le mot de passe d'un utilisateur (le Super Admin
 * choisit un mot de passe temporaire à communiquer à l'agent).
 */
adminRouter.post("/users/:id/reinitialiser-mot-de-passe", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const { nouveauMotDePasse } = req.body as { nouveauMotDePasse: string };
  if (!nouveauMotDePasse || nouveauMotDePasse.length < 8) {
    return res.status(400).json({ erreur: "Le mot de passe doit contenir au moins 8 caractères." });
  }
  const motDePasseHash = await hashPassword(nouveauMotDePasse);
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { motDePasseHash } });
  await enregistrerAudit({ userId: req.user!.userId, action: "REINITIALISATION_MOT_DE_PASSE", entite: "User", entiteId: user.id });
  res.json({ statut: "ok" });
});

/**
 * Supprimer un compte. On empêche la suppression de son propre compte
 * pour éviter de se retrouver bloqué hors de la plateforme.
 */
adminRouter.delete("/users/:id", authorize(["SUPER_ADMIN"]), async (req, res) => {
  if (req.params.id === req.user!.userId) {
    return res.status(400).json({ erreur: "Impossible de supprimer son propre compte." });
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  await enregistrerAudit({ userId: req.user!.userId, action: "SUPPRESSION_UTILISATEUR", entite: "User", entiteId: req.params.id });
  res.json({ statut: "ok" });
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
adminRouter.get("/types-autorisation", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const types = await prisma.typeAutorisation.findMany({ include: { etapesWorkflow: true } });
  res.json(types);
});

adminRouter.post("/types-autorisation", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const type = await prisma.typeAutorisation.create({
    data: {
      nom: req.body.nom,
      description: req.body.description,
      formulaireSchema: req.body.formulaireSchema ?? { champs: [] },
      piecesRequises: req.body.piecesRequises ?? [],
      dureeValiditeMois: req.body.dureeValiditeMois ?? 12,
      frais: req.body.frais,
      actif: true,
    },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "CREATION_TYPE_AUTORISATION", entite: "TypeAutorisation", entiteId: type.id });
  res.status(201).json(type);
});

adminRouter.patch("/types-autorisation/:id", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const { nom, description, dureeValiditeMois, frais, actif } = req.body;
  const type = await prisma.typeAutorisation.update({
    where: { id: req.params.id },
    data: { nom, description, dureeValiditeMois, frais, actif },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "MODIFICATION_TYPE_AUTORISATION", entite: "TypeAutorisation", entiteId: type.id, detail: req.body });
  res.json(type);
});