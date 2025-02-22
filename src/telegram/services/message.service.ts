import { Injectable } from '@nestjs/common'
import { Markup } from 'telegraf'
import { PrismaService } from '../../prisma.service'

@Injectable()
export class TelegramMessageService {
	constructor(private prisma: PrismaService) {}

	async handleMessages(ctx, page: number) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		// Получаем список чатов (8 на страницу)
		const chatsPerPage = 8
		const skip = (page - 1) * chatsPerPage

		// Находим уникальных пользователей, с которыми есть переписка
		const chatUsers = await this.prisma.message.findMany({
			where: {
				OR: [{ fromId: user.id }, { toId: user.id }],
			},
			select: {
				fromUser: true,
				toUser: true,
				createdAt: true,
			},
			orderBy: {
				createdAt: 'desc',
			},
			skip,
			take: chatsPerPage,
		})

		// Формируем список уникальных собеседников
		const uniqueUsers = new Map()
		chatUsers.forEach(msg => {
			const otherUser = msg.fromUser.id === user.id ? msg.toUser : msg.fromUser
			if (!uniqueUsers.has(otherUser.id)) {
				uniqueUsers.set(otherUser.id, {
					user: otherUser,
					lastMessage: msg.createdAt,
				})
			}
		})

		// Преобразуем в кнопки
		const buttons = Array.from(uniqueUsers.values())
			.sort((a, b) => b.lastMessage.getTime() - a.lastMessage.getTime())
			.map(({ user }) => [
				Markup.button.callback(
					`${this.getRoleEmoji(user.role)} ${user.name}`,
					`chat_${user.id}`,
				),
			])

		// Добавляем пагинацию
		const totalChats = await this.prisma.message.count({
			where: {
				OR: [{ fromId: user.id }, { toId: user.id }],
			},
		})

		const totalPages = Math.ceil(totalChats / chatsPerPage)

		if (totalPages > 1) {
			const paginationButtons = []
			if (page > 1) {
				paginationButtons.push(
					Markup.button.callback('« Назад', `page_${page - 1}`),
				)
			}
			if (page < totalPages) {
				paginationButtons.push(
					Markup.button.callback('Вперед »', `page_${page + 1}`),
				)
			}
			buttons.push(paginationButtons)
		}

		// Добавляем кнопку возврата в меню
		buttons.push([Markup.button.callback('« Меню', 'menu')])

		await ctx.reply(
			'💬 <b>Ваши диалоги:</b>\n\n' +
				(buttons.length > 1
					? 'Выберите собеседника:'
					: 'У вас пока нет сообщений'),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			},
		)
	}

	async openChat(ctx, chatUserId: string) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		const otherUser = await this.prisma.user.findUnique({
			where: { id: chatUserId },
		})

		// Получаем историю сообщений
		const messages = await this.prisma.message.findMany({
			where: {
				OR: [
					{ AND: [{ fromId: user.id }, { toId: otherUser.id }] },
					{ AND: [{ fromId: otherUser.id }, { toId: user.id }] },
				],
			},
			orderBy: {
				createdAt: 'desc',
			},
			take: 10,
		})

		const chatText = `
💬 <b>Чат с ${otherUser.name}</b>

${
	messages.length > 0
		? messages
				.reverse()
				.map(
					msg =>
						`${msg.fromId === user.id ? '👤' : '👥'} ${
							msg.content
						}\n${this.formatDate(msg.createdAt)}`,
				)
				.join('\n\n')
		: 'Начните диалог первым!'
}
`

		await ctx.reply(chatText, {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('« Назад к чатам', 'messages')],
				[Markup.button.callback('« Меню', 'menu')],
			]),
		})
	}

	private getRoleEmoji(role: string): string {
		const emojis = {
			BUYER: '🛒',
			SUPPLIER: '📦',
			CARRIER: '🚛',
		}
		return emojis[role] || '👤'
	}

	private formatDate(date: Date): string {
		return new Intl.DateTimeFormat('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		}).format(date)
	}
}
