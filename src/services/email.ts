import nodemailer from "nodemailer";

/**
 * Service d'envoi d'email.
 *
 * Tant que les identifiants SMTP ne sont pas configurés (variables
 * d'environnement SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS), les
 * emails ne sont pas réellement envoyés : le contenu est simplement
 * affiché dans les logs du serveur, pour que le flux reste testable
 * en développement. Dès que ces variables sont renseignées (prestataire
 * à choisir — cf. feuille de route), les emails partent réellement,
 * sans changement de code nécessaire.
 */

const smtpConfigure = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = smtpConfigure
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function envoyerEmail(params: { to: string; sujet: string; texte: string; html?: string }) {
  if (!transporter) {
    console.log("─── [EMAIL NON ENVOYÉ — SMTP non configuré] ───────────────────");
    console.log(`À : ${params.to}`);
    console.log(`Sujet : ${params.sujet}`);
    console.log(params.texte);
    console.log("────────────────────────────────────────────────────────────");
    return { envoye: false, raison: "SMTP non configuré" };
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "ARSN Sénégal <no-reply@arsn.sn>",
    to: params.to,
    subject: params.sujet,
    text: params.texte,
    html: params.html,
  });
  return { envoye: true };
}
