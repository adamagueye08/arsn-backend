/**
 * Génère un numéro de dossier lisible et unique, ex: DEM-2026-0001432
 * Le compteur séquentiel s'appuie sur le nombre de demandes déjà créées
 * cette année (suffisant pour un MVP ; à remplacer par une séquence SQL
 * dédiée si un fort volume concurrent est attendu).
 */
export function genererNumeroDemande(compteurAnnuel: number): string {
  const annee = new Date().getFullYear();
  const compteur = String(compteurAnnuel).padStart(6, "0");
  return `DEM-${annee}-${compteur}`;
}
