import { PrismaClient } from "@prisma/client";

// Une seule instance du client Prisma, réutilisée dans toute l'application.
export const prisma = new PrismaClient();
