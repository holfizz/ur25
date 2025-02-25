import { Action, Ctx, On, Start, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { CallbackQuery, Message } from 'telegraf/typings/core/types/typegram'
import { PrismaService } from '../prisma.service'
import { TelegramAuthService } from './services/auth.service'
import { TelegramMessageService } from './services/message.service'
import { TelegramOfferService } from './services/offer.service'
import { TelegramProfileService } from './services/profile.service'
import { TelegramRequestService } from './services/request.service'
import { TelegramService } from './telegram.service'

@Update()
export class TelegramUpdate {
	constructor(
		private readonly telegramService: TelegramService,
		private readonly authService: TelegramAuthService,
		private readonly offerService: TelegramOfferService,
		private readonly requestService: TelegramRequestService,
		private readonly messageService: TelegramMessageService,
		private readonly profileService: TelegramProfileService,
		private readonly prisma: PrismaService,
	) {}

	@Start()
	async start(@Ctx() ctx: Context) {
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
	}

	@Action('register')
	async handleRegisterCommand(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		await this.authService.startRegistration(userId)

		await ctx.reply('Пожалуйста, выберите вашу роль для регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '👤 Покупатель', callback_data: 'role_buyer' },
						{ text: '🛠️ Поставщик', callback_data: 'role_supplier' },
					],
					[{ text: '🚚 Перевозчик', callback_data: 'role_carrier' }],
				],
			},
		})
	}
	@Action('skip_mercury')
	async handleSkipMercury(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		const userId = ctx.from.id
		const state = this.offerService.getOfferState(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		// Пропускаем ввод номера Меркурий и переходим к загрузке фото
		await this.offerService.handleCreateOffer(ctx)
	}
	@Action(/role_.*/)
	async handleRoleSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const role = callbackQuery.data.split('_')[1]
		await this.authService.handleRoleSelection(ctx, role)
	}

	@Action(/user_type_.*/)
	async handleUserTypeSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const userType = callbackQuery.data.split('_')[2]
		await this.authService.handleUserTypeSelection(ctx, userType)
	}

	@Action(/input_.*/)
	async handleInputTypeSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const inputType = callbackQuery.data.split('_')[1]
		await this.authService.setInputType(ctx, inputType)
	}

	@Action('create_ad')
	async handleCreateOffer(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.')
			return
		}

		if (user.role !== 'SUPPLIER') {
			await ctx.reply(
				'❌ Создавать объявления могут только поставщики.\n\n' +
					'Если вы хотите стать поставщиком, пожалуйста, создайте новый аккаунт с соответствующей ролью.',
			)
			return
		}

		await this.offerService.startOfferCreation(ctx)
	}

	@Action('media_done')
	async handleMediaDone(@Ctx() ctx: Context) {
		await this.offerService.handlePhotosDone(ctx)
	}

	@On('text')
	async handleText(@Ctx() ctx: Context) {
		const userId = ctx.from.id

		// Проверяем состояние входа
		const loginState = this.authService.getLoginState(userId)
		if (loginState) {
			if (ctx.message && 'text' in ctx.message) {
				await this.authService.handleLoginInput(ctx, ctx.message.text)
			}
			return
		}

		// Проверяем состояние создания объявления
		const offerState = await this.offerService.getOfferState(userId)
		if (offerState && ctx.message && 'text' in ctx.message) {
			await this.offerService.handleOfferInput(ctx, ctx.message.text)
			return
		}

		// Если нет активных состояний
		if (ctx.message && 'text' in ctx.message) {
			await this.authService.handleTextInput(ctx, ctx.message.text)
		}
	}

	@On('callback_query')
	async handleCallbackQuery(@Ctx() ctx: Context) {
		const query = ctx.callbackQuery as CallbackQuery.DataQuery
		await ctx.answerCbQuery()

		const userId = ctx.from.id

		// Обработка просмотра объявления
		if (query.data.startsWith('view_offer_')) {
			await this.offerService.handleViewOffer(ctx)
			return
		}

		// Обработка запроса контактов
		if (query.data.startsWith('request_contacts_')) {
			await this.offerService.handleContactRequest(ctx)
			return
		}

		if (query.data === 'create_offer') {
			await this.offerService.startOfferCreation(ctx)
			return
		}

		if (query.data === 'login') {
			const isLoggedIn = await this.authService.isUserLoggedIn(userId)
			if (isLoggedIn) {
				await ctx.reply('❌ Вы уже вошли в систему')
				await this.telegramService.handleMenu(ctx)
				return
			}

			this.authService.setLoginState(userId, {})
			await ctx.reply('📧 Введите ваш email:')
			return
		}

		if (query.data === 'logout') {
			await this.authService.handleLogout(ctx)
			return
		}

		switch (query.data) {
			case 'create_ad':
				await this.offerService.handleCreateOffer(ctx)
				break
			case 'my_ads':
				await this.offerService.showMyOffers(ctx)
				break
			case 'requests':
				await this.requestService.handleRequest(ctx)
				break
			case 'messages':
				await this.messageService.handleMessages(ctx, 1)
				break
			case 'profile':
				await this.profileService.showProfile(ctx)
				break
			case 'help':
				await ctx.reply('ℹ️ Раздел помощи\n\nЗдесь будет информация о помощи.')
				break
			case 'menu':
				await this.telegramService.handleMenu(ctx)
				break
			case 'browse_offers':
				await this.offerService.handleBrowseOffers(ctx, 1)
				break
		}
	}

	@On('photo')
	async onPhoto(@Ctx() ctx: Context) {
		const photos = (ctx.message as Message.PhotoMessage).photo
		const userId = ctx.from.id

		try {
			const offerState = await this.offerService.getOfferState(userId)
			if (!offerState) {
				await ctx.reply('❌ Сначала начните создание объявления')
				return
			}

			const photo = photos[photos.length - 1]
			const file = await ctx.telegram.getFile(photo.file_id)
			const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`

			await this.offerService.handlePhotoUpload(ctx, fileUrl, userId)
		} catch (error) {
			console.error('Ошибка при обработке фото:', error)
			await ctx.reply(
				'❌ Произошла ошибка при загрузке фото. Попробуйте еще раз.',
			)
		}
	}

	@On('video')
	async onVideo(@Ctx() ctx: Context) {
		try {
			const userId = ctx.from.id
			const offerState = await this.offerService.getOfferState(userId)

			if (!offerState) {
				await ctx.reply('❌ Сначала начните создание объявления')
				return
			}

			await this.offerService.handleVideo(ctx)
		} catch (error) {
			console.error('Ошибка при обработке видео:', error)
			await ctx.reply(
				'❌ Произошла ошибка при загрузке видео. Попробуйте еще раз.',
			)
		}
	}

	@Action('login')
	async handleLogin(@Ctx() ctx: Context) {
		await this.telegramService.handleLogin(ctx)
	}

	@Action('browse_offers')
	async handleBrowseOffers(@Ctx() ctx: Context) {
		await this.offerService.handleBrowseOffers(ctx, 1)
	}

	@Action(/browse_offers_(\d+)/)
	async handleBrowseOffersPage(@Ctx() ctx: Context) {
		//@ts-ignore
		const match = ctx.callbackQuery.data.match(/browse_offers_(\d+)/)
		if (match) {
			const page = parseInt(match[1])
			await this.offerService.handleBrowseOffers(ctx, page)
		}
	}

	@Action(/request_contacts_.*/)
	async handleContactRequest(@Ctx() ctx: Context) {
		await this.offerService.handleContactRequest(ctx)
	}

	@Action(/view_offer_.*/)
	async handleViewOffer(@Ctx() ctx: Context) {
		await this.offerService.handleViewOffer(ctx)
	}

	@Action('start')
	async handleStartButton(@Ctx() ctx: Context) {
		// Сначала отвечаем на callback query
		await ctx.answerCbQuery()

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
	}

	@Action(/actual_yes_.*/)
	async handleActualityYes(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		//@ts-ignore
		const offerId = ctx.callbackQuery.data.replace('actual_yes_', '')

		await this.prisma.offer.update({
			where: { id: offerId },
			data: { lastActualityCheck: new Date() },
		})

		await ctx.reply('✅ Спасибо! Объявление остается активным.')
	}

	@Action(/actual_no_.*/)
	async handleActualityNo(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		//@ts-ignore

		const offerId = ctx.callbackQuery.data.replace('actual_no_', '')

		await this.prisma.offer.update({
			where: { id: offerId },
			data: {
				status: 'PAUSED',
				lastActualityCheck: new Date(),
			},
		})

		await ctx.reply(
			'⏸ Объявление приостановлено.\n\n' +
				'Вы можете возобновить его в любой момент в разделе "Мои объявления".',
		)
	}

	@Action(/cattle_type_.*/)
	async handleCattleTypeSelect(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)
			//@ts-ignore
			const type = ctx.callbackQuery.data.split('_')[2] as CattleType

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.cattleType = type
			state.inputType = 'breed'
			this.offerService.updateOfferState(userId, state)

			// Запрашиваем породу
			await ctx.reply('🐮 Введите породу КРС:')
		} catch (error) {
			console.error('Ошибка при выборе типа КРС:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	@Action(/purpose_.*/)
	async handlePurpose(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)
			//@ts-ignore
			const purpose = ctx.callbackQuery.data.split('_')[1] as CattlePurpose

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.purpose = purpose
			state.inputType = 'price_type'
			this.offerService.updateOfferState(userId, state)

			// Запрашиваем формат цены
			await ctx.reply('💰 Выберите формат цены:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '🐮 За голову', callback_data: 'price_PER_HEAD' },
							{ text: '⚖️ За кг', callback_data: 'price_PER_KG' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при выборе назначения:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	@Action(/price_.*/)
	async handlePriceType(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)
			//@ts-ignore
			const priceType = ctx.callbackQuery.data.split('_')[1] as PriceType

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.priceType = priceType
			state.inputType =
				priceType === 'PER_HEAD' ? 'price_per_head' : 'price_per_kg'
			this.offerService.updateOfferState(userId, state)

			if (priceType === 'PER_HEAD') {
				await ctx.reply('💰 Введите цену за голову (₽):')
			} else {
				await ctx.reply('⚖️ Введите цену за кг (₽):')
			}
		} catch (error) {
			console.error('Ошибка при выборе типа цены:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	@Action('gkt_yes')
	async handleGktYes(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		const userId = ctx.from.id
		const state = this.offerService.getOfferState(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		state.inputType = 'gkt_discount'
		this.offerService.updateOfferState(userId, state)
		await ctx.reply('Введите процент скидки на ЖКТ (число от 0 до 100):')
	}

	@Action('gkt_no')
	async handleGktNo(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		const userId = ctx.from.id
		const state = this.offerService.getOfferState(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		state.gktDiscount = 0
		state.inputType = 'region'
		this.offerService.updateOfferState(userId, state)
		await ctx.reply('📍 Введите регион:')
	}
}
