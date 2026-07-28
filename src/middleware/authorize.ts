import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";

/**
 * Autorise l'accès uniquement aux rôles listés.
 * Exemple : router.get("/admin/stats", authenticate, authorize(["SUPER_ADMIN","ADMIN_FONCTIONNEL"]), handler)
 */
export function authorize(rolesAutorises: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ erreur: "Authentification requise." });
    }
    if (!rolesAutorises.includes(req.user.role)) {
      return res.status(403).json({ erreur: "Accès refusé pour ce rôle." });
    }
    next();
  };
}

// Rôles regroupés utilisés dans plusieurs routes admin
export const ROLES_ADMIN_TOUS: Role[] = [
  "SUPER_ADMIN",
  "ADMIN_FONCTIONNEL",
  "AGENT_INSTRUCTEUR",
  "CHEF_SERVICE",
  "DIRECTEUR",
  "SIGNATAIRE",
];
export const ROLES_INSTRUCTION: Role[] = ["AGENT_INSTRUCTEUR", "CHEF_SERVICE", "DIRECTEUR", "SUPER_ADMIN"];
export const ROLES_PARAMETRAGE: Role[] = ["SUPER_ADMIN", "ADMIN_FONCTIONNEL"];
