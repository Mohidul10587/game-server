import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * MailerService — email notification stub
 *
 * PRODUCTION: Replace nodemailer transport with your SMTP config.
 * Set these in .env:
 *   MAIL_HOST=smtp.gmail.com
 *   MAIL_PORT=587
 *   MAIL_USER=your@email.com
 *   MAIL_PASS=your-app-password
 *   MAIL_FROM="BanglaMiners <noreply@banglaminers.com>"
 *
 * Install: npm install nodemailer @types/nodemailer
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private config: ConfigService) {}

  /**
   * Withdrawal confirmation email
   * Sent when a user submits a withdrawal request
   */
  async sendWithdrawalConfirmation(
    toEmail: string,
    username: string,
    amount: number,
    currency: string,
    walletAddress: string,
  ): Promise<void> {
    const subject = `[BanglaMiners] Withdrawal Request Received — ${amount} ${currency}`;
    const body = `
Hi ${username},

Your withdrawal request has been received and is under review.

Details:
  Amount: ${amount} ${currency}
  Wallet: ${walletAddress}
  Status: Pending

You will receive another email once your withdrawal is processed (usually within 24 hours).

If you did not request this withdrawal, please contact support immediately.

— BanglaMiners Team
    `.trim();

    await this.send(toEmail, subject, body);
  }

  /**
   * Withdrawal approved / processed email
   */
  async sendWithdrawalApproved(
    toEmail: string,
    username: string,
    amount: number,
    currency: string,
    txHash?: string,
  ): Promise<void> {
    const subject = `[BanglaMiners] Withdrawal Approved — ${amount} ${currency}`;
    const body = `
Hi ${username},

Great news! Your withdrawal has been processed.

Details:
  Amount: ${amount} ${currency}
  Transaction: ${txHash ?? 'Pending confirmation'}
  Status: Completed ✅

Please check your wallet in a few minutes.

— BanglaMiners Team
    `.trim();

    await this.send(toEmail, subject, body);
  }

  /**
   * Welcome email after registration
   */
  async sendWelcome(toEmail: string, username: string): Promise<void> {
    const subject = `Welcome to BanglaMiners, ${username}! 🎮`;
    const body = `
Hi ${username},

Welcome to BanglaMiners — the crypto mining game!

You've received 1,000 free coins as a welcome bonus.

Start playing games to earn mining power and watch your BTC balance grow!

Good luck & have fun!

— BanglaMiners Team
    `.trim();

    await this.send(toEmail, subject, body);
  }

  /**
   * Core send method — logs in dev, sends via SMTP in production
   */
  private async send(
    to: string,
    subject: string,
    text: string,
  ): Promise<void> {
    const isProd = this.config.get('NODE_ENV') === 'production';

    if (!isProd) {
      // DEV: just log — no real email sent
      this.logger.debug(`📧 [MAIL STUB] To: ${to}`);
      this.logger.debug(`   Subject: ${subject}`);
      this.logger.debug(`   Body preview: ${text.substring(0, 80)}...`);
      return;
    }

    // PRODUCTION: uncomment and configure nodemailer
    /*
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: this.config.get('MAIL_HOST'),
      port: this.config.get<number>('MAIL_PORT', 587),
      secure: false,
      auth: {
        user: this.config.get('MAIL_USER'),
        pass: this.config.get('MAIL_PASS'),
      },
    });

    await transporter.sendMail({
      from: this.config.get('MAIL_FROM', '"BanglaMiners" <noreply@banglaminers.com>'),
      to,
      subject,
      text,
    });
    */

    this.logger.warn(`MailerService: Production email not configured. To: ${to}`);
  }
}
