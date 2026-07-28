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
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ erreur: "Authentification requise." });
  }

  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ erreur: "Jeton invalide ou expiré." });
  }
}
