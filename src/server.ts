import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { authRouter } from "./routes/auth.routes";
import { demandesRouter } from "./routes/demandes.routes";
import { adminRouter } from "./routes/admin.routes";
import { typesPublicRouter } from "./routes/types-public.routes";

const app = express();

app.use(helmet());

// En développement : autorise n'importe quelle origine locale (localhost:xxxx),
// peu importe le port choisi par Vite. En production : uniquement CORS_ORIGIN.
const corsOrigin = process.env.NODE_ENV === "development" ? true : process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ statut: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/demandes", demandesRouter);
app.use("/api/admin", adminRouter);
app.use("/api/types-autorisation", typesPublicRouter);

// Gestion générique des erreurs non interceptées
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ erreur: "Erreur interne du serveur." });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`✅ API ARSN démarrée sur http://localhost:${PORT}`);
});