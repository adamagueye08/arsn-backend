import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../prisma";
import { hashPassword, verifyPassword, signToken } from "../utils/auth";
import { authenticate } from "../middleware/authenticate";
import { enregistrerAudit } from "../services/audit";
import { envoyerEmail } from "../services/email";

export const authRouter = Router();

const inscriptionSchema = z.object({
  email: z.string().email(),
  motDePasse: z.string().min(8, "8 caractères minimum"),
  nom: z.string().min(1),
  prenom: z.string().min(1),
  telephone: z.string().optional(),
  typeProfil: z.enum(["PARTICULIER", "ENTREPRISE", "HOPITAL", "LABORATOIRE", "INDUSTRIE", "AUTRE"]).optional(),
  organisation: z.string().optional(),
});

// 1. Créer un compte (côté demandeur, public)
authRouter.post("/register", async (req, res) => {
  const parsed = inscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erreur: parsed.error.flatten() });
  }
  const { email, motDePasse, nom, prenom, telephone, typeProfil, organisation } = parsed.data;

  const existant = await prisma.user.findUnique({ where: { email } });
  if (existant) {
    return res.status(409).json({ erreur: "Un compte existe déjà avec cet email." });
  }

  const motDePasseHash = await hashPassword(motDePasse);
  const user = await prisma.user.create({
    data: {
      email,
      motDePasseHash,
      nom,
      prenom,
      telephone,
      typeProfil,
      organisation,
      role: "DEMANDEUR",
    },
  });

  await enregistrerAudit({ userId: user.id, action: "CREATION_COMPTE", entite: "User", entiteId: user.id });

  const token = signToken({ userId: user.id, role: user.role });
  const { motDePasseHash: _omit, ...userSansMotDePasse } = user;
  res.status(201).json({ token, user: userSansMotDePasse });
});

const connexionSchema = z.object({
  email: z.string().email(),
  motDePasse: z.string(),
});

// Connexion (demandeurs ET agents internes)
authRouter.post("/login", async (req, res) => {
  const parsed = connexionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erreur: parsed.error.flatten() });
  }
  const { email, motDePasse } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.actif) {
    return res.status(401).json({ erreur: "Identifiants invalides ou compte désactivé." });
  }

  const motDePasseValide = await verifyPassword(motDePasse, user.motDePasseHash);
  if (!motDePasseValide) {
    await enregistrerAudit({ action: "ECHEC_CONNEXION", entite: "User", entiteId: user.id, ip: req.ip });
    return res.status(401).json({ erreur: "Identifiants invalides." });
  }

  await enregistrerAudit({ userId: user.id, action: "CONNEXION", entite: "User", entiteId: user.id, ip: req.ip });

  const token = signToken({ userId: user.id, role: user.role });
  res.json({
    token,
    user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role },
  });
});

// Profil de l'utilisateur connecté
authRouter.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  const { motDePasseHash, ...userSansMotDePasse } = user;
  res.json(userSansMotDePasse);
});

const motDePasseOublieSchema = z.object({ email: z.string().email() });

/**
 * Demander une réinitialisation de mot de passe. Toujours une réponse
 * générique (même si l'email n'existe pas), pour ne pas révéler quels
 * comptes existent.
 */
authRouter.post("/mot-de-passe-oublie", async (req, res) => {
  const parsed = motDePasseOublieSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erreur: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && user.actif) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: token, resetPasswordExpiry: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const lienReinitialisation = `${process.env.FRONTEND_URL || "https://arsn-senegal.vercel.app"}/reinitialiser-mot-de-passe?token=${token}`;
    await envoyerEmail({
      to: user.email,
      sujet: "Réinitialisation de votre mot de passe — ARSN",
      texte: `Bonjour ${user.prenom},\n\nVous avez demandé la réinitialisation de votre mot de passe. Ce lien est valable 1 heure :\n${lienReinitialisation}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
    });
    await enregistrerAudit({ userId: user.id, action: "DEMANDE_RESET_MOT_DE_PASSE", entite: "User", entiteId: user.id });
  }

  res.json({ message: "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé." });
});

const reinitialiserSchema = z.object({
  token: z.string().min(1),
  nouveauMotDePasse: z.string().min(8, "8 caractères minimum"),
});

/**
 * Confirmer la réinitialisation avec le jeton reçu par email.
 */
authRouter.post("/reinitialiser-mot-de-passe", async (req, res) => {
  const parsed = reinitialiserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erreur: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { resetPasswordToken: parsed.data.token } });
  if (!user || !user.resetPasswordExpiry || user.resetPasswordExpiry < new Date()) {
    return res.status(400).json({ erreur: "Lien de réinitialisation invalide ou expiré." });
  }

  const motDePasseHash = await hashPassword(parsed.data.nouveauMotDePasse);
  await prisma.user.update({
    where: { id: user.id },
    data: { motDePasseHash, resetPasswordToken: null, resetPasswordExpiry: null },
  });
  await enregistrerAudit({ userId: user.id, action: "RESET_MOT_DE_PASSE", entite: "User", entiteId: user.id });

  res.json({ message: "Mot de passe réinitialisé avec succès." });
});
