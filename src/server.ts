import "dotenv/config";
import express from "express";
import "express-async-errors"; // capture automatiquement les erreurs des routes async
                                 // (Express 4 ne le fait pas nativement : une erreur non
                                 // interceptée dans une route async plantait tout le
                                 // processus au lieu de renvoyer une simple erreur 500)
import cors from "cors";
import helmet from "helmet";

import { seedDatabase } from "../prisma/seed";
import { authRouter } from "./routes/auth.routes";
import { demandesRouter } from "./routes/demandes.routes";
import { adminRouter } from "./routes/admin.routes";
import { typesPublicRouter, statsPublicRouter } from "./routes/types-public.routes";

// Filet de sécurité supplémentaire : si une erreur échappe malgré tout au
// mécanisme ci-dessus, on la journalise sans jamais faire planter le
// processus (mieux vaut une requête en erreur que tout le serveur hors service).
process.on("unhandledRejection", (raison) => {
  console.error("⚠️ Unhandled Rejection (processus maintenu en vie) :", raison);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception (processus maintenu en vie) :", err);
});

const app = express();

app.use(helmet());

// En développement ou sans NODE_ENV défini : autorise toutes les origines locales.
// En production : origine(s) autorisée(s) via CORS_ORIGIN.
const isDevelopment = process.env.NODE_ENV !== "production";
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = isDevelopment
  ? { origin: true, credentials: true, exposedHeaders: ["Content-Disposition"] }
  : {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origine CORS non autorisée : ${origin}`));
        }
      },
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    };

app.use(cors(corsOptions));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ statut: "ok" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/demandes", demandesRouter);
app.use("/api/admin", adminRouter);
app.use("/api/types-autorisation", typesPublicRouter);
app.use("/api/stats-publiques", statsPublicRouter);

// Gestion générique des erreurs non interceptées
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ erreur: "Erreur interne du serveur." });
});

const PORT = Number(process.env.PORT) || 4000;

async function startServer() {
  if (process.env.NODE_ENV === "production") {
    console.log("🔧 Production startup detected: seeding database...");
    try {
      await seedDatabase();
    } catch (error) {
      console.error("❌ Database seed failed:", error);
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    console.log("✅ API ARSN démarrée sur http://localhost:" + PORT);
  });
}

startServer();
