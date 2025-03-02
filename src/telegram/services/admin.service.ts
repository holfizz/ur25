import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'

@Injectable()
export class AdminService {
	constructor(
		private prisma: PrismaService,
		private configService: ConfigService,
		private telegramClient: TelegramClient,
	) {}

	// Метод для обработки запроса на получение контактов
	async handleContactRequest(matchId: string) {
		try {
			const match = await this.prisma.match.findUnique({
				where: { id: parseInt(matchId) },
				include: {
					offer: {
						include: {
							user: true,
							images: true,
						},
					},
					request: {
						include: {
							user: true,
						},
					},
				},
			})

			if (!match) {
				throw new Error('Match not found')
			}

			// Получаем список админов
			const admins = await this.prisma.user.findMany({
				where: { role: 'ADMIN' },
			})

			// Формируем сообщение для админов
			const message = `
🔔 <b>Новый запрос на контакты</b>

👤 <b>Покупатель:</b>
• Имя: ${match.request.user.name}
• ID: ${match.request.user.id}
• Регион: ${match.request.user.address || 'Не указан'}

📋 <b>Объявление поставщика:</b>
• Название: ${match.offer.title}
• Количество: ${match.offer.quantity} голов
• Цена: ${match.offer.pricePerHead ? `${match.offer.pricePerHead}₽/голову` : `${match.offer.pricePerKg}₽/кг`}
• Регион: ${match.offer.region}

💼 <b>Поставщик:</b>
• Имя: ${match.offer.user.name}
• Статус: ${match.offer.user.status || 'REGULAR'}
• ID: ${match.offer.user.id}

⚡️ Действия:
/approve_contact_${match.id} - Подтвердить доступ к контактам
/reject_contact_${match.id} - Отклонить запрос
`

			// Отправляем уведомление каждому админу
			for (const admin of admins) {
				if (admin.telegramId) {
					await this.telegramClient.sendMessage(admin.telegramId, message, {
						parse_mode: 'HTML',
					})

					// Если есть фотографии, отправляем первую
					if (match.offer.images && match.offer.images.length > 0) {
						await this.telegramClient.sendPhoto(
							admin.telegramId,
							match.offer.images[0].url,
						)
					}
				}
			}

			return true
		} catch (error) {
			console.error('Error handling contact request:', error)
			return false
		}
	}

	// Метод для подтверждения доступа к контактам
	async approveContactRequest(matchId: string) {
		try {
			const match = await this.prisma.match.update({
				where: { id: parseInt(matchId) },
				data: { status: 'APPROVED' },
				include: {
					offer: { include: { user: true } },
					request: { include: { user: true } },
				},
			})

			// Уведомляем покупателя
			if (match.request.user.telegramId) {
				const buyerMessage = `
✅ <b>Запрос на контакты одобрен!</b>

📞 Контакты поставщика:
• Имя: ${match.offer.user.name}
• Телефон: ${match.offer.user.phone}
• Email: ${match.offer.user.email}

📋 Объявление: ${match.offer.title}
`
				await this.telegramClient.sendMessage(
					match.request.user.telegramId,
					buyerMessage,
					{ parse_mode: 'HTML' },
				)
			}

			// Уведомляем поставщика
			if (match.offer.user.telegramId) {
				const sellerMessage = `
ℹ️ <b>Информация о сделке</b>

Покупателю ${match.request.user.name} были переданы ваши контактные данные для объявления "${match.offer.title}".
`
				await this.telegramClient.sendMessage(
					match.offer.user.telegramId,
					sellerMessage,
					{ parse_mode: 'HTML' },
				)
			}

			return true
		} catch (error) {
			console.error('Error approving contact request:', error)
			return false
		}
	}

	// Метод для отклонения запроса на контакты
	async rejectContactRequest(matchId: string) {
		try {
			const match = await this.prisma.match.update({
				where: { id: parseInt(matchId) },
				data: { status: 'REJECTED' },
				include: {
					offer: true,
					request: { include: { user: true } },
				},
			})

			// Уведомляем покупателя
			if (match.request.user.telegramId) {
				const message = `
❌ <b>Запрос на контакты отклонен</b>

К сожалению, ваш запрос на получение контактов поставщика для объявления "${match.offer.title}" был отклонен администратором.

Возможные причины:
• Недостаточная активность на платформе
• Несоответствие требованиям сделки
• Подозрительная активность

Для получения дополнительной информации свяжитесь с поддержкой.
`
				await this.telegramClient.sendMessage(
					match.request.user.telegramId,
					message,
					{ parse_mode: 'HTML' },
				)
			}

			return true
		} catch (error) {
			console.error('Error rejecting contact request:', error)
			return false
		}
	}
}
