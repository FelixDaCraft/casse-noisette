import nodemailer from 'nodemailer';

/** SMTP est-il configuré ? (sinon les emails ne sont pas envoyés). */
export function mailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Envoie un email via SMTP. Renvoie false si SMTP non configuré. */
export async function sendMail(to: string, subject: string, html: string, text: string) {
  if (!mailConfigured()) {
    console.warn('[mail] SMTP non configuré — email non envoyé à', to);
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // true pour le port 465 (TLS implicite), false pour 587 (STARTTLS).
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.MAIL_FROM || process.env.SMTP_USER!;
  await transporter.sendMail({ from, to, subject, html, text });
  return true;
}
