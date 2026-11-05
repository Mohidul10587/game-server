import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service.js';

/**
 * MailerModule is Global so any module can inject MailerService
 * without explicitly importing MailerModule.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
