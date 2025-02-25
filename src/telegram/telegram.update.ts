import { CattlePurpose, CattleType } from '@prisma/client'
import { Action, Ctx, On, Start, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { CallbackQuery } from 'telegraf/typings/core/types/typegram'
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

		// Добавляем логирование для отладки
		console.log('Получен callback_query:', query.data)

		// Обработка кнопки "Назад" к списку объявлений
		if (query.data === 'offers_list' || query.data === 'back_to_offers_list') {
			console.log('Обрабатываем возврат к списку объявлений')
			await this.handleOffersList(ctx)
			return
		}

		// Не обрабатываем здесь запросы, которые должны обрабатываться в других обработчиках
		if (query.data.startsWith('cattle_type_')) {
			await this.handleCattleTypeSelection(ctx)
			return
		}

		// Добавляем обработку кнопок назначения КРС
		if (query.data.startsWith('purpose_')) {
			await this.handlePurpose(ctx)
			return
		}

		// Добавляем обработку кнопок формата цены
		if (query.data === 'price_PER_HEAD') {
			await this.handlePricePerHead(ctx)
			return
		}
		if (query.data === 'price_PER_KG') {
			await this.handlePricePerKg(ctx)
			return
		}

		// Добавляем обработку кнопок скидки на ЖКТ
		if (query.data === 'gut_yes') {
			await this.handleGutYes(ctx)
			return
		}
		if (query.data === 'gut_no') {
			await this.handleGutNo(ctx)
			return
		}

		// Добавляем обработку кнопок Таможенного Союза
		if (query.data === 'customs_yes') {
			await this.handleCustomsYes(ctx)
			return
		}
		if (query.data === 'customs_no') {
			await this.handleCustomsNo(ctx)
			return
		}

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
	async handlePhoto(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const offerState = this.offerService.getOfferState(userId)

		if (offerState) {
			await this.offerService.handlePhotoUpload(ctx)
			return
		}

		// Если нет активного состояния создания объявления
		await ctx.reply(
			'Чтобы загрузить фотографию, начните создание объявления с помощью команды /create_offer',
		)
	}

	@On('video')
	async handleVideo(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const offerState = this.offerService.getOfferState(userId)

		if (offerState) {
			await this.offerService.handleVideoUpload(ctx)
			return
		}

		// Если нет активного состояния создания объявления
		await ctx.reply(
			'Чтобы загрузить видео, начните создание объявления с помощью команды /create_offer',
		)
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
	async handleCattleTypeSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)
			//@ts-ignore
			const cattleType = ctx.callbackQuery.data.split('_')[2] as CattleType

			// Проверяем, что тип КРС соответствует допустимым значениям
			const validCattleTypes = [
				'CALVES',
				'BULL_CALVES',
				'HEIFERS',
				'BREEDING_HEIFERS',
				'BULLS',
				'COWS',
			]

			if (!validCattleTypes.includes(cattleType)) {
				await ctx.reply(
					'❌ Выбран недопустимый тип КРС. Пожалуйста, выберите снова.',
				)
				return
			}

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.cattleType = cattleType
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

	@Action('price_PER_HEAD')
	async handlePricePerHead(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.priceType = 'PER_HEAD'
			state.inputType = 'price_per_head'
			this.offerService.updateOfferState(userId, state)

			await ctx.reply('💰 Введите цену за голову (₽):')
		} catch (error) {
			console.error('Ошибка при выборе цены за голову:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	@Action('price_PER_KG')
	async handlePricePerKg(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.priceType = 'PER_KG'
			state.inputType = 'price_per_kg'
			this.offerService.updateOfferState(userId, state)

			await ctx.reply('⚖️ Введите цену за кг (₽):')
		} catch (error) {
			console.error('Ошибка при выборе цены за кг:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	@Action('gut_yes')
	async handleGutYes(@Ctx() ctx: Context) {
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

	@Action('gut_no')
	async handleGutNo(@Ctx() ctx: Context) {
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

	@Action('customs_yes')
	async handleCustomsYes(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		const userId = ctx.from.id
		const state = this.offerService.getOfferState(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		state.customsUnion = true
		state.inputType = 'full_address'
		this.offerService.updateOfferState(userId, state)
		await ctx.reply('📍 Введите полный адрес:')
	}

	@Action('customs_no')
	async handleCustomsNo(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()
		const userId = ctx.from.id
		const state = this.offerService.getOfferState(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		state.customsUnion = false
		state.inputType = 'full_address'
		this.offerService.updateOfferState(userId, state)
		await ctx.reply('📍 Введите полный адрес:')
	}

	@Action('offers_list')
	async handleOffersList(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			// Получаем список активных объявлений
			const offers = await this.prisma.offer.findMany({
				where: { status: 'ACTIVE' },
				orderBy: { createdAt: 'desc' },
				take: 10, // Ограничиваем количество объявлений
			})

			if (offers.length === 0) {
				await ctx.reply('📭 Нет активных объявлений')
				return
			}

			// Формируем сообщение со списком объявлений
			let message = '📋 <b>Список объявлений:</b>\n\n'

			// Создаем клавиатуру с кнопками для каждого объявления
			const keyboard = []

			for (const offer of offers) {
				// Добавляем информацию об объявлении в сообщение
				message += `🐮 <b>${offer.title}</b>\n`
				message += `💰 ${
					offer.priceType === 'PER_HEAD'
						? `${offer.pricePerHead.toLocaleString('ru-RU')} ₽/голову`
						: `${offer.pricePerKg.toLocaleString('ru-RU')} ₽/кг`
				}\n`
				message += `📍 ${offer.region}\n\n`

				// Добавляем кнопку для просмотра объявления
				keyboard.push([
					{
						text: `${offer.title} (${
							offer.priceType === 'PER_HEAD'
								? `${offer.pricePerHead.toLocaleString('ru-RU')} ₽`
								: `${offer.pricePerKg.toLocaleString('ru-RU')} ₽/кг`
						})`,
						callback_data: `view_offer_${offer.id}`,
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
		} catch (error) {
			console.error('Ошибка при получении списка объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке списка объявлений')
		}
	}

	@Action('menu')
	async handleMenu(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				// Если пользователь не авторизован, показываем меню для гостя
				await ctx.reply('👋 Добро пожаловать! Выберите действие:', {
					reply_markup: {
						inline_keyboard: [
							[{ text: '🔑 Авторизация', callback_data: 'login' }],
							[{ text: '📋 Список объявлений', callback_data: 'offers_list' }],
						],
					},
				})
				return
			}

			// Если пользователь авторизован, показываем соответствующее меню
			if (user.role === 'SUPPLIER') {
				// Меню для поставщика
				await ctx.reply(
					`👋 Добро пожаловать, ${user.name || 'поставщик'}! Выберите действие:`,
					{
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '📝 Создать объявление',
										callback_data: 'create_offer',
									},
								],
								[{ text: '📋 Мои объявления', callback_data: 'my_offers' }],
								[
									{
										text: '📋 Список объявлений',
										callback_data: 'offers_list',
									},
								],
								[{ text: '👤 Мой профиль', callback_data: 'profile' }],
							],
						},
					},
				)
			} else if (user.role === 'BUYER') {
				// Меню для покупателя
				await ctx.reply(
					`👋 Добро пожаловать, ${user.name || 'покупатель'}! Выберите действие:`,
					{
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '📋 Список объявлений',
										callback_data: 'offers_list',
									},
								],
								[
									{
										text: '📝 Создать запрос',
										callback_data: 'create_request',
									},
								],
								[{ text: '📋 Мои запросы', callback_data: 'my_requests' }],
								[{ text: '👤 Мой профиль', callback_data: 'profile' }],
							],
						},
					},
				)
			} else {
				// Меню для администратора
				await ctx.reply(
					`👋 Добро пожаловать, ${user.name || 'администратор'}! Выберите действие:`,
					{
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '📋 Список объявлений',
										callback_data: 'offers_list',
									},
								],
								[
									{
										text: '📋 Список запросов',
										callback_data: 'requests_list',
									},
								],
								[{ text: '👤 Мой профиль', callback_data: 'profile' }],
							],
						},
					},
				)
			}
		} catch (error) {
			console.error('Ошибка при отображении меню:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке меню')
		}
	}

	@Action('back_to_offers_list')
	async handleBackToOffersList(@Ctx() ctx: Context) {
		// Просто перенаправляем на обработчик списка объявлений
		await this.handleOffersList(ctx)
	}
}
