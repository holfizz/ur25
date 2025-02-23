import { OfferService } from '@/offer/offer.service'
import { Injectable } from '@nestjs/common'
import { Context, Markup, Telegraf } from 'telegraf'
import { PrismaService } from '../prisma.service'

@Injectable()
export class TelegramService {
	private bot: Telegraf

	constructor(
		private readonly prisma: PrismaService,
		private readonly offerService: OfferService,
	) {
		this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
	}

	public async handleStart(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
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
		await ctx.reply('Выберите нужное действие:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '📝 Создать объявление', callback_data: 'create_ad' },
						{ text: '📋 Мои объявления', callback_data: 'my_ads' },
					],
					[
						{ text: '📄 Заявки', callback_data: 'requests' },
						{ text: '💬 Сообщения', callback_data: 'messages' },
					],
					[
						{ text: '👤 Профиль', callback_data: 'profile' },
						{ text: 'ℹ️ Помощь', callback_data: 'help' },
					],
					[{ text: '🚪 Выйти', callback_data: 'logout' }],
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
	}

	async sendVerificationNotification(telegramId: string) {
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
}
