import { Router } from "express";
import { prisma } from "../prisma";

export const typesPublicRouter = Router();

/**
 * Liste publique des types d'autorisation actifs (id + nom uniquement).
 * Utilisée par le frontend pour proposer le bon choix dans le formulaire
 * de dépôt de demande, sans exposer les détails internes (workflow, etc.).
 */
typesPublicRouter.get("/", async (_req, res) => {
  const types = await prisma.typeAutorisation.findMany({
    where: { actif: true },
    select: { id: true, nom: true, description: true, dureeValiditeMois: true },
    orderBy: { nom: "asc" },
  });
  res.json(types);
});