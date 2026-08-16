import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";

export const contactPublicRouter = Router();

const messageContactSchema = z.object({
  nom: z.string().min(1).max(200),
  email: z.string().email(),
  telephone: z.string().max(40).optional(),
  sujet: z.string().max(200).optional(),
  message: z.string().min(1).max(5000),
});

/**
 * Réception d'un message envoyé depuis le formulaire de contact public
 * (page /contact). Aucune authentification requise : c'est un
 * formulaire ouvert au public.
 */
contactPublicRouter.post("/", async (req, res) => {
  const parsed = messageContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erreur: parsed.error.flatten() });

  const message = await prisma.messageContact.create({ data: parsed.data });
  res.status(201).json({ id: message.id });
});
