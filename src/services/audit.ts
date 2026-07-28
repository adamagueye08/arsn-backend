import { prisma } from "../prisma";

interface AuditParams {
  userId?: string;
  action: string;       // ex: "CONNEXION", "VALIDATION_DEMANDE", "CREATION_UTILISATEUR"
  entite: string;        // ex: "Demande", "User", "TypeAutorisation"
  entiteId?: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

/**
 * Enregistre une entrée dans le journal d'audit.
 * À appeler depuis les contrôleurs pour toute action sensible :
 * connexions, validations/rejets, modifications de compte, paramétrage, etc.
 */
export async function enregistrerAudit(params: AuditParams) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entite: params.entite,
      entiteId: params.entiteId,
      detail: params.detail as any,
      ip: params.ip,
    },
  });
}
