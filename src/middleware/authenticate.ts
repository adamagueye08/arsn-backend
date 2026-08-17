import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../utils/auth";

// Étend le type Request d'Express pour y attacher l'utilisateur authentifié.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header && header.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length);
  } else if (typeof req.query.token === "string") {
    // Repli utilisé uniquement pour les téléchargements de fichiers : sur
    // iOS Safari, un blob téléchargé via fetch() + <a download> n'ouvre
    // souvent qu'un aperçu au lieu de proposer un vrai téléchargement. La
    // solution fiable est une navigation directe du navigateur vers l'URL,
    // qui ne peut pas porter d'en-tête Authorization — d'où ce jeton en
    // paramètre, pour ces routes de téléchargement uniquement.
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ erreur: "Authentification requise." });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ erreur: "Jeton invalide ou expiré." });
  }
}
