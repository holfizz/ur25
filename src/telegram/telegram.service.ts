import { Injectable } from '@nestjs/common'
import { Context, Markup, Telegraf } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { PrismaService } from '../prisma.service'
import { TelegramAuthService } from './services/auth.service'
import { TelegramMessageService } from './services/message.service'
import { TelegramOfferService } from './services/offer.service'

@Injectable()
export class TelegramService {
	private bot: Telegraf

	constructor(
		private readonly prisma: PrismaService,
		private readonly offerService: TelegramOfferService,
		private readonly authService: TelegramAuthService,
		private readonly messageService: TelegramMessageService,
	) {
		this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

		// Добавляем обработчик видео
		this.bot.on('video', async ctx => {
			await this.offerService.handleVideo(ctx)
		})
	}

	public async handleStart(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply(
				'👋 Добро пожаловать на нашу площадку для торговли КРС (крупного рогатого скота)! Пожалуйста, выберите действие:',
				{
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '📝 Регистрация', callback_data: 'register' },
								{ text: '🔑 Войти', callback_data: 'login' },
							],
						],
					},
				},
			)
			return
		}

		await this.handleMenu(ctx)
	}

	async handleMenu(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply(
				'❌ Вы не авторизованы. Пожалуйста, войдите в систему или зарегистрируйтесь.',
				{
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '🔑 Войти', callback_data: 'login' },
								{ text: '📝 Регистрация', callback_data: 'register' },
							],
						],
					},
				},
			)
			return
		}

		if (!user.isVerified) {
			await ctx.reply(
				'⏳ Ваша учетная запись находится на модерации.\n' +
					'Пожалуйста, дождитесь подтверждения администратором.',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '« На главную', callback_data: 'start' }],
						],
					},
				},
			)
			return
		}

		// Получаем количество непрочитанных сообщений
		const unreadCount = await this.messageService.getUnreadMessagesCount(
			user.id,
		)
		const messagesText =
			unreadCount > 0 ? `💬 Сообщения (${unreadCount})` : '💬 Сообщения'

		// Базовые кнопки, доступные всем пользователям
		const buttons = [
			[{ text: '📋 Все объявления', callback_data: 'browse_offers' }],
			[{ text: messagesText, callback_data: 'messages' }],
		]

		// Добавляем кнопки создания объявлений только для продавцов
		if (user.role === 'SUPPLIER') {
			buttons.unshift([
				{ text: '📝 Создать объявление', callback_data: 'create_ad' },
				{ text: '📋 Мои объявления', callback_data: 'my_ads' },
			])
		}

		// Добавляем кнопки для покупателей
		if (user.role === 'BUYER') {
			buttons.unshift([
				{ text: '🔍 Создать запрос', callback_data: 'create_request' },
				{ text: '📋 Мои запросы', callback_data: 'my_requests' },
			])
		}

		// Добавляем общие кнопки внизу
		buttons.push([
			{ text: '👤 Профиль', callback_data: 'profile' },
			{ text: '❓ Помощь', callback_data: 'help' },
		])

		buttons.push([{ text: '🚪 Выйти', callback_data: 'logout' }])

		await ctx.reply('Выберите нужное действие:', {
			reply_markup: {
				inline_keyboard: buttons,
			},
		})
	}

	async showProfile(ctx: Context) {
		const user = await this.prisma.user.findUnique({
			where: { telegramId: ctx.from.id.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		await ctx.reply(`👤 Ваш профиль:\n\n📝 Название: ${user.name}`)
	}

	async handleTextInput(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		await ctx.reply('Введите ваше сообщение:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '🏠 Главное меню', callback_data: 'menu' },
						{ text: '📱 Профиль', callback_data: 'profile' },
					],
				],
			},
		})
	}

	async sendVerificationNotification(
		telegramId: string,
	): Promise<Message.TextMessage> {
		const message = await this.bot.telegram.sendMessage(
			telegramId,
			'✅ Ваш аккаунт успешно верифицирован!',
			{
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '🔑 Войти',
								callback_data: 'login',
							},
						],
					],
				},
			},
		)

		return message
	}

	async handleMyAds(ctx: Context) {
		await this.showMyOffers(ctx)
	}

	async showMyOffers(ctx: Context) {
		try {
			const userId = ctx.from.id
			const userWithOffers = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
				include: {
					offers: {
						include: {
							images: true,
							matches: true,
						},
					},
				},
			})

			if (!userWithOffers.offers.length) {
				await ctx.reply(
					'❌ У вас пока нет объявлений.\n\nИспользуйте команду /create_offer для создания нового объявления.',
					Markup.inlineKeyboard([
						[Markup.button.callback('📝 Создать объявление', 'create_offer')],
					]),
				)
				return
			}

			const offersList = userWithOffers.offers
				.map(
					(offer, index) => `
${index + 1}. <b>${offer.title}</b>
🔢 ${offer.quantity} голов
⚖️ ${offer.weight} кг
🌱 ${offer.age} мес.
💰 ${offer.price} ₽/гол
📍 ${offer.location}
${
	offer.matches.length > 0
		? `✅ Заявок: ${offer.matches.length}`
		: '⏳ Ожидание заявок...'
}`,
				)
				.join('\n\n')

			await ctx.reply(`📋 <b>Ваши объявления:</b>\n${offersList}`, {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[
						Markup.button.callback(
							'📝 Создать новое объявление',
							'create_offer',
						),
					],
					[Markup.button.callback('« Назад', 'menu')],
				]),
			})
		} catch (error) {
			console.error('Ошибка при получении объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при получении ваших объявлений.')
		}
	}

	async handleRegistration(ctx: Context) {
		await ctx.reply('Введите ваше имя:')
		// Здесь можно добавить логику для сбора данных о пользователе
	}

	async handleCallbackQuery(ctx: Context) {
		//@ts-ignore
		const callbackData = ctx.callbackQuery.data
		await ctx.answerCbQuery() // Подтверждение нажатия кнопки

		if (callbackData.startsWith('role_')) {
			const role = callbackData.split('_')[1]
			await this.authService.handleRoleSelection(ctx, role)
		} else if (callbackData.startsWith('type_')) {
			const userType = callbackData.split('_')[1]
			await this.authService.handleSupplierTypeSelection(ctx, userType)
		} else if (callbackData === 'skip_mercury') {
			await this.authService.handleSkipMercury(ctx)
		}

		// Другие обработчики...
	}

	async handleLogin(ctx: Context) {
		const userId = ctx.from.id
		await this.authService.initLoginState(userId)
		await ctx.reply(
			'📧 Введите ваш email для входа:\n\n📝 Пример: example@mail.com',
		)
	}

	async handleUserType(ctx: Context) {
		const callbackQuery = ctx.callbackQuery as any
		const userType = callbackQuery.data.split('_')[2]
		await this.authService.handleUserTypeSelection(ctx, userType)
	}

	async sendMessage(chatId: string, message: string) {
		try {
			// Используем напрямую bot.telegram для отправки сообщения
			await this.bot.telegram.sendMessage(chatId, message)
		} catch (error) {
			console.error('Error sending telegram message:', error)
		}
	}
}
