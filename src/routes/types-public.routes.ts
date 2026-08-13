import { Router } from "express";
import { prisma } from "../prisma";

export const typesPublicRouter = Router();

typesPublicRouter.get("/", async (_req, res) => {
  const types = await prisma.typeAutorisation.findMany({
    where: { actif: true },
    select: { id: true, nom: true, description: true, dureeValiditeMois: true, formulaireSchema: true, piecesRequises: true },
    orderBy: { nom: "asc" },
  });
  res.json(types);
});