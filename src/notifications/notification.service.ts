import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { MailService } from '../auth/mail.service'
import { ActualityCheckTemplate } from '../auth/templates/actuality-check.template'
import { PrismaService } from '../prisma.service'
import { TelegramClient } from '../telegram/telegram.client'

@Injectable()
export class NotificationService {
	constructor(
		private prisma: PrismaService,
		private telegramClient: TelegramClient,
		private mailService: MailService,
	) {}

	@Cron(CronExpression.EVERY_DAY_AT_10AM) // Запускаем проверку каждый день в 10:00
	async checkOffersActuality() {
		const tenDaysAgo = new Date()
		tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

		// Получаем все активные объявления, которые не проверялись более 10 дней
		const offers = await this.prisma.offer.findMany({
			where: {
				status: 'ACTIVE',
				lastActualityCheck: {
					lt: tenDaysAgo,
				},
			},
			include: {
				user: true,
			},
		})

		// Отправляем уведомления для каждого объявления
		for (const offer of offers) {
			await this.sendActualityCheck(offer)
		}
	}

	private async sendActualityCheck(offer: any) {
		const message =
			`🔍 Проверка актуальности объявления:\n\n` +
			`📋 ${offer.title}\n` +
			`🔢 ${offer.quantity} голов\n` +
			`💰 ${offer.price} ₽/гол\n\n` +
			`Объявление все еще актуально?`

		// Отправляем в Telegram
		if (offer.user.telegramId) {
			await this.telegramClient.sendMessage(offer.user.telegramId, message, {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '✅ Да, актуально',
								callback_data: `actual_yes_${offer.id}`,
							},
							{
								text: '❌ Нет, приостановить',
								callback_data: `actual_no_${offer.id}`,
							},
						],
					],
				},
			})
		}

		// Отправляем на email используя шаблон
		await this.mailService.sendMail({
			to: offer.user.email,
			subject: 'Проверка актуальности объявления',
			html: ActualityCheckTemplate({
				title: offer.title,
				quantity: offer.quantity,
				price: offer.price,
			}),
		})

		// Обновляем дату последней проверки
		await this.prisma.offer.update({
			where: { id: offer.id },
			data: { lastActualityCheck: new Date() },
		})
	}
}
