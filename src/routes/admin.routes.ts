import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../prisma";
import { authenticate } from "../middleware/authenticate";
import { authorize, ROLES_ADMIN_TOUS } from "../middleware/authorize";
import { enregistrerAudit } from "../services/audit";
import { hashPassword } from "../utils/auth";

export const adminRouter = Router();
adminRouter.use(authenticate, authorize(ROLES_ADMIN_TOUS));

const uploadAttestation = multer({
  dest: process.env.STORAGE_LOCAL_PATH || "./uploads",
  limits: { fileSize: 15 * 1024 * 1024 },
});

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
 * Détail complet d'une demande (formulaire rempli, pièces, historique)
 */
adminRouter.get("/demandes/:id", async (req, res) => {
  const demande = await prisma.demande.findUnique({
    where: { id: req.params.id },
    include: {
      demandeur: true,
      typeAutorisation: true,
      instructeur: true,
      pieces: true,
      historique: { orderBy: { createdAt: "asc" }, include: { parUser: true } },
      autorisation: true,
    },
  });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  res.json(demande);
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
 * États finaux : plus aucune action de traitement n'est possible dessus.
 */
const STATUTS_FINAUX = ["APPROUVEE", "REJETEE"];

/**
 * Valider un dossier — décision finale et unique, prise par l'admin.
 * (Historiquement cette route gérait aussi une "étape intermédiaire"
 * pilotée par un flag envoyé depuis le client, ce qui permettait à
 * n'importe quel rôle d'approuver définitivement un dossier. Le
 * workflow est maintenant à une seule étape : un rôle admin unique
 * traite le dossier de bout en bout, donc "valider" = approbation.)
 */
adminRouter.post("/demandes/:id/valider", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (STATUTS_FINAUX.includes(demande.statut)) {
    return res.status(409).json({ erreur: "Cette demande est déjà dans un état final." });
  }

  const updated = await prisma.demande.update({
    where: { id: demande.id },
    data: { statut: "APPROUVEE", dateDecision: new Date() },
  });

  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "VALIDATION", commentaire: req.body.commentaire },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "VALIDATION_DEMANDE", entite: "Demande", entiteId: demande.id });
  res.json(updated);
});

/**
 * Uploader le document d'attestation d'autorisation délivrée —
 * uniquement sur un dossier déjà Approuvé. Le demandeur pourra ensuite
 * la télécharger via GET /demandes/:id/attestation.
 */
adminRouter.post(
  "/demandes/:id/attestation",
  authorize(["SUPER_ADMIN"]),
  uploadAttestation.single("fichier"),
  async (req, res) => {
    const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
    if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
    if (demande.statut !== "APPROUVEE") {
      return res.status(409).json({ erreur: "L'attestation ne peut être déposée que sur un dossier approuvé." });
    }
    const fichier = req.file as Express.Multer.File | undefined;
    if (!fichier) return res.status(400).json({ erreur: "Aucun fichier reçu." });

    const autorisation = await prisma.autorisationDelivree.upsert({
      where: { demandeId: demande.id },
      create: {
        demandeId: demande.id,
        pdfCheminStockage: fichier.path,
        pdfNomFichier: fichier.originalname,
        signeParId: req.user!.userId,
      },
      update: {
        pdfCheminStockage: fichier.path,
        pdfNomFichier: fichier.originalname,
        signeParId: req.user!.userId,
        dateSignature: new Date(),
      },
    });
    await enregistrerAudit({ userId: req.user!.userId, action: "UPLOAD_ATTESTATION", entite: "Demande", entiteId: demande.id });
    res.status(201).json(autorisation);
  }
);

/**
 * Rejeter un dossier
 */
adminRouter.post("/demandes/:id/rejeter", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (STATUTS_FINAUX.includes(demande.statut)) {
    return res.status(409).json({ erreur: "Cette demande est déjà dans un état final." });
  }

  const updated = await prisma.demande.update({
    where: { id: req.params.id },
    data: { statut: "REJETEE", dateDecision: new Date() },
  });
  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "REJET", commentaire: req.body.motif },
  });
  await enregistrerAudit({ userId: req.user!.userId, action: "REJET_DEMANDE", entite: "Demande", entiteId: demande.id });
  res.json(updated);
});

/**
 * Retourner un dossier au demandeur (demande de complément)
 */
adminRouter.post("/demandes/:id/retourner", authorize(["SUPER_ADMIN"]), async (req, res) => {
  const demande = await prisma.demande.findUnique({ where: { id: req.params.id } });
  if (!demande) return res.status(404).json({ erreur: "Demande introuvable." });
  if (STATUTS_FINAUX.includes(demande.statut)) {
    return res.status(409).json({ erreur: "Cette demande est déjà dans un état final." });
  }

  const updated = await prisma.demande.update({
    where: { id: req.params.id },
    data: { statut: "COMPLEMENT_REQUIS" },
  });
  await prisma.historiqueDemande.create({
    data: { demandeId: demande.id, parUserId: req.user!.userId, action: "DEMANDE_COMPLEMENT", commentaire: req.body.commentaire },
  });
  res.json(updated);
});

/**
 * Construit la clause WHERE Prisma commune aux deux formats d'export,
 * à partir des filtres de la query string.
 *
 * Filtres disponibles : période (dateDebut/dateFin sur la date de
 * soumission), type d'autorisation, statut, et établissement
 * (recherche texte sur l'organisation du demandeur — c'est la donnée
 * la plus proche de « région » actuellement collectée ; il n'existe
 * pas de champ région dédié dans le modèle de données).
 */
function construireFiltresRapport(query: any) {
  const where: any = {};
  if (query.dateDebut || query.dateFin) {
    where.dateSoumission = {};
    if (query.dateDebut) where.dateSoumission.gte = new Date(String(query.dateDebut));
    if (query.dateFin) where.dateSoumission.lte = new Date(String(query.dateFin));
  }
  if (query.typeAutorisationId) where.typeAutorisationId = String(query.typeAutorisationId);
  if (query.statut) where.statut = String(query.statut);
  if (query.etablissement) {
    where.demandeur = { organisation: { contains: String(query.etablissement), mode: "insensitive" } };
  }
  return where;
}

async function recupererDonneesRapport(query: any) {
  return prisma.demande.findMany({
    where: construireFiltresRapport(query),
    include: { typeAutorisation: true, demandeur: true },
    orderBy: { createdAt: "desc" },
  });
}

const STATUT_LABELS_RAPPORT: Record<string, string> = {
  BROUILLON: "Brouillon",
  SOUMISE: "Soumise",
  EN_COURS: "En cours",
  COMPLEMENT_REQUIS: "Complément requis",
  APPROUVEE: "Approuvée",
  REJETEE: "Rejetée",
  EXPIREE: "Expirée",
};

/**
 * Export Excel des dossiers, avec filtres (période / type / statut / établissement).
 */
adminRouter.get("/rapports/export.xlsx", async (req, res) => {
  const demandes = await recupererDonneesRapport(req.query);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ARSN Sénégal";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Dossiers");

  sheet.columns = [
    { header: "Numéro", key: "numero", width: 18 },
    { header: "Type de demande", key: "type", width: 28 },
    { header: "Demandeur", key: "demandeur", width: 24 },
    { header: "Établissement", key: "etablissement", width: 26 },
    { header: "Statut", key: "statut", width: 18 },
    { header: "Date de soumission", key: "dateSoumission", width: 20 },
    { header: "Date de décision", key: "dateDecision", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D3557" } };
  sheet.getRow(1).eachCell((cell) => (cell.font = { bold: true, color: { argb: "FFFFFFFF" } }));

  for (const d of demandes) {
    sheet.addRow({
      numero: d.numero,
      type: d.typeAutorisation?.nom ?? "",
      demandeur: `${d.demandeur?.prenom ?? ""} ${d.demandeur?.nom ?? ""}`.trim(),
      etablissement: d.demandeur?.organisation ?? "",
      statut: STATUT_LABELS_RAPPORT[d.statut] ?? d.statut,
      dateSoumission: d.dateSoumission ? d.dateSoumission.toLocaleDateString("fr-FR") : "",
      dateDecision: d.dateDecision ? d.dateDecision.toLocaleDateString("fr-FR") : "",
    });
  }

  await enregistrerAudit({ userId: req.user!.userId, action: "EXPORT_RAPPORT_XLSX", entite: "Demande" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="rapport-arsn-${Date.now()}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

/**
 * Export PDF des dossiers, mêmes filtres que l'export Excel.
 */
adminRouter.get("/rapports/export.pdf", async (req, res) => {
  const demandes = await recupererDonneesRapport(req.query);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="rapport-arsn-${Date.now()}.pdf"`);

  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
  doc.pipe(res);

  doc.fontSize(16).font("Helvetica-Bold").text("ARSN Sénégal — Rapport des dossiers", { align: "left" });
  doc.fontSize(9).font("Helvetica").fillColor("#555").text(`Généré le ${new Date().toLocaleString("fr-FR")}`);
  doc.moveDown(1);

  const colonnes = [
    { label: "Numéro", width: 90 },
    { label: "Type", width: 150 },
    { label: "Demandeur", width: 130 },
    { label: "Établissement", width: 140 },
    { label: "Statut", width: 100 },
    { label: "Soumission", width: 80 },
    { label: "Décision", width: 80 },
  ];
  const startX = doc.page.margins.left;
  let y = doc.y;

  function dessinerEnTete() {
    let x = startX;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff");
    doc.rect(startX, y, colonnes.reduce((s, c) => s + c.width, 0), 20).fill("#1D3557");
    doc.fillColor("#fff");
    for (const col of colonnes) {
      doc.text(col.label, x + 4, y + 6, { width: col.width - 8 });
      x += col.width;
    }
    y += 22;
  }

  dessinerEnTete();
  doc.font("Helvetica").fontSize(8.5).fillColor("#000");

  for (const d of demandes) {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
      dessinerEnTete();
      doc.font("Helvetica").fontSize(8.5).fillColor("#000");
    }
    const valeurs = [
      d.numero,
      d.typeAutorisation?.nom ?? "",
      `${d.demandeur?.prenom ?? ""} ${d.demandeur?.nom ?? ""}`.trim(),
      d.demandeur?.organisation ?? "",
      STATUT_LABELS_RAPPORT[d.statut] ?? d.statut,
      d.dateSoumission ? d.dateSoumission.toLocaleDateString("fr-FR") : "—",
      d.dateDecision ? d.dateDecision.toLocaleDateString("fr-FR") : "—",
    ];
    let x = startX;
    valeurs.forEach((val, i) => {
      doc.text(val, x + 4, y + 4, { width: colonnes[i].width - 8 });
      x += colonnes[i].width;
    });
    y += 18;
  }

  if (demandes.length === 0) {
    doc.text("Aucun dossier ne correspond à ces filtres.", startX, y + 10);
  }

  await enregistrerAudit({ userId: req.user!.userId, action: "EXPORT_RAPPORT_PDF", entite: "Demande" });
  doc.end();
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