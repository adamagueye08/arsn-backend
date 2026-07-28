import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

export interface JwtPayload {
  userId: string;
  role: Role;
}

export async function hashPassword(motDePasse: string): Promise<string> {
  return bcrypt.hash(motDePasse, 12);
}

export async function verifyPassword(motDePasse: string, hash: string): Promise<boolean> {
  return bcrypt.compare(motDePasse, hash);
}

export function signToken(payload: JwtPayload): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET manquant : vérifie ton fichier .env");
  }
  // @ts-expect-error - jsonwebtoken types are overly strict about string literals for expiresIn
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
