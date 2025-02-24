import { OfferService } from '@/offer/offer.service'
import { Injectable } from '@nestjs/common'
import { Context, Markup, Telegraf } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { PrismaService } from '../prisma.service'
import { TelegramAuthService } from './services/auth.service'

@Injectable()
export class TelegramService {
	private bot: Telegraf

	constructor(
		private readonly prisma: PrismaService,
		private readonly offerService: OfferService,
		private readonly authService: TelegramAuthService,
	) {
		this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
	}

	public async handleStart(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('Пожалуйста, выберите вашу роль для регистрации:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '👤 Покупатель', callback_data: 'role_buyer' },
							{ text: '🛠️ Поставщик', callback_data: 'role_supplier' },
							{ text: '🚚 Перевозчик', callback_data: 'role_carrier' },
						],
					],
				},
			})
			return
		}

		await this.handleMenu(ctx)
	}

	async handleMenu(ctx: Context) {
		await ctx.reply('Выберите нужное действие:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '📝 Создать объявление', callback_data: 'create_ad' },
						{ text: '📋 Мои объявления', callback_data: 'my_ads' },
					],
					[
						{ text: '📱 Профиль', callback_data: 'profile' },
						{ text: '🔑 Войти', callback_data: 'login' },
					],
					[
						{ text: '❓ Помощь', callback_data: 'help' },
						{ text: '🚪 Выйти', callback_data: 'logout' },
					],
					[{ text: '🏠 Главное меню', callback_data: 'menu' }],
				],
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
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
				include: {
					offers: {
						include: {
							images: true,
							matches: true,
						},
						orderBy: {
							createdAt: 'desc',
						},
					},
				},
			})

			if (!user.offers.length) {
				await ctx.reply(
					'❌ У вас пока нет объявлений.\n\nИспользуйте команду /create_offer для создания нового объявления.',
					Markup.inlineKeyboard([
						[Markup.button.callback('📝 Создать объявление', 'create_offer')],
					]),
				)
				return
			}

			const offersList = user.offers
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
			await this.authService.handleUserTypeSelection(ctx, userType)
		} else if (callbackData === 'skip_mercury') {
			await this.authService.handleSkipMercury(ctx)
		}

		// Другие обработчики...
	}

	async handleRegisterCommand(ctx: Context) {
		const userId = ctx.from.id
		await this.authService.startRegistration(userId) // Инициализация состояния

		await ctx.reply('❓ Выберите вашу роль для регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '👤 Покупатель', callback_data: 'role_buyer' },
						{ text: '🛠️ Поставщик', callback_data: 'role_supplier' },
						{ text: '🚚 Перевозчик', callback_data: 'role_carrier' },
					],
				],
			},
		})
	}
}
