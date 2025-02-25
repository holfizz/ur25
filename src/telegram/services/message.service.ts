import { Injectable } from '@nestjs/common'
import { Context } from 'telegraf'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'

interface MessageState {
	chatId: string
	recipientId: string
}

@Injectable()
export class TelegramMessageService {
	private messageStates: Map<number, MessageState> = new Map()

	constructor(
		private prisma: PrismaService,
		private telegramClient: TelegramClient,
	) {}

	setMessageState(userId: number, state: MessageState): void {
		this.messageStates.set(userId, state)
	}

	getMessageState(userId: number): MessageState | undefined {
		return this.messageStates.get(userId)
	}

	clearMessageState(userId: number): void {
		this.messageStates.delete(userId)
	}

	async handleMessageInput(ctx: Context, text: string): Promise<void> {
		const userId = ctx.from.id
		const state = this.getMessageState(userId)

		if (!state) {
			await ctx.reply('❌ Начните отправку сообщения заново')
			return
		}

		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		const recipient = await this.prisma.user.findUnique({
			where: { id: state.recipientId },
		})

		if (!recipient) {
			await ctx.reply('❌ Получатель не найден')
			return
		}

		// Создаем сообщение
		const message = await this.prisma.chatMessage.create({
			data: {
				chat: { connect: { id: state.chatId } },
				sender: { connect: { id: user.id } },
				text: text,
			},
			include: {
				chat: true,
			},
		})

		// Отправляем сообщение пользователю
		await ctx.reply(
			`✅ Сообщение отправлено пользователю ${recipient.name || recipient.email}`,
			{
				reply_markup: {
					inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
				},
			},
		)

		// Уведомляем получателя через Telegram, если есть telegramId
		if (recipient.telegramId) {
			await this.telegramClient.sendMessage(
				recipient.telegramId,
				`📨 <b>Новое сообщение</b>\n\n` +
					`От: ${user.name || user.email}\n\n` +
					`${text}`,
				{
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '💬 Ответить',
									callback_data: `send_message_${user.id}`,
								},
							],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				},
			)
		}

		// Очищаем состояние
		this.clearMessageState(userId)
	}

	async showChats(ctx: Context): Promise<void> {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		// Получаем все чаты пользователя
		const chats = await this.prisma.chat.findMany({
			where: {
				OR: [{ user1Id: user.id }, { user2Id: user.id }],
			},
			include: {
				user1: true,
				user2: true,
				messages: {
					orderBy: { createdAt: 'desc' },
					take: 1,
				},
			},
			orderBy: { updatedAt: 'desc' },
		})

		if (chats.length === 0) {
			await ctx.reply('📭 У вас пока нет сообщений')
			return
		}

		// Формируем сообщение со списком чатов
		let message = '💬 <b>Ваши сообщения:</b>\n\n'
		const keyboard = []

		for (const chat of chats) {
			// Определяем собеседника
			const interlocutor = chat.user1Id === user.id ? chat.user2 : chat.user1

			// Получаем последнее сообщение
			const lastMessage = chat.messages[0]
			const lastMessageText = lastMessage
				? `${lastMessage.text.substring(0, 30)}${lastMessage.text.length > 30 ? '...' : ''}`
				: 'Нет сообщений'

			// Добавляем информацию о чате
			message += `👤 <b>${interlocutor.name || interlocutor.email}</b>\n`
			message += `📝 ${lastMessageText}\n\n`

			// Добавляем кнопку для перехода к чату
			keyboard.push([
				{
					text: `💬 ${interlocutor.name || interlocutor.email}`,
					callback_data: `open_chat_${chat.id}`,
				},
			])
		}

		// Добавляем кнопку возврата в меню
		keyboard.push([{ text: '« Меню', callback_data: 'menu' }])

		// Отправляем сообщение с кнопками
		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: keyboard,
			},
		})
	}

	async openChat(ctx: Context, chatId: string): Promise<void> {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		// Получаем чат
		const chat = await this.prisma.chat.findUnique({
			where: { id: chatId },
			include: {
				user1: true,
				user2: true,
				messages: {
					orderBy: { createdAt: 'desc' },
					take: 10,
				},
			},
		})

		if (!chat) {
			await ctx.reply('❌ Чат не найден')
			return
		}

		// Проверяем, что пользователь является участником чата
		if (chat.user1Id !== user.id && chat.user2Id !== user.id) {
			await ctx.reply('❌ У вас нет доступа к этому чату')
			return
		}

		// Определяем собеседника
		const interlocutor = chat.user1Id === user.id ? chat.user2 : chat.user1

		// Формируем сообщение с историей чата
		let message = `💬 <b>Чат с ${interlocutor.name || interlocutor.email}</b>\n\n`

		if (chat.messages.length === 0) {
			message += 'Нет сообщений'
		} else {
			// Отображаем сообщения в обратном порядке (от новых к старым)
			for (const msg of chat.messages.reverse()) {
				const sender =
					msg.senderId === user.id
						? 'Вы'
						: interlocutor.name || interlocutor.email
				message += `<b>${sender}:</b> ${msg.text}\n\n`
			}
		}

		// Отправляем сообщение с кнопками
		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: '💬 Ответить',
							callback_data: `send_message_${interlocutor.id}`,
						},
					],
					[
						{
							text: '« Назад к чатам',
							callback_data: 'messages',
						},
					],
					[
						{
							text: '« Меню',
							callback_data: 'menu',
						},
					],
				],
			},
		})

		// Отмечаем сообщения как прочитанные
		await this.prisma.chatMessage.updateMany({
			where: {
				chatId: chatId,
				senderId: interlocutor.id,
				read: false,
			},
			data: {
				read: true,
			},
		})
	}

	async getUnreadMessagesCount(userId: string): Promise<number> {
		try {
			// Находим все чаты пользователя
			const chats = await this.prisma.chat.findMany({
				where: {
					OR: [{ user1Id: userId }, { user2Id: userId }],
				},
				include: {
					messages: {
						where: {
							read: false,
							NOT: {
								senderId: userId, // Исключаем сообщения, отправленные самим пользователем
							},
						},
					},
				},
			})

			// Подсчитываем общее количество непрочитанных сообщений
			let unreadCount = 0
			for (const chat of chats) {
				unreadCount += chat.messages.length
			}

			return unreadCount
		} catch (error) {
			console.error(
				'Ошибка при получении количества непрочитанных сообщений:',
				error,
			)
			return 0 // В случае ошибки возвращаем 0
		}
	}

	async handleMessages(ctx: Context, page: number = 1): Promise<void> {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		// Получаем все чаты пользователя
		const chats = await this.prisma.chat.findMany({
			where: {
				OR: [{ user1Id: user.id }, { user2Id: user.id }],
			},
			include: {
				user1: true,
				user2: true,
				messages: {
					orderBy: { createdAt: 'desc' },
					take: 1,
				},
			},
			orderBy: { updatedAt: 'desc' },
		})

		if (chats.length === 0) {
			await ctx.reply('📭 У вас пока нет сообщений')
			return
		}

		// Формируем сообщение со списком чатов
		let message = '💬 <b>Ваши сообщения:</b>\n\n'
		const keyboard = []

		for (const chat of chats) {
			// Определяем собеседника
			const interlocutor = chat.user1Id === user.id ? chat.user2 : chat.user1

			// Получаем последнее сообщение
			const lastMessage = chat.messages[0]
			const lastMessageText = lastMessage
				? `${lastMessage.text.substring(0, 30)}${lastMessage.text.length > 30 ? '...' : ''}`
				: 'Нет сообщений'

			// Добавляем информацию о чате
			message += `👤 <b>${interlocutor.name || interlocutor.email}</b>\n`
			message += `📝 ${lastMessageText}\n\n`

			// Добавляем кнопку для перехода к чату
			keyboard.push([
				{
					text: `💬 ${interlocutor.name || interlocutor.email}`,
					callback_data: `open_chat_${chat.id}`,
				},
			])
		}

		// Добавляем кнопку возврата в меню
		keyboard.push([{ text: '« Меню', callback_data: 'menu' }])

		// Отправляем сообщение с кнопками
		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: keyboard,
			},
		})
	}
}
