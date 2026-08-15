import { Router } from "express";
import { prisma } from "../prisma";

export const typesPublicRouter = Router();
export const statsPublicRouter = Router();

typesPublicRouter.get("/", async (_req, res) => {
  const types = await prisma.typeAutorisation.findMany({
    where: { actif: true },
    select: { id: true, nom: true, description: true, dureeValiditeMois: true, formulaireSchema: true, piecesRequises: true },
    orderBy: { nom: "asc" },
  });
  res.json(types);
});

/**
 * Tableau de bord public : chiffres clés uniquement, aucune donnée
 * nominative (pas de noms de demandeurs, pas de détail de dossier).
 */
statsPublicRouter.get("/", async (_req, res) => {
  const [autorisationsDelivrees, dossiersTraites, etablissementsControles] = await Promise.all([
    prisma.autorisationDelivree.count(),
    prisma.demande.count({ where: { statut: { in: ["APPROUVEE", "REJETEE"] } } }),
    prisma.demande.groupBy({ by: ["demandeurId"], where: { statut: "APPROUVEE" } }),
  ]);

  res.json({
    autorisationsDelivrees,
    dossiersTraites,
    etablissementsControles: etablissementsControles.length,
  });
});