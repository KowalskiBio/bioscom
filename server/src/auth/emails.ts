import { appendFileSync } from "node:fs";

export interface Emailer {
  sendResetEmail(to: string, resetLink: string): Promise<void>;
  sendUnknownResetAttemptEmail(to: string, attemptedEmail: string): Promise<void>;
}

export function createFileCaptureEmailer(path: string): Emailer {
  return {
    async sendResetEmail(to: string, resetLink: string): Promise<void> {
      appendFileSync(path, `${JSON.stringify({ to, resetLink })}\n`, "utf8");
    },
    async sendUnknownResetAttemptEmail(to: string, attemptedEmail: string): Promise<void> {
      appendFileSync(path, `${JSON.stringify({ to, attemptedEmail })}\n`, "utf8");
    },
  };
}

export function createResendEmailer(apiKey: string, from: string): Emailer {
  return {
    async sendResetEmail(to: string, resetLink: string): Promise<void> {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "BioSCom password reset",
          text: `A password reset was requested for your BioSCom account.

Open this link to set a new password (valid for 1 hour, single use):
${resetLink}

If you did not request this, ignore this email.`,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend API failed with status ${response.status}`);
      }
    },
    async sendUnknownResetAttemptEmail(to: string, attemptedEmail: string): Promise<void> {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "BioSCom reset attempt for unknown email",
          text: `A password reset was requested for an email that does not match any BioSCom account.

Attempted email: ${attemptedEmail}

If this was you, check the address for typos. If you did not request this, someone may be probing the site.`,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend API failed with status ${response.status}`);
      }
    },
  };
}

export const noopEmailer: Emailer = {
  async sendResetEmail(): Promise<void> {},
  async sendUnknownResetAttemptEmail(): Promise<void> {},
};
