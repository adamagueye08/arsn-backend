import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Super administrateur initial ---
  const emailAdmin = "admin@arsn.sn";
  const motDePasseAdmin = "Adminarsn2026";

  const adminExistant = await prisma.user.findUnique({ where: { email: emailAdmin } });
  const motDePasseHash = await bcrypt.hash(motDePasseAdmin, 12);
  if (!adminExistant) {
    await prisma.user.create({
      data: {
        email: emailAdmin,
        motDePasseHash,
        nom: "Administrateur",
        prenom: "Super",
        role: "SUPER_ADMIN",
      },
    });
    console.log(`✅ Super administrateur créé : ${emailAdmin} / ${motDePasseAdmin}`);
    console.log("⚠️  Change ce mot de passe dès la première connexion.");
  } else {
    await prisma.user.update({
      where: { email: emailAdmin },
      data: {
        motDePasseHash,
        actif: true,
        role: "SUPER_ADMIN",
      },
    });
    console.log(`✅ Super administrateur existant mis à jour : ${emailAdmin} / ${motDePasseAdmin}`);
  }

  // --- Types d'autorisation de base (repris du site actuel) ---
  const types = [
    { nom: "Importation", description: "Introduction de sources radioactives sur le territoire national." },
    { nom: "Exportation", description: "Sortie de sources radioactives du territoire national." },
    { nom: "Détention et utilisation", description: "Encadrement de la possession et de l'usage courant." },
    { nom: "Transport", description: "Déplacement de matières radioactives sur le territoire." },
  ];

  for (const t of types) {
    const existant = await prisma.typeAutorisation.findUnique({ where: { nom: t.nom } });
    if (!existant) {
      const type = await prisma.typeAutorisation.create({
        data: {
          nom: t.nom,
          description: t.description,
          formulaireSchema: { champs: [] }, // à définir précisément avec l'ARSN
          piecesRequises: [],
          dureeValiditeMois: 12,
        },
      });
      // Workflow par défaut à 3 étapes, modifiable ensuite via l'admin
      await prisma.workflowEtape.createMany({
        data: [
          { typeAutorisationId: type.id, ordre: 1, nom: "Analyse technique", roleResponsable: "INSTRUCTEUR", delaiJours: 10 },
          { typeAutorisationId: type.id, ordre: 2, nom: "Signature et délivrance", roleResponsable: "SIGNATAIRE", delaiJours: 3 },
        ],
      });
      console.log(`✅ Type d'autorisation créé : ${t.nom}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });