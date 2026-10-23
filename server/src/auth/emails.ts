import { appendFileSync } from "node:fs";

export interface Emailer {
  sendResetEmail(to: string, resetLink: string): Promise<void>;
}

export function createFileCaptureEmailer(path: string): Emailer {
  return {
    async sendResetEmail(to: string, resetLink: string): Promise<void> {
      appendFileSync(path, `${JSON.stringify({ to, resetLink })}\n`, "utf8");
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
  };
}

export const noopEmailer: Emailer = {
  async sendResetEmail(): Promise<void> {},
};
