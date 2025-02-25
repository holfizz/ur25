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
import { TelegramClient } from './telegram.client'
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
		private readonly telegramClient: TelegramClient,
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
		try {
			const userId = ctx.from.id

			// Проверяем, что сообщение содержит текст
			if (!('text' in ctx.message)) {
				return
			}

			const text = ctx.message.text
			console.log(
				`Получено текстовое сообщение от пользователя ${userId}: ${text}`,
			)

			// Проверяем, авторизован ли пользователь
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				// Если пользователь не авторизован, проверяем, находится ли он в процессе авторизации
				const authState = this.authService.getAuthState(userId)
				if (authState) {
					console.log(
						`Пользователь ${userId} находится в процессе авторизации:`,
						authState,
					)
					await this.authService.handleAuthInput(ctx, text)
					return
				}

				await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.')
				return
			}

			// Проверяем, находится ли пользователь в процессе создания объявления
			const offerState = this.offerService.getOfferState(userId)
			if (offerState && offerState.inputType) {
				console.log(
					`Пользователь ${userId} находится в процессе создания объявления:`,
					offerState,
				)
				await this.offerService.handleOfferInput(ctx, text)
				return
			}

			// Проверяем, находится ли пользователь в процессе создания запроса
			const requestState = this.requestService.getRequestState(userId)
			if (requestState && requestState.inputType) {
				console.log(
					`Пользователь ${userId} находится в процессе создания запроса:`,
					requestState,
				)
				await this.requestService.handleRequestInput(ctx, text)
				return
			}

			// Проверяем, находится ли пользователь в процессе отправки сообщения
			const messageState = this.messageService.getMessageState(userId)
			if (messageState) {
				console.log(
					`Пользователь ${userId} находится в процессе отправки сообщения:`,
					messageState,
				)
				await this.messageService.handleMessageInput(ctx, text)
				return
			}

			// Проверяем, находится ли пользователь в процессе редактирования профиля
			const editState = this.profileService.getEditState(userId)
			if (editState) {
				console.log(
					`Пользователь ${userId} находится в процессе редактирования профиля:`,
					editState,
				)
				await this.profileService.handleProfileInput(ctx, text)
				return
			}

			// Если ни одно из условий не выполнено, отправляем меню
			console.log(
				`Пользователь ${userId} не находится в каком-либо процессе, отправляем меню`,
			)
			await this.telegramService.handleMenu(ctx)
		} catch (error) {
			console.error('Ошибка при обработке текстового сообщения:', error)
			await ctx.reply('❌ Произошла ошибка при обработке вашего сообщения')
		}
	}

	@On('callback_query')
	async handleCallbackQuery(@Ctx() ctx: Context) {
		// Используем правильное приведение типа для callbackQuery
		const query = ctx.callbackQuery as any

		// Добавляем проверку на наличие свойства data
		if (!query || !query.data) {
			console.error('Некорректный формат callback_query:', query)
			return
		}

		// Добавляем логирование для отладки
		console.log('Получен callback_query:', query.data)

		try {
			// Добавляем обработку view_offer_*
			if (query.data.startsWith('view_offer_')) {
				const offerId = query.data.replace('view_offer_', '')
				console.log(`Обработка view_offer_ в handleCallbackQuery: ${offerId}`)
				await this.offerService.handleViewOffer(ctx)
				return
			}

			// Если не обработано выше, используем switch
			switch (query.data) {
				case 'create_request':
					await this.handleCreateRequest(ctx)
					break
				case 'my_requests':
					await this.handleMyRequests(ctx)
					break
				case 'edit_profile':
					await this.handleEditProfile(ctx)
					break
				case 'edit_name':
					await this.handleEditName(ctx)
					break
				case 'edit_phone':
					await this.handleEditPhone(ctx)
					break
				case 'edit_address':
					await this.handleEditAddress(ctx)
					break
				case 'offers_list':
					await this.handleOffersList(ctx)
					break
				case 'back_to_offers_list':
					await this.handleBackToOffersList(ctx)
					break
				case 'create_ad':
					await this.offerService.handleCreateOffer(ctx)
					break
				case 'login':
					await this.telegramService.handleLogin(ctx)
					break
				case 'logout':
					await this.authService.handleLogout(ctx)
					break
				case 'messages':
					await this.messageService.handleMessages(ctx)
					break
				case 'profile':
					await this.profileService.showProfile(ctx)
					break
				case 'help':
					await this.handleHelp(ctx)
					break
				case 'menu':
					await this.telegramService.handleMenu(ctx)
					break
				case 'browse_offers':
					await this.offerService.handleBrowseOffers(ctx, 1)
					break
				case 'create_offer':
					await this.offerService.startOfferCreation(ctx)
					break
				case 'gut_yes':
					await this.handleGutYes(ctx)
					break
				case 'gut_no':
					await this.handleGutNo(ctx)
					break
				case 'customs_yes':
					await this.handleCustomsYes(ctx)
					break
				case 'customs_no':
					await this.handleCustomsNo(ctx)
					break
				case 'actual_yes_':
					await this.handleActualityYes(ctx)
					break
				case 'actual_no_':
					await this.handleActualityNo(ctx)
					break
				case 'cattle_type_':
					await this.handleCattleTypeSelection(ctx)
					break
				case 'purpose_':
					await this.handlePurpose(ctx)
					break
				case 'price_PER_HEAD':
					await this.handlePricePerHead(ctx)
					break
				case 'price_PER_KG':
					await this.handlePricePerKg(ctx)
					break
				case 'approve_contact_':
					await this.handleApproveContact(ctx)
					break
				case 'reject_contact_':
					await this.handleRejectContact(ctx)
					break
				case 'open_chat_':
					await this.handleOpenChat(ctx)
					break
				case 'send_message_':
					await this.handleSendMessage(ctx)
					break
				case 'propose_deal_':
					await this.handleProposeDeal(ctx)
					break
				case 'reject_deal_':
					await this.handleRejectDeal(ctx)
					break
				case 'approve_deal_':
					await this.handleApproveDeal(ctx)
					break
			}
		} catch (error) {
			console.error('Ошибка при обработке callback_query:', error)
			await ctx.reply('❌ Произошла ошибка при обработке вашего запроса')
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

		state.gutDiscount = 0
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

			// Проверяем наличие непрочитанных сообщений
			const unreadCount = await this.messageService.getUnreadMessagesCount(
				user.id,
			)
			const messagesText =
				unreadCount > 0 ? `💬 Сообщения (${unreadCount})` : '💬 Сообщения'

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
								[{ text: messagesText, callback_data: 'messages' }],
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
								[{ text: messagesText, callback_data: 'messages' }],
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
								[{ text: messagesText, callback_data: 'messages' }],
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

	@Action(/approve_contact_.*/)
	async handleApproveContact(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const requestId = callbackQuery.data.replace('approve_contact_', '')

			// Обновляем статус запроса
			const request = await this.prisma.contactRequest.update({
				where: { id: requestId },
				data: { status: 'APPROVED' },
				include: { offer: true, requester: true },
			})

			// Отправляем сообщение владельцу объявления
			await ctx.reply(
				`✅ Вы одобрили запрос на контакты для объявления "${request.offer.title}".\n\n` +
					`Пользователь ${request.requester.name || request.requester.email} теперь может видеть ваши контактные данные.`,
				{
					reply_markup: {
						inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
					},
				},
			)

			// Уведомляем пользователя, запросившего контакты
			const requesterTelegramId = request.requester.telegramId
			if (requesterTelegramId) {
				const offer = await this.prisma.offer.findUnique({
					where: { id: request.offerId },
					include: { user: true },
				})

				await this.telegramClient.sendMessage(
					requesterTelegramId,
					`✅ <b>Запрос на контакты одобрен!</b>\n\n` +
						`Владелец объявления "${offer.title}" одобрил ваш запрос на контакты.\n\n` +
						`📞 <b>Контактная информация:</b>\n` +
						`👤 Контактное лицо: ${offer.contactPerson || offer.user.name || 'Не указано'}\n` +
						`📱 Телефон: ${offer.contactPhone || offer.user.phone || 'Не указано'}\n` +
						`📧 Email: ${offer.user.email || 'Не указано'}`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '💬 Написать сообщение',
										callback_data: `send_message_${offer.userId}`,
									},
								],
								[
									{
										text: '🤝 Предложить сделку',
										callback_data: `propose_deal_${offer.id}`,
									},
								],
								[
									{
										text: '« Назад к объявлению',
										callback_data: `view_offer_${offer.id}`,
									},
								],
							],
						},
					},
				)
			}
		} catch (error) {
			console.error('Ошибка при одобрении запроса на контакты:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/reject_contact_.*/)
	async handleRejectContact(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const requestId = callbackQuery.data.replace('reject_contact_', '')

			// Обновляем статус запроса
			const request = await this.prisma.contactRequest.update({
				where: { id: requestId },
				data: { status: 'REJECTED' },
				include: { offer: true, requester: true },
			})

			// Отправляем сообщение владельцу объявления
			await ctx.reply(
				`❌ Вы отклонили запрос на контакты для объявления "${request.offer.title}".`,
				{
					reply_markup: {
						inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
					},
				},
			)

			// Уведомляем пользователя, запросившего контакты
			const requesterTelegramId = request.requester.telegramId
			if (requesterTelegramId) {
				await this.telegramClient.sendMessage(
					requesterTelegramId,
					`❌ <b>Запрос на контакты отклонен</b>\n\n` +
						`Владелец объявления "${request.offer.title}" отклонил ваш запрос на контакты.`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '« Назад к объявлению',
										callback_data: `view_offer_${request.offerId}`,
									},
								],
							],
						},
					},
				)
			}
		} catch (error) {
			console.error('Ошибка при отклонении запроса на контакты:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('messages')
	async handleMessages(@Ctx() ctx: Context) {
		await this.messageService.handleMessages(ctx)
	}

	@Action(/open_chat_.*/)
	async handleOpenChat(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const chatId = callbackQuery.data.replace('open_chat_', '')

			await this.messageService.openChat(ctx, chatId)
		} catch (error) {
			console.error('Ошибка при открытии чата:', error)
			await ctx.reply('❌ Произошла ошибка при открытии чата')
		}
	}

	@Action(/send_message_.*/)
	async handleSendMessage(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const recipientId = callbackQuery.data.replace('send_message_', '')

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.')
				return
			}

			// Получаем получателя
			const recipient = await this.prisma.user.findUnique({
				where: { id: recipientId },
			})

			if (!recipient) {
				await ctx.reply('❌ Получатель не найден')
				return
			}

			// Создаем или получаем существующий чат
			let chat = await this.prisma.chat.findFirst({
				where: {
					OR: [
						{
							user1Id: user.id,
							user2Id: recipient.id,
						},
						{
							user1Id: recipient.id,
							user2Id: user.id,
						},
					],
				},
			})

			if (!chat) {
				chat = await this.prisma.chat.create({
					data: {
						user1Id: user.id,
						user2Id: recipient.id,
					},
				})
			}

			// Устанавливаем состояние для отправки сообщения
			this.messageService.setMessageState(userId, {
				chatId: chat.id,
				recipientId: recipient.id,
			})

			await ctx.reply(
				`💬 <b>Новое сообщение</b>\n\n` +
					`Получатель: ${recipient.name || recipient.email}\n\n` +
					`Введите текст сообщения:`,
				{
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[{ text: '« Отмена', callback_data: 'menu' }]],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при отправке сообщения:', error)
			await ctx.reply('❌ Произошла ошибка при отправке сообщения')
		}
	}

	@Action(/propose_deal_.*/)
	async handleProposeDeal(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const offerId = callbackQuery.data.replace('propose_deal_', '')

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.')
				return
			}

			// Получаем объявление
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: { user: true },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Проверяем, не является ли пользователь владельцем объявления
			if (offer.userId === user.id) {
				await ctx.reply(
					'❌ Вы не можете предложить сделку по своему объявлению',
				)
				return
			}

			// Проверяем, не предлагал ли пользователь уже сделку
			const existingDeal = await this.prisma.deal.findFirst({
				where: {
					offerId: offerId,
					buyerId: user.id,
				},
			})

			if (existingDeal) {
				// Если сделка уже существует, проверяем ее статус
				if (existingDeal.status === 'APPROVED') {
					// Если сделка одобрена, показываем информацию о ней
					await ctx.reply(
						`✅ <b>Сделка уже одобрена!</b>\n\n` +
							`Объявление: ${offer.title}\n` +
							`Статус: Одобрена\n\n` +
							`Вы можете связаться с продавцом для обсуждения деталей.`,
						{
							parse_mode: 'HTML',
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '💬 Написать сообщение',
											callback_data: `send_message_${offer.userId}`,
										},
									],
									[
										{
											text: '« Назад к объявлению',
											callback_data: `view_offer_${offerId}`,
										},
									],
								],
							},
						},
					)
					return
				} else if (existingDeal.status === 'PENDING') {
					// Если сделка в ожидании, сообщаем об этом
					await ctx.reply(
						'⏳ Ваше предложение о сделке находится на рассмотрении.\n\n' +
							'Вы получите уведомление, когда продавец примет решение.',
						{
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '« Назад к объявлению',
											callback_data: `view_offer_${offerId}`,
										},
									],
								],
							},
						},
					)
					return
				} else if (existingDeal.status === 'REJECTED') {
					// Если сделка отклонена, сообщаем об этом
					await ctx.reply(
						'❌ Ваше предложение о сделке было отклонено продавцом.',
						{
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '« Назад к объявлению',
											callback_data: `view_offer_${offerId}`,
										},
									],
								],
							},
						},
					)
					return
				}
			}

			// Создаем новую сделку
			const deal = await this.prisma.deal.create({
				data: {
					offer: { connect: { id: offerId } },
					buyer: { connect: { id: user.id } },
					seller: { connect: { id: offer.userId } },
					status: 'PENDING',
					price:
						offer.priceType === 'PER_HEAD'
							? offer.pricePerHead
							: offer.pricePerKg,
					quantity: offer.quantity,
				},
			})

			// Отправляем сообщение пользователю
			await ctx.reply(
				'✅ Предложение о сделке отправлено!\n\n' +
					'Вы получите уведомление, когда продавец примет решение.',
				{
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '« Назад к объявлению',
									callback_data: `view_offer_${offerId}`,
								},
							],
						],
					},
				},
			)

			// Уведомляем продавца
			const sellerTelegramId = offer.user.telegramId
			if (sellerTelegramId) {
				await this.telegramClient.sendMessage(
					sellerTelegramId,
					`🤝 <b>Новое предложение о сделке!</b>\n\n` +
						`Пользователь ${user.name || user.email} предлагает сделку по вашему объявлению "${offer.title}".\n\n` +
						`Количество: ${deal.quantity} голов\n` +
						`Цена: ${deal.price.toLocaleString('ru-RU')} ₽${offer.priceType === 'PER_HEAD' ? '/голову' : '/кг'}\n\n` +
						`Хотите принять это предложение?`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '✅ Принять',
										callback_data: `approve_deal_${deal.id}`,
									},
									{
										text: '❌ Отклонить',
										callback_data: `reject_deal_${deal.id}`,
									},
								],
							],
						},
					},
				)
			}
		} catch (error) {
			console.error('Ошибка при предложении сделки:', error)
			await ctx.reply('❌ Произошла ошибка при предложении сделки')
		}
	}

	@Action(/reject_deal_.*/)
	async handleRejectDeal(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const dealId = callbackQuery.data.replace('reject_deal_', '')

			// Обновляем статус сделки
			const deal = await this.prisma.deal.update({
				where: { id: dealId },
				data: { status: 'REJECTED' },
				include: { offer: true, buyer: true },
			})

			// Отправляем сообщение продавцу
			await ctx.reply(
				`❌ Вы отклонили предложение о сделке для объявления "${deal.offer.title}".`,
				{
					reply_markup: {
						inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
					},
				},
			)

			// Уведомляем покупателя
			const buyerTelegramId = deal.buyer.telegramId
			if (buyerTelegramId) {
				await this.telegramClient.sendMessage(
					buyerTelegramId,
					`❌ <b>Предложение о сделке отклонено</b>\n\n` +
						`Продавец отклонил ваше предложение о сделке по объявлению "${deal.offer.title}".`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
						},
					},
				)
			}
		} catch (error) {
			console.error('Ошибка при отклонении сделки:', error)
			await ctx.reply('❌ Произошла ошибка при обработке сделки')
		}
	}

	@Action(/approve_deal_.*/)
	async handleApproveDeal(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const dealId = callbackQuery.data.replace('approve_deal_', '')

			// Обновляем статус сделки
			const deal = await this.prisma.deal.update({
				where: { id: dealId },
				data: { status: 'APPROVED' },
				include: { offer: true, buyer: true },
			})

			// Отправляем сообщение продавцу
			await ctx.reply(
				`✅ Вы приняли предложение о сделке для объявления "${deal.offer.title}".\n\n` +
					`Покупатель: ${deal.buyer.name || deal.buyer.email}\n` +
					`Количество: ${deal.quantity} голов\n` +
					`Цена: ${deal.price.toLocaleString('ru-RU')} ₽${deal.offer.priceType === 'PER_HEAD' ? '/голову' : '/кг'}\n\n` +
					`Теперь вы можете связаться с покупателем для обсуждения деталей.`,
				{
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '💬 Написать сообщение',
									callback_data: `send_message_${deal.buyerId}`,
								},
							],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				},
			)

			// Уведомляем покупателя
			const buyerTelegramId = deal.buyer.telegramId
			if (buyerTelegramId) {
				await this.telegramClient.sendMessage(
					buyerTelegramId,
					`✅ <b>Предложение о сделке принято!</b>\n\n` +
						`Продавец принял ваше предложение о сделке по объявлению "${deal.offer.title}".\n\n` +
						`Количество: ${deal.quantity} голов\n` +
						`Цена: ${deal.price.toLocaleString('ru-RU')} ₽${deal.offer.priceType === 'PER_HEAD' ? '/голову' : '/кг'}\n\n` +
						`Теперь вы можете связаться с продавцом для обсуждения деталей.`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '💬 Написать сообщение',
										callback_data: `send_message_${deal.offer.userId}`,
									},
								],
								[{ text: '« Меню', callback_data: 'menu' }],
							],
						},
					},
				)
			}
		} catch (error) {
			console.error('Ошибка при одобрении сделки:', error)
			await ctx.reply('❌ Произошла ошибка при обработке сделки')
		}
	}

	@Action('my_requests')
	async handleMyRequests(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик my_requests')
			await (ctx as any).answerCbQuery()

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			console.log('Пользователь найден, вызываем handleMyRequests')
			await this.requestService.handleMyRequests(ctx)
		} catch (error) {
			console.error('Ошибка при отображении запросов:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке запросов')
		}
	}

	@Action('edit_name')
	async handleEditName(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик edit_name')
			await ctx.answerCbQuery()
			await this.profileService.handleEditField(ctx, 'name')
		} catch (error) {
			console.error('Ошибка при редактировании имени:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании имени')
		}
	}

	@Action('edit_phone')
	async handleEditPhone(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик edit_phone')
			await ctx.answerCbQuery()
			await this.profileService.handleEditField(ctx, 'phone')
		} catch (error) {
			console.error('Ошибка при редактировании телефона:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании телефона')
		}
	}

	@Action('edit_address')
	async handleEditAddress(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик edit_address')
			await ctx.answerCbQuery()
			await this.profileService.handleEditField(ctx, 'address')
		} catch (error) {
			console.error('Ошибка при редактировании адреса:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании адреса')
		}
	}

	@Action('help')
	async handleHelp(@Ctx() ctx: Context) {
		await ctx.answerCbQuery()

		const helpText = `
ℹ️ <b>Справка по использованию бота</b>

<b>Основные команды:</b>
• /start - Начать работу с ботом
• /menu - Показать главное меню
• /help - Показать справку

<b>Для покупателей:</b>
• Создать запрос - создание заявки на покупку КРС
• Мои запросы - просмотр ваших заявок
• Все объявления - просмотр доступных предложений

<b>Для поставщиков:</b>
• Создать объявление - размещение нового предложения КРС
• Мои объявления - управление вашими предложениями

<b>Общие функции:</b>
• Сообщения - обмен сообщениями с другими пользователями
• Профиль - просмотр и редактирование вашего профиля

<b>Контакты для поддержки:</b>
• Email: support@cattle-market.ru
• Телефон: +7 (XXX) XXX-XX-XX
`

		await ctx.reply(helpText, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
			},
		})
	}

	@Action('create_request')
	async handleCreateRequest(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.')
				return
			}

			if (user.role !== 'BUYER') {
				await ctx.reply(
					'❌ Создавать запросы могут только покупатели.\n\n' +
						'Если вы хотите стать покупателем, пожалуйста, создайте новый аккаунт с соответствующей ролью.',
				)
				return
			}

			await this.requestService.startRequestCreation(ctx)
		} catch (error) {
			console.error('Ошибка при создании запроса:', error)
			await ctx.reply('❌ Произошла ошибка при создании запроса')
		}
	}

	@Action('edit_profile')
	async handleEditProfile(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик edit_profile')
			await ctx.answerCbQuery()

			// Вызываем метод handleEditProfile из profileService
			await this.profileService.handleEditProfile(ctx)
		} catch (error) {
			console.error('Ошибка при обработке редактирования профиля:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании профиля')
		}
	}

	@Action(/^view_request_(\d+)$/)
	async handleViewRequest(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик view_request')
			await ctx.answerCbQuery()

			// Получаем ID запроса из callback_data
			const callbackData = (ctx.callbackQuery as any).data
			const requestId = parseInt(callbackData.split('_')[2])

			if (isNaN(requestId)) {
				console.error('Некорректный ID запроса:', callbackData)
				await ctx.reply('❌ Произошла ошибка при просмотре запроса')
				return
			}

			console.log(`Просмотр запроса с ID: ${requestId}`)

			// Вызываем метод для отображения деталей запроса
			await this.requestService.showRequestDetails(ctx, requestId)
		} catch (error) {
			console.error('Ошибка при просмотре запроса:', error)
			await ctx.reply('❌ Произошла ошибка при просмотре запроса')
		}
	}

	@Action(/^view_match_(\d+)$/)
	async handleViewMatch(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик view_match')
			await ctx.answerCbQuery()

			// Получаем ID совпадения из callback_data
			const callbackData = (ctx.callbackQuery as any).data
			const matchId = parseInt(callbackData.split('_')[2])

			if (isNaN(matchId)) {
				console.error('Некорректный ID совпадения:', callbackData)
				await ctx.reply('❌ Произошла ошибка при просмотре совпадения')
				return
			}

			console.log(`Просмотр совпадения с ID: ${matchId}`)

			// Вызываем метод для отображения деталей совпадения
			await this.requestService.showMatchDetails(ctx, matchId)
		} catch (error) {
			console.error('Ошибка при просмотре совпадения:', error)
			await ctx.reply('❌ Произошла ошибка при просмотре совпадения')
		}
	}

	@Action(/^close_request_(\d+)$/)
	async handleCloseRequest(@Ctx() ctx: Context) {
		try {
			console.log('Вызван обработчик close_request')
			await ctx.answerCbQuery()

			// Получаем ID запроса из callback_data
			const callbackData = (ctx.callbackQuery as any).data
			const requestId = parseInt(callbackData.split('_')[2])

			if (isNaN(requestId)) {
				console.error('Некорректный ID запроса:', callbackData)
				await ctx.reply('❌ Произошла ошибка при закрытии запроса')
				return
			}

			console.log(`Закрытие запроса с ID: ${requestId}`)

			// Вызываем метод для закрытия запроса
			await this.requestService.closeRequest(ctx, requestId)
		} catch (error) {
			console.error('Ошибка при закрытии запроса:', error)
			await ctx.reply('❌ Произошла ошибка при закрытии запроса')
		}
	}
}
