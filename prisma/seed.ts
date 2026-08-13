import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function seedDatabase() {
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
    console.log(`✅ Super administrateur existant vérifié / mis à jour : ${emailAdmin}`);
  }

  // --- Types d'autorisation : les 4 formulaires officiels ARSN digitalisés ---

  // Trame commune aux 3 déclarations F1-FDEC (Transport / Détention / Exportation),
  // seul le motif pré-sélectionné diffère.
  const sectionsF1FDEC = (motifDefaut: string) => [
    {
      titre: "Le déclarant",
      champs: [
        { cle: "declarantNom", label: "Nom et prénom(s)", type: "texte", requis: true },
        { cle: "declarantAdresse", label: "Adresse", type: "texte", requis: true },
        { cle: "declarantFonction", label: "Fonction", type: "texte" },
        { cle: "declarantTelFixe", label: "Tél fixe", type: "texte" },
        { cle: "declarantTelMobile", label: "Tél mobile", type: "texte", requis: true },
        { cle: "declarantEmail", label: "E-mail", type: "email", requis: true },
        {
          cle: "declarantQualite",
          label: "Je procède à la déclaration en qualité de",
          type: "choix",
          options: ["Personne physique", "Représentant de la personne morale"],
          requis: true,
        },
      ],
    },
    {
      titre: "Établissement déclarant",
      champs: [
        { cle: "etabSecteur", label: "Secteur", type: "choix", options: ["Secteur public", "Secteur privé", "Autre"] },
        { cle: "etabDenomination", label: "Dénomination ou raison sociale", type: "texte", requis: true },
        { cle: "etabStatutJuridique", label: "Statut juridique", type: "texte" },
        { cle: "etabAdresse", label: "Adresse de l'établissement", type: "texte", requis: true },
        { cle: "etabChefNom", label: "Nom et prénom(s) du chef d'établissement", type: "texte" },
        {
          cle: "lieuDetention",
          label: "Lieu de détention des sources",
          type: "choix",
          options: ["Permanent", "Chantier"],
        },
      ],
    },
    {
      titre: "Motif de la déclaration",
      champs: [
        {
          cle: "motifs",
          label: "Motif(s) — cocher la ou les case(s) correspondante(s)",
          type: "cases",
          options: [
            "Utilisation", "Réutilisation", "Production", "Transport",
            "Détention", "Cession", "Retrait du service", "Exportation",
            "Fabrication", "Importation", "Stockage", "Transit",
            "Recyclage", "Modification", "Libération", "Vente",
          ],
          valeurParDefaut: [motifDefaut],
          requis: true,
        },
        { cle: "motifAutre", label: "Autre (préciser)", type: "texte" },
      ],
    },
    {
      titre: "Activités et pratiques",
      champs: [
        { cle: "domaineActivite", label: "Domaine d'activité", type: "texte" },
        { cle: "pratiquesAssociees", label: "Pratiques associées aux sources (ex. diagnostic, jauge de niveau, etc.)", type: "zone" },
        { cle: "activitesSubstitution", label: "Activités de substitution ne nécessitant pas de sources", type: "zone" },
      ],
    },
    {
      titre: "Sources de rayonnements ionisants et équipements associés",
      champs: [
        { cle: "sourcesEnUtilisation", label: "Nombre de sources en cours d'utilisation", type: "nombre" },
        { cle: "sourcesAutoriseesValides", label: "Nombre de sources sous autorisation ARSN en cours de validité", type: "nombre" },
        { cle: "sourcesRetireesService", label: "Nombre de sources retirées du service", type: "nombre" },
        { cle: "sourcesOrphelines", label: "Sources orphelines détenues (non déclarées, aucune activité prévue) ?", type: "choix", options: ["Non", "Oui"] },
        {
          cle: "sourcesRadioactives",
          label: "Caractéristiques des sources radioactives",
          type: "tableau",
          colonnes: [
            { cle: "radioelement", label: "Radioélément (ex. Co-60)" },
            { cle: "numeroSerie", label: "N° de série du radioélément" },
            { cle: "fabricant", label: "Fabricant/Fournisseur" },
            { cle: "appareilType", label: "Appareil / Type" },
            { cle: "lieuUtilisation", label: "Lieu d'utilisation" },
          ],
        },
        {
          cle: "appareilsRX",
          label: "Appareils électriques produisant des rayonnements ionisants",
          type: "tableau",
          colonnes: [
            { cle: "fabricantMarque", label: "Fabricant et marque" },
            { cle: "typeModele", label: "Type ou modèle" },
            { cle: "numeroSerie", label: "N° de série" },
            { cle: "puissanceMax", label: "Puissance max (kV, mA)" },
            { cle: "anneeFabrication", label: "Année de fabrication" },
          ],
        },
        { cle: "activiteTotaleMBq", label: "Activité totale détenue (MBq)", type: "nombre" },
        { cle: "matiereNucleaire", label: "Les appareils contiennent-ils de la matière nucléaire ?", type: "choix", options: ["Non", "Oui"] },
      ],
    },
  ];

  const piecesF1FDEC = [
    "Formulaire F1-FDEC dûment complété, daté et signé",
    "Copie des documents d'identification des sources (marquage, certificats)",
    "Justificatif de statut de l'établissement (registre de commerce ou équivalent)",
  ];

  const schemaF3FDIMPRX = [
    {
      titre: "Le demandeur",
      champs: [
        { cle: "etabSecteur", label: "Secteur de l'établissement demandeur", type: "choix", options: ["Secteur public", "Secteur privé", "Autre"] },
        { cle: "etabDenomination", label: "Dénomination ou raison sociale", type: "texte", requis: true },
        { cle: "etabStatutJuridique", label: "Statut juridique", type: "texte" },
        { cle: "etabAdressePhysique", label: "Adresse physique de l'établissement", type: "texte", requis: true },
        { cle: "etabAdresseSiege", label: "Adresse du siège social (si différente)", type: "texte" },
        { cle: "etabTelFixe", label: "Tél fixe", type: "texte" },
        { cle: "etabTelMobile", label: "Tél mobile", type: "texte", requis: true },
        { cle: "etabEmail", label: "E-mail", type: "email", requis: true },
        { cle: "etabChefNom", label: "Nom et prénom(s) du chef d'établissement", type: "texte" },
      ],
    },
    {
      titre: "Nature et motif de la demande",
      champs: [
        { cle: "autorisationComplementaire", label: "Demande complémentaire à une autorisation en cours de validité ?", type: "choix", options: ["Non", "Oui"] },
        { cle: "autorisationReferencee", label: "Si oui, autorisation référencée", type: "texte" },
        { cle: "demandeInitiale", label: "Demande initiale accompagnée d'une demande d'utilisation/détention ou d'agrément ?", type: "choix", options: ["Non", "Oui"] },
        {
          cle: "motifImportation",
          label: "Cette importation est préparée en vue de",
          type: "cases",
          options: ["Détention/utilisation", "Distribution", "Autres"],
          requis: true,
        },
      ],
    },
    {
      titre: "Fournisseur / fabricant",
      champs: [
        {
          cle: "fournisseurs",
          label: "Fournisseur(s) / Fabricant(s)",
          type: "tableau",
          colonnes: [
            { cle: "nom", label: "Fournisseur/Fabricant" },
            { cle: "pays", label: "Pays" },
            { cle: "adresse", label: "Adresse" },
            { cle: "email", label: "E-mail" },
            { cle: "tel", label: "Tél" },
          ],
        },
      ],
    },
    {
      titre: "Renseignements sur le matériel",
      champs: [
        { cle: "materielFixeMobile", label: "Matériel", type: "choix", options: ["Fixe", "Mobile"] },
        {
          cle: "typeMateriel",
          label: "Type de matériel",
          type: "cases",
          options: [
            "Radiographie conventionnelle", "Radioscopie", "Radio-photo", "Rétro-alvéolaire",
            "Ostéo-densitomètre", "Scanographie", "Mammographie", "Panoramique dentaire", "Autres",
          ],
        },
        {
          cle: "caracteristiquesRX",
          label: "Caractéristiques des appareils RX",
          type: "tableau",
          colonnes: [
            { cle: "typeAppareil", label: "Type d'appareil RX" },
            { cle: "marque", label: "Marque" },
            { cle: "tensionMax", label: "Tension max (kV)" },
            { cle: "intensiteMax", label: "Intensité max (mA)" },
            { cle: "numeroSerieTube", label: "N° de série (tube)" },
            { cle: "anneeFabrication", label: "Année de fabrication" },
          ],
        },
      ],
    },
    {
      titre: "Engagement",
      champs: [
        {
          cle: "engagement",
          label: "Je certifie l'exactitude des déclarations ci-dessus et je m'engage à respecter les normes de sûreté et de radioprotection",
          type: "confirmation",
          requis: true,
        },
      ],
    },
  ];

  const piecesF3FDIMPRX = [
    "Lettre adressée au Directeur général de l'ARSN",
    "Formulaire F3-FDIMPRX dûment complété, signé et cacheté",
    "Agrément des autorités habilitées pour la pratique (ministère de la santé, etc.)",
    "Registre de commerce (secteur privé)",
    "Documentation technique du matériel",
    "Certificat de conformité du matériel radiologique (ISO ou équivalent)",
    "Certificat de marquage CEI ou certificat d'homologation",
    "Rapport de contrôle qualité (matériel d'occasion)",
  ];

  const types = [
    {
      nom: "Transport",
      description: "Déclaration de sources de rayonnements ionisants — motif Transport (F1-FDEC).",
      formulaireSchema: { reference: "F1-FDEC", sections: sectionsF1FDEC("Transport") },
      piecesRequises: piecesF1FDEC,
    },
    {
      nom: "Détention",
      description: "Déclaration de sources de rayonnements ionisants — motif Détention (F1-FDEC).",
      formulaireSchema: { reference: "F1-FDEC", sections: sectionsF1FDEC("Détention") },
      piecesRequises: piecesF1FDEC,
    },
    {
      nom: "Exportation",
      description: "Déclaration de sources de rayonnements ionisants — motif Exportation (F1-FDEC).",
      formulaireSchema: { reference: "F1-FDEC", sections: sectionsF1FDEC("Exportation") },
      piecesRequises: piecesF1FDEC,
    },
    {
      nom: "Importation d'un générateur RX médical",
      description: "Demande d'importation d'un générateur de rayonnements ionisants à des fins médicales — radiodiagnostic (F3-FDIMPRX).",
      formulaireSchema: { reference: "F3-FDIMPRX", sections: schemaF3FDIMPRX },
      piecesRequises: piecesF3FDIMPRX,
    },
  ];

  for (const t of types) {
    const existant = await prisma.typeAutorisation.findUnique({ where: { nom: t.nom } });
    if (!existant) {
      const type = await prisma.typeAutorisation.create({
        data: {
          nom: t.nom,
          description: t.description,
          formulaireSchema: t.formulaireSchema,
          piecesRequises: t.piecesRequises,
          dureeValiditeMois: 12,
          actif: true,
        },
      });
      console.log(`✅ Type d'autorisation créé : ${t.nom}`);
    } else {
      await prisma.typeAutorisation.update({
        where: { id: existant.id },
        data: { formulaireSchema: t.formulaireSchema, piecesRequises: t.piecesRequises, description: t.description },
      });
      console.log(`✅ Type d'autorisation mis à jour (schéma formulaire) : ${t.nom}`);
    }
  }
}

async function main() {
  await seedDatabase();
}

// Équivalent CommonJS de "exécuter seulement si ce fichier est lancé directement"
// (l'ancienne version utilisait `import.meta.url`, une syntaxe ESM incompatible
// avec la compilation "module": "commonjs" du projet — ça faisait planter le build).
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}