import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { hashPassword, verifyPassword, signToken } from "../utils/auth";
import { authenticate } from "../middleware/authenticate";
import { enregistrerAudit } from "../services/audit";

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
  res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
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
