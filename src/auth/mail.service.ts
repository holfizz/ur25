import { MailerService } from '@nestjs-modules/mailer'
import { Injectable } from '@nestjs/common'
import { VerificationTemplate } from './templates/verification.template'

@Injectable()
export class MailService {
	constructor(private readonly mailerService: MailerService) {}

	async sendVerificationEmail(to: string) {
		try {
			await this.mailerService.sendMail({
				from: `"UR25" <${process.env.SMTP_USER}>`,
				to,
				subject: 'Ваш аккаунт верифицирован ✅',
				html: VerificationTemplate(),
			})
		} catch (error) {
			console.error('Error sending verification email:', error)
			throw error
		}
	}
}
