import { CattlePurpose, CattleType, Equipment, PriceType } from '@prisma/client'
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

	// Вспомогательный метод для проверки авторизации
	private async checkAuth(ctx: Context): Promise<boolean> {
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
			return false
		}

		if (!user.isVerified) {
			await ctx.reply(
				'⏳ Ваша учетная запись находится на модерации.\n' +
					'Пожалуйста, дождитесь подтверждения администратором.\n\n' +
					'Нажмите /start для возврата в главное меню.',
			)
			return false
		}

		return true
	}

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
						{ text: '👤 Покупатель', callback_data: 'register_buyer' },
						{ text: '🛠️ Поставщик', callback_data: 'register_supplier' },
					],
					[{ text: '🚚 Перевозчик', callback_data: 'register_carrier' }],
				],
			},
		})
	}

	@Action('register_buyer')
	async handleRegisterBuyer(@Ctx() ctx: Context) {
		try {
			console.log('Вызван handleRegisterBuyer')
			await ctx.answerCbQuery()
			await this.authService.handleRoleSelection(ctx, 'BUYER')
		} catch (error) {
			console.error('Ошибка при регистрации покупателя:', error)
			await ctx.reply('❌ Произошла ошибка при регистрации')
		}
	}

	@Action('register_supplier')
	async handleRegisterSupplier(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			await this.authService.handleRoleSelection(ctx, 'SUPPLIER')
		} catch (error) {
			console.error('Ошибка при регистрации поставщика:', error)
			await ctx.reply('❌ Произошла ошибка при регистрации')
		}
	}

	@Action('register_carrier')
	async handleRegisterCarrier(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			await this.authService.handleRoleSelection(ctx, 'CARRIER')
		} catch (error) {
			console.error('Ошибка при регистрации перевозчика:', error)
			await ctx.reply('❌ Произошла ошибка при регистрации')
		}
	}

	@Action('skip_mercury_offer')
	async handleSkipMercuryOffer(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			// Пропускаем ввод номера Меркурий и переходим к загрузке фото
			await this.offerService.handleCreateOffer(ctx)
		} catch (error) {
			console.error('Ошибка при пропуске номера Меркурий:', error)
			await ctx.reply('❌ Произошла ошибка при создании объявления')
		}
	}

	// Обработчик для пропуска Меркурия при регистрации
	@Action('skip_mercury_reg')
	async handleSkipMercuryReg(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			await this.authService.handleSkipMercury(ctx)
		} catch (error) {
			console.error('Ошибка при пропуске номера Меркурий:', error)
			await ctx.reply('❌ Произошла ошибка при регистрации')
		}
	}

	@Action(/user_type_.*/)
	async handleUserTypeSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const userType = callbackQuery.data.split('_')[2]

			// Получаем состояние пользователя
			const userId = ctx.from.id

			// Сохраняем тип пользователя в состоянии регистрации
			const state = this.authService.getRegistrationState(userId)
			if (!state) {
				await ctx.reply('❌ Пожалуйста, начните регистрацию заново')
				return
			}

			state.buyerType = userType

			// Для организаций запрашиваем ИНН/ОГРН
			if (userType !== 'PRIVATE') {
				await ctx.reply('Выберите тип идентификатора:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '📝 ИНН', callback_data: 'input_inn' },
								{ text: '📋 ОГРН', callback_data: 'input_ogrn' },
							],
						],
					},
				})
			} else {
				// Для частных лиц сразу переходим к email
				state.inputType = 'email'
				this.authService.updateRegistrationState(userId, state)
				await ctx.reply('📧 Введите ваш email:')
			}
		} catch (error) {
			console.error('Ошибка при выборе типа пользователя:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('input_inn')
	async handleInputInn(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			await this.authService.setInputType(ctx, 'inn')
		} catch (error) {
			console.error('Ошибка при выборе ввода ИНН:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('input_ogrn')
	async handleInputOgrn(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			await this.authService.setInputType(ctx, 'ogrn')
		} catch (error) {
			console.error('Ошибка при выборе ввода ОГРН:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/input_.*/)
	async handleInputTypeSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const inputType = callbackQuery.data.split('_')[1]
		await this.authService.setInputType(ctx, inputType)
	}

	@Action('create_ad')
	async handleCreateAd(@Ctx() ctx: Context) {
		if (!(await this.checkAuth(ctx))) return
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
			const text = (ctx.message as any).text
			const userId = ctx.from.id

			// Проверяем, находится ли пользователь в процессе создания объявления
			const offerState = this.offerService.getOfferState(userId)
			if (offerState && offerState.inputType) {
				await this.offerService.handleOfferInput(ctx, text)
				return
			}

			// Проверяем, находится ли пользователь в процессе входа
			const loginState = this.authService.getLoginState(userId)
			if (loginState) {
				await this.authService.handleLoginInput(ctx, text)
				return
			}

			// Проверяем, находится ли пользователь в процессе регистрации
			const registrationState = this.authService.getRegistrationState(userId)
			if (registrationState) {
				await this.authService.handleTextInput(ctx, text)
				return
			}

			// Проверяем, находится ли пользователь в процессе создания запроса
			const requestState = this.requestService.getRequestState(userId)
			if (requestState) {
				await this.requestService.handleRequestInput(ctx, text)
				return
			}

			// Если пользователь не в процессе входа, регистрации или создания запроса
			await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '🔑 Войти', callback_data: 'login' },
							{ text: '📝 Регистрация', callback_data: 'register' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при обработке текстового сообщения:', error)
			await ctx.reply('❌ Произошла ошибка при обработке сообщения')
		}
	}

	@On('callback_query')
	async handleCallback(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery as any
		const userId = ctx.from.id
		const action = callbackQuery.data

		switch (action) {
			case 'add_comment_':
				const requestId = parseInt(
					callbackQuery.data.replace('add_comment_', ''),
				)
				await ctx.reply('📝 Введите ваш комментарий к запросу:')

				const offerState = this.offerService.getOfferState(userId) || {
					photos: [],
					videos: [],
				}

				offerState.inputType = 'waiting_for_comment'
				offerState.contactRequestId = requestId.toString()
				this.offerService.updateOfferState(userId, offerState)
				return

			case 'ask_ai_': {
				const aiOfferId = callbackQuery.data.replace('ask_ai_', '')
				const aiState = {
					offerId: aiOfferId,
					inputType: 'ai_question',
					photos: [],
					videos: [],
				}
				this.offerService.updateOfferState(userId, aiState)
				await this.offerService.handleAskAI(ctx, aiOfferId)
				return
			}

			case 'calculate_price_': {
				const calcOfferId = callbackQuery.data.replace('calculate_price_', '')
				await this.offerService.handleCalculatePrice(ctx, calcOfferId)
				return
			}

			case 'request_contacts_': {
				const contactOfferId = callbackQuery.data.replace(
					'request_contacts_',
					'',
				)
				await this.requestService.handleRequestContacts(ctx)
				return
			}

			case 'view_offer_': {
				const viewOfferId = callbackQuery.data.replace('view_offer_', '')
				await this.offerService.handleViewOffer(ctx, viewOfferId)
				return
			}

			case 'gut_yes':
				await ctx.answerCbQuery()
				await this.offerService.handleGutDiscountSelection(ctx, true)
				break

			case 'gut_no':
				await ctx.answerCbQuery()
				await this.offerService.handleGutDiscountSelection(ctx, false)
				break

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

			case 'menu':
				await this.telegramService.handleMenu(ctx)
				break

			case 'browse_offers':
			case 'browse_offers_':
				const page =
					callbackQuery.data === 'browse_offers'
						? 1
						: parseInt(callbackQuery.data.replace('browse_offers_', ''))
				await this.offerService.handleBrowseOffers(ctx, page)
				break

			case 'approve_comment':
				{
					const requestId = callbackQuery.data.replace('approve_comment_', '')

					// Обновляем статус запроса
					await this.prisma.contactRequest.update({
						where: { id: requestId },
						data: { status: 'APPROVED' },
					})

					// Получаем запрос с данными покупателя
					const request = await this.prisma.contactRequest.findUnique({
						where: { id: requestId },
						include: {
							buyer: true, // Включаем данные покупателя
							offer: {
								include: {
									user: true, // Включаем данные продавца через объявление
								},
							},
						},
					})

					// Уведомляем покупателя
					if (request.buyer.telegramId) {
						await this.telegramClient.sendMessage(
							request.buyer.telegramId,
							'✅ Ваш запрос на получение контактов был одобрен администратором.',
						)
					}

					await ctx.answerCbQuery('Запрос одобрен')
				}
				break

			case 'reject_comment':
				{
					const requestId = callbackQuery.data.replace('reject_comment_', '')

					// Обновляем статус запроса
					await this.prisma.contactRequest.update({
						where: { id: requestId },
						data: { status: 'REJECTED' },
					})

					// Получаем запрос с данными покупателя
					const request = await this.prisma.contactRequest.findUnique({
						where: { id: requestId },
						include: {
							buyer: true, // Включаем данные покупателя
							offer: {
								include: {
									user: true, // Включаем данные продавца через объявление
								},
							},
						},
					})

					// Уведомляем покупателя
					if (request.buyer.telegramId) {
						await this.telegramClient.sendMessage(
							request.buyer.telegramId,
							'❌ Ваш запрос на получение контактов был отклонен администратором.',
						)
					}

					await ctx.answerCbQuery('Запрос отклонен')
				}
				break

			case 'supplier_type_individual':
				await ctx.answerCbQuery()
				await this.authService.handleUserTypeSelection(ctx, 'INDIVIDUAL')
				break

			case 'supplier_type_organization':
				await ctx.answerCbQuery()
				await this.authService.handleUserTypeSelection(ctx, 'ORGANIZATION')
				break

			case 'input_inn':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.inputType = 'inn'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply(
							'📝 Введите ИНН организации:\n\n' +
								'ИНН должен содержать 10 цифр\n' +
								'Пример: 7736207543',
						)
					}
				}
				break

			case 'input_ogrn':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.inputType = 'ogrn'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply(
							'📝 Введите ОГРН организации:\n\n' +
								'ОГРН должен содержать 13 цифр\n' +
								'Пример: 1027700132195',
						)
					}
				}
				break

			case 'cattle_type_CALVES':
				await ctx.answerCbQuery()
				await this.offerService.handleCattleTypeSelection(ctx, 'CALVES')
				break

			case 'cattle_type_BULL_CALVES':
				await ctx.answerCbQuery()
				await this.offerService.handleCattleTypeSelection(ctx, 'BULL_CALVES')
				break

			case 'cattle_type_HEIFERS':
				await ctx.answerCbQuery()
				await this.offerService.handleCattleTypeSelection(ctx, 'HEIFERS')
				break

			case 'cattle_type_BREEDING_HEIFERS':
				await ctx.answerCbQuery()
				await this.offerService.handleCattleTypeSelection(
					ctx,
					'BREEDING_HEIFERS',
				)
				break

			case 'cattle_type_BULLS':
				await ctx.answerCbQuery()
				await this.offerService.handleCattleTypeSelection(ctx, 'BULLS')
				break

			case 'cattle_type_COWS':
				await ctx.answerCbQuery()
				await this.offerService.handleCattleTypeSelection(ctx, 'COWS')
				break

			case 'purpose_BREEDING':
				await ctx.answerCbQuery()
				await this.offerService.handlePurposeSelection(ctx, 'BREEDING')
				break

			case 'purpose_COMMERCIAL':
				await ctx.answerCbQuery()
				await this.offerService.handlePurposeSelection(ctx, 'COMMERCIAL')
				break

			case 'price_type_PER_HEAD':
				await ctx.answerCbQuery()
				await this.offerService.handlePriceTypeSelection(ctx, 'PER_HEAD')
				break

			case 'price_type_PER_KG':
				await ctx.answerCbQuery()
				await this.offerService.handlePriceTypeSelection(ctx, 'PER_KG')
				break

			case 'customs_yes':
				await ctx.answerCbQuery()
				await this.offerService.handleCustomsUnionSelection(ctx, true)
				break

			case 'customs_no':
				await ctx.answerCbQuery()
				await this.offerService.handleCustomsUnionSelection(ctx, false)
				break

			case 'my_ads':
				await ctx.answerCbQuery()
				await this.offerService.handleMyAds(ctx)
				break

			case 'register':
				await ctx.reply('Выберите вашу роль:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '🛒 Покупатель', callback_data: 'role_BUYER' },
								{ text: '📦 Поставщик', callback_data: 'role_SUPPLIER' },
							],
							[{ text: '🚛 Перевозчик', callback_data: 'role_CARRIER' }],
						],
					},
				})
				break

			case 'role_BUYER':
			case 'role_SUPPLIER':
			case 'role_CARRIER':
				await this.authService.handleRoleSelection(ctx, action.split('_')[1])
				break

			case 'supplier_type_INDIVIDUAL':
			case 'supplier_type_ORGANIZATION':
				await this.authService.handleUserTypeSelection(
					ctx,
					action.replace('supplier_type_', ''),
				)
				break

			case 'buyer_type_INDIVIDUAL':
			case 'buyer_type_ORGANIZATION':
				await this.authService.handleUserTypeSelection(
					ctx,
					action.replace('buyer_type_', ''),
				)
				break

			case 'input_inn':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.inputType = 'inn'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply(
							'📝 Введите ИНН организации:\n\n' +
								'ИНН должен содержать 10 цифр\n' +
								'Пример: 7736207543',
						)
					}
				}
				break

			case 'input_ogrn':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.inputType = 'ogrn'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply(
							'📝 Введите ОГРН организации:\n\n' +
								'ОГРН должен содержать 13 цифр\n' +
								'Пример: 1027700132195',
						)
					}
				}
				break

			case 'skip_vin':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.vehicleVin = null
						state.inputType = 'cattle_exp'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply('🚛 Есть ли у вас опыт перевозки КРС?', {
							reply_markup: {
								inline_keyboard: [
									[
										{ text: '✅ Да', callback_data: 'cattle_exp_yes' },
										{ text: '❌ Нет', callback_data: 'cattle_exp_no' },
									],
								],
							},
						})
					}
				}
				break

			case 'cattle_exp_yes':
				await ctx.answerCbQuery()
				const expState = await this.authService.getRegistrationState(userId)
				if (expState) {
					expState.hasCattleExp = true
					expState.inputType = 'cattle_exp_years'
					await this.authService.updateRegistrationState(userId, expState)
					await ctx.reply('📅 Укажите опыт перевозки КРС (в годах):')
				}
				break

			case 'cattle_exp_no':
				await ctx.answerCbQuery()
				const noExpState = await this.authService.getRegistrationState(userId)
				if (noExpState) {
					noExpState.hasCattleExp = false
					noExpState.cattleExpYears = 0
					noExpState.inputType = 'equipment'
					await this.authService.updateRegistrationState(userId, noExpState)
					await ctx.reply('🔧 Выберите имеющееся оборудование:', {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: '💧 Поилки', callback_data: 'eq_water' },
									{ text: '💨 Вентиляция', callback_data: 'eq_vent' },
								],
								[
									{ text: '🌡️ Контроль температуры', callback_data: 'eq_temp' },
									{ text: '📹 Видеонаблюдение', callback_data: 'eq_cctv' },
								],
								[
									{ text: '📍 GPS-трекер', callback_data: 'eq_gps' },
									{ text: '🛗 Погрузочная рампа', callback_data: 'eq_ramp' },
								],
								[{ text: '➡️ Далее', callback_data: 'equipment_done' }],
							],
						},
					})
				}
				break

			case 'buyer_type_PRIVATE':
			case 'buyer_type_FARM':
			case 'buyer_type_AGRICULTURAL':
			case 'buyer_type_MEAT_FACTORY':
			case 'buyer_type_FEEDLOT':
			case 'buyer_type_GRANT_MEMBER':
				await ctx.answerCbQuery()
				const buyerType = action.replace('buyer_type_', '')
				await this.authService.handleUserTypeSelection(ctx, buyerType)
				break

			case 'input_inn':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.inputType = 'inn'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply(
							'📝 Введите ИНН организации:\n\n' +
								'ИНН должен содержать 10 цифр\n' +
								'Пример: 7736207543',
						)
					}
				}
				break

			case 'input_ogrn':
				{
					const state = await this.authService.getRegistrationState(userId)
					if (state) {
						state.inputType = 'ogrn'
						await this.authService.updateRegistrationState(userId, state)
						await ctx.reply(
							'📝 Введите ОГРН организации:\n\n' +
								'ОГРН должен содержать 13 цифр\n' +
								'Пример: 1027700132195',
						)
					}
				}
				break

			case 'carrier_type_PRIVATE':
			case 'carrier_type_ORGANIZATION':
				await ctx.answerCbQuery()
				const carrierType = action.replace('carrier_type_', '')
				await this.authService.handleUserTypeSelection(ctx, carrierType)
				break

			case 'vehicle_type_TRUCK':
			case 'vehicle_type_CATTLE_TRUCK':
				await ctx.answerCbQuery()
				const vehicleType = action.replace('vehicle_type_', '')
				const registrationState =
					await this.authService.getRegistrationState(userId)
				if (registrationState) {
					registrationState.vehicleType = vehicleType
					registrationState.inputType = 'vehicle_brand'
					await this.authService.updateRegistrationState(
						userId,
						registrationState,
					)
					await ctx.reply('🚛 Введите марку транспортного средства:')
				}
				break

			case 'equipment_':
				await ctx.answerCbQuery()
				const equipmentState =
					await this.authService.getRegistrationState(userId)
				if (equipmentState) {
					equipmentState.equipment = equipmentState.equipment || []
					const keyboard = [
						[
							{
								text: `${equipmentState.equipment.includes(Equipment.WATER_SYSTEM) ? '✅' : '💧'} Поилки`,
								callback_data: 'eq_water',
							},
							{
								text: `${equipmentState.equipment.includes(Equipment.VENTILATION) ? '✅' : '💨'} Вентиляция`,
								callback_data: 'eq_vent',
							},
						],
						[
							{
								text: `${equipmentState.equipment.includes(Equipment.TEMPERATURE_CONTROL) ? '✅' : '🌡️'} Контроль температуры`,
								callback_data: 'eq_temp',
							},
							{
								text: `${equipmentState.equipment.includes(Equipment.CCTV) ? '✅' : '📹'} Видеонаблюдение`,
								callback_data: 'eq_cctv',
							},
						],
						[
							{
								text: `${equipmentState.equipment.includes(Equipment.GPS_TRACKER) ? '✅' : '📍'} GPS-трекер`,
								callback_data: 'eq_gps',
							},
							{
								text: `${equipmentState.equipment.includes(Equipment.LOADING_RAMP) ? '✅' : '🛗'} Погрузочная рампа`,
								callback_data: 'eq_ramp',
							},
						],
						[{ text: '➡️ Далее', callback_data: 'equipment_done' }],
					]
					await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard })
				}
				break

			case 'eq_water':
			case 'eq_vent':
			case 'eq_temp':
			case 'eq_cctv':
			case 'eq_gps':
			case 'eq_ramp':
				await this.handleEquipmentSelection(ctx)
				break

			case 'equipment_done':
				await this.handleEquipmentDone(ctx)
				break

			case 'sanitary_yes':
				await ctx.answerCbQuery()
				const yesState = await this.authService.getRegistrationState(userId)
				if (yesState) {
					yesState.sanitaryPassport = true
					yesState.inputType = 'sanitary_exp_date'
					await this.authService.updateRegistrationState(userId, yesState)
					await ctx.reply(
						'📅 Введите дату окончания действия санитарного паспорта (ДД.ММ.ГГГГ):',
					)
				}
				break

			case 'sanitary_no':
				await ctx.answerCbQuery()
				const noState = await this.authService.getRegistrationState(userId)
				if (noState) {
					noState.sanitaryPassport = false
					noState.sanitaryExpDate = null
					// Завершаем регистрацию
					await this.authService.completeRegistration(ctx, noState)
				}
				break

			default:
				console.log('Неизвестный callback:', action)
		}
	}

	@On('photo')
	async handlePhoto(@Ctx() ctx: Context) {
		try {
			if (!(await this.checkAuth(ctx))) {
				return
			}

			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)

			if (state) {
				await this.offerService.handlePhotoUpload(ctx)
				return
			}

			await ctx.reply(
				'Чтобы загрузить фотографию, начните создание объявления с помощью команды /create_offer',
			)
		} catch (error) {
			console.error('Ошибка при обработке фотографии:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке фотографии')
		}
	}

	@On('video')
	async handleVideo(@Ctx() ctx: Context) {
		try {
			// Проверяем авторизацию
			if (!(await this.checkAuth(ctx))) {
				return
			}

			const userId = ctx.from.id
			const offerState = this.offerService.getOfferState(userId)

			if (offerState) {
				// Используем handleVideoUpload вместо handlePhoto
				await this.offerService.handleVideoUpload(ctx)
				return
			}

			// Если нет активного состояния создания объявления
			await ctx.reply(
				'Чтобы загрузить видео, начните создание объявления с помощью команды /create_offer',
			)
		} catch (error) {
			console.error('Ошибка при обработке видео:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке видео')
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
	async handleRequestContacts(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			// Извлекаем ID объявления из callback_data
			//@ts-ignore
			const offerId = ctx.callbackQuery.data.replace('request_contacts_', '')
			const userId = ctx.from.id

			// Сохраняем состояние для обработки комментария
			const requestState = {
				offerId,
				inputType: 'contact_request_comment',
				photos: [],
				videos: [],
			}
			this.offerService.updateOfferState(userId, requestState)

			await ctx.reply(
				'📝 Пожалуйста, добавьте комментарий к вашему запросу на контакты (например, опишите сколько и когда вы планируете купить):',
			)
		} catch (error) {
			console.error('Ошибка при запросе контактов:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
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
				status: 'ARCHIVED',
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
							{ text: '🐮 За голову', callback_data: 'price_type_PER_HEAD' },
							{ text: '⚖️ За кг', callback_data: 'price_type_PER_KG' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при выборе назначения:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
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
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявления пользователя
			const offers = await this.prisma.offer.findMany({
				where: {
					userId: user.id,
				},
				include: {
					images: true,
					matches: true,
				},
				orderBy: {
					createdAt: 'desc',
				},
			})

			if (offers.length === 0) {
				await ctx.reply('📭 У вас пока нет объявлений', {
					reply_markup: {
						inline_keyboard: [
							[{ text: '📝 Создать объявление', callback_data: 'create_ad' }],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				})
				return
			}

			// Отправляем каждое объявление отдельным сообщением
			for (const offer of offers) {
				let message = `
📋 <b>${offer.title}</b>

🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/голову` : `${offer.pricePerKg} ₽/кг`}
📍 Регион: ${offer.region}
📬 Заявок: ${offer.matches.length}
`

				const buttons = [
					[
						{
							text: '✏️ Редактировать',
							callback_data: `edit_offer_${offer.id}`,
						},
						{ text: '❌ Удалить', callback_data: `delete_offer_${offer.id}` },
					],
				]

				if (offer.matches.length > 0) {
					buttons.unshift([
						{
							text: '👥 Просмотреть заявки',
							callback_data: `view_matches_${offer.id}`,
						},
					])
				}

				buttons.push([{ text: '« Меню', callback_data: 'menu' }])

				// Если есть фотографии, отправляем первую с текстом
				if (offer.images && offer.images.length > 0) {
					await ctx.replyWithPhoto(offer.images[0].url, {
						caption: message,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: buttons,
						},
					})
				} else {
					await ctx.reply(message, {
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: buttons,
						},
					})
				}
			}
		} catch (error) {
			console.error('Ошибка при отображении объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявлений')
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
									{ text: '📝 Создать объявление', callback_data: 'create_ad' },
									{ text: '📋 Мои объявления', callback_data: 'my_ads' },
								],
								[
									{ text: '📋 Все запросы', callback_data: 'all_requests' },
									{ text: messagesText, callback_data: 'messages' },
								],
								[{ text: '👤 Мой профиль', callback_data: 'profile' }],
								[{ text: '❓ Помощь', callback_data: 'help' }],
								[{ text: '🚪 Выйти', callback_data: 'logout' }],
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

			// Получаем запрос из базы с нужными связями
			const request = await this.prisma.contactRequest.findUnique({
				where: { id: requestId },
				include: {
					offer: true,
					buyer: true, // Заменяем requester на buyer
				},
			})

			// Обновляем сообщение об одобрении
			await ctx.editMessageText(
				`✅ Вы одобрили запрос на контакты для объявления "${request.offer.title}".\n\n` +
					`Покупатель ${request.buyer.name || request.buyer.email} теперь может видеть контактные данные продавца.`,
				{ parse_mode: 'HTML' },
			)

			// Отправляем уведомление продавцу
			const seller = await this.prisma.user.findUnique({
				where: { id: request.sellerId },
			})

			if (seller && seller.telegramId) {
				await this.telegramClient.sendMessage(
					seller.telegramId,
					`✅ Администратор одобрил запрос на контакты для вашего объявления "${request.offer.title}".\n\n` +
						`Покупатель ${request.buyer.name} теперь может видеть ваши контактные данные.`,
				)
			}

			// Отправляем уведомление покупателю с данными продавца
			const buyerTelegramId = request.buyer.telegramId
			if (buyerTelegramId) {
				const sellerInfo = await this.prisma.user.findUnique({
					where: { id: request.sellerId },
				})

				await this.telegramClient.sendMessage(
					buyerTelegramId,
					`✅ Ваш запрос на контакты для объявления "${request.offer.title}" одобрен администратором!\n\n` +
						`<b>Контактные данные продавца:</b>\n` +
						`Имя: ${sellerInfo.name}\n` +
						`Телефон: ${sellerInfo.phone || 'Не указан'}\n` +
						`Email: ${sellerInfo.email}`,
					{ parse_mode: 'HTML' },
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

			// Получаем запрос из базы с нужными связями
			const request = await this.prisma.contactRequest.findUnique({
				where: { id: requestId },
				include: {
					offer: true,
					buyer: true, // Заменяем requester на buyer
				},
			})

			// Обновляем сообщение об отклонении
			await ctx.editMessageText(
				`❌ Вы отклонили запрос на контакты для объявления "${request.offer.title}".`,
				{ parse_mode: 'HTML' },
			)

			// Отправляем уведомление покупателю
			const buyerTelegramId = request.buyer.telegramId
			if (buyerTelegramId) {
				await this.telegramClient.sendMessage(
					buyerTelegramId,
					`❌ Администратор отклонил ваш запрос на контакты для объявления "${request.offer.title}".`,
					{ parse_mode: 'HTML' },
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
	@Action('my_ads')
	async handleMyAds(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявления пользователя
			const offers = await this.prisma.offer.findMany({
				where: {
					userId: user.id,
				},
				include: {
					images: true,
					matches: true,
				},
				orderBy: {
					createdAt: 'desc',
				},
			})

			if (offers.length === 0) {
				await ctx.reply('📭 У вас пока нет объявлений', {
					reply_markup: {
						inline_keyboard: [
							[{ text: '📝 Создать объявление', callback_data: 'create_ad' }],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				})
				return
			}

			// Отправляем каждое объявление отдельным сообщением
			for (const offer of offers) {
				let message = `
📋 <b>${offer.title}</b>

🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/голову` : `${offer.pricePerKg} ₽/кг`}
📍 Регион: ${offer.region}
📬 Заявок: ${offer.matches.length}
`

				const buttons = [
					[
						{
							text: '👁️ Просмотреть',
							callback_data: `view_my_offer_${offer.id}`,
						},
					],
					[
						{
							text: '✏️ Редактировать',
							callback_data: `edit_offer_${offer.id}`,
						},
						{ text: '❌ Удалить', callback_data: `delete_offer_${offer.id}` },
					],
				]

				if (offer.matches.length > 0) {
					buttons.unshift([
						{
							text: `👥 Заявки (${offer.matches.length})`,
							callback_data: `view_matches_${offer.id}`,
						},
					])
				}

				buttons.push([{ text: '« Меню', callback_data: 'menu' }])

				// Если есть фотографии, отправляем первую с текстом
				if (offer.images && offer.images.length > 0) {
					await ctx.replyWithPhoto(offer.images[0].url, {
						caption: message,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: buttons,
						},
					})

					// Отправляем остальные фотографии, если есть
					for (let i = 1; i < offer.images.length; i++) {
						await ctx.replyWithPhoto(offer.images[i].url)
					}
				} else {
					await ctx.reply(message, {
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: buttons,
						},
					})
				}
			}
		} catch (error) {
			console.error('Ошибка при отображении объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявлений')
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
• Все запросы - просмотр запросов покупателей

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
			console.log('Вызван handleCreateRequest')
			await ctx.answerCbQuery()

			// Проверяем авторизацию
			if (!(await this.checkAuth(ctx))) {
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

	@Action('all_requests')
	async handleAllRequests(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Для поставщика показываем все активные запросы
			if (user.role === 'SUPPLIER') {
				await this.requestService.showAllRequests(ctx)
			} else {
				await ctx.reply('❌ Доступ запрещен')
			}
		} catch (error) {
			console.error('Ошибка при отображении запросов:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке запросов')
		}
	}

	@Action(/^offer_cattle_.*/)
	async handleOfferCattle(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const requestId = callbackQuery.data.replace('offer_cattle_', '')

			// Передаем только контекст
			await this.requestService.handleOfferCattle(ctx)
		} catch (error) {
			console.error('Ошибка при предложении КРС:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/^view_my_offer_.*/)
	async handleViewMyOffer(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const offerId = callbackQuery.data.replace('view_my_offer_', '')

			// Получаем объявление с полными данными
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					images: true,
					matches: true,
					user: true,
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Формируем подробное сообщение об объявлении
			let message = `
📋 <b>${offer.title}</b>

🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/голову` : `${offer.pricePerKg} ₽/кг`}
📍 Регион: ${offer.region}
📬 Заявок: ${offer.matches.length}

${offer.description ? `📝 Описание: ${offer.description}\n` : ''}
${offer.breed ? `🐮 Порода: ${offer.breed}\n` : ''}
${offer.gktDiscount ? `🔻 Скидка на ЖКТ: ${offer.gktDiscount}%\n` : ''}
${offer.customsUnion ? '✅ В реестре Таможенного союза\n' : ''}
📅 Создано: ${offer.createdAt.toLocaleDateString('ru-RU')}
`

			// Создаем кнопки управления
			const buttons = [
				[
					{
						text: '✏️ Редактировать',
						callback_data: `edit_offer_${offer.id}`,
					},
					{ text: '❌ Удалить', callback_data: `delete_offer_${offer.id}` },
				],
			]

			// Если есть заявки, добавляем кнопку просмотра
			if (offer.matches.length > 0) {
				buttons.unshift([
					{
						text: `👥 Просмотреть заявки (${offer.matches.length})`,
						callback_data: `view_matches_${offer.id}`,
					},
				])
			}

			// Добавляем навигационные кнопки
			buttons.push([
				{ text: '« Назад к списку', callback_data: 'my_ads' },
				{ text: '« Меню', callback_data: 'menu' },
			])

			// Если есть фотографии, отправляем с первой фотографией
			if (offer.images && offer.images.length > 0) {
				await ctx.replyWithPhoto(offer.images[0].url, {
					caption: message,
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: buttons,
					},
				})

				// Отправляем остальные фотографии, если есть
				for (let i = 1; i < offer.images.length; i++) {
					await ctx.replyWithPhoto(offer.images[i].url)
				}
			} else {
				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: buttons,
					},
				})
			}
		} catch (error) {
			console.error('Ошибка при просмотре объявления:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявления')
		}
	}

	@Action(/^view_matches_.*/)
	async handleViewMatches(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const offerId = callbackQuery.data.replace('view_matches_', '')

			// Получаем объявление со всеми заявками
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					matches: {
						include: {
							request: {
								include: {
									user: true,
								},
							},
						},
					},
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			if (offer.matches.length === 0) {
				await ctx.reply('📭 Нет активных заявок', {
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '« Назад к объявлению',
									callback_data: `view_my_offer_${offerId}`,
								},
							],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				})
				return
			}

			// Формируем сообщение со списком заявок
			const message = `📋 <b>Заявки на покупку (${offer.matches.length}):</b>`

			// Создаем кнопки для каждой заявки
			const buttons = offer.matches.map(match => [
				{
					text: `${match.request.user.name} - ${match.request.quantity} голов, ${match.request.price}₽`,
					callback_data: `view_match_details_${match.id}`,
				},
			])

			// Добавляем навигационные кнопки
			buttons.push([
				{
					text: '« Назад к объявлению',
					callback_data: `view_my_offer_${offerId}`,
				},
			])
			buttons.push([{ text: '« Меню', callback_data: 'menu' }])

			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: buttons,
				},
			})
		} catch (error) {
			console.error('Ошибка при просмотре заявок:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке заявок')
		}
	}

	// Добавляем новый обработчик для просмотра деталей заявки
	@Action(/^view_match_details_.*/)
	async handleViewMatchDetails(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const matchId = parseInt(
				callbackQuery.data.replace('view_match_details_', ''),
			) // Преобразуем в число

			// Получаем данные о заявке
			const match = await this.prisma.match.findUnique({
				where: { id: matchId }, // Теперь id будет числом
				include: {
					request: {
						include: {
							user: true,
						},
					},
					offer: true,
				},
			})

			if (!match) {
				await ctx.reply('❌ Заявка не найдена')
				return
			}

			const request = match.request
			const message = `
📋 <b>Детали заявки</b>

👤 Покупатель: ${request.user.name}
🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🌱 Возраст: ${request.age} мес.
💰 Цена: ${request.price} ₽/гол
📍 Локация: ${request.location}
📅 Дата создания: ${request.createdAt.toLocaleDateString('ru-RU')}
`

			const buttons = [
				[
					{
						text: '📞 Связаться с покупателем',
						callback_data: `contact_buyer_${request.userId}`,
					},
				],
				[
					{
						text: '💬 Написать сообщение',
						callback_data: `send_message_${request.userId}`,
					},
				],
				[
					{
						text: '« Назад к списку заявок',
						callback_data: `view_matches_${match.offer.id}`,
					},
				],
				[{ text: '« Меню', callback_data: 'menu' }],
			]

			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: buttons,
				},
			})
		} catch (error) {
			console.error('Ошибка при просмотре деталей заявки:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке деталей заявки')
		}
	}

	@Action(/supplier_type_.*/)
	async handleSupplierTypeSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const type = callbackQuery.data.replace('supplier_type_', '')
			await this.authService.handleUserTypeSelection(ctx, type)
		} catch (error) {
			console.error('Ошибка при выборе типа поставщика:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('start')
	async handleStartAction(@Ctx() ctx: Context) {
		await this.start(ctx)
	}

	@Action(/request_purpose_.*/)
	async handleRequestPurpose(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const purpose = callbackQuery.data.split('_')[2]
			await this.requestService.handlePurposeSelection(ctx, purpose)
		} catch (error) {
			console.error('Ошибка при выборе цели:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('skip_description')
	async handleSkipDescription(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			await this.requestService.completeRequest(ctx)
		} catch (error) {
			console.error('Ошибка при пропуске описания:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/contact_seller_.*/)
	async handleContactSeller(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const offerId = callbackQuery.data.split('_')[2]
			await this.requestService.handleRequestContacts(ctx) // Изменено с handleContactSeller
		} catch (error) {
			console.error('Ошибка при запросе контакта с продавцом:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/request_export_.*/)
	async handleRequestExport(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const isExport = callbackQuery.data.split('_')[2] === 'yes'
			await this.requestService.handleExportSelection(ctx, isExport)
		} catch (error) {
			console.error('Ошибка при выборе экспорта:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/request_breeding_.*/)
	async handleRequestBreeding(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const isBreeding = callbackQuery.data.split('_')[2] === 'yes'
			await this.requestService.handleBreedingSelection(ctx, isBreeding)
		} catch (error) {
			console.error('Ошибка при выборе племенного разведения:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/price_type_.*/)
	async handlePriceTypeSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			const userId = ctx.from.id
			const state = this.offerService.getOfferState(userId)

			// Извлекаем полное значение PER_HEAD или PER_KG
			//@ts-ignore
			const callbackData = ctx.callbackQuery.data
			const priceType = callbackData.replace('price_type_', '') as PriceType

			console.log('Выбран тип цены:', priceType)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			if (priceType === 'PER_HEAD') {
				state.priceType = 'PER_HEAD'
				state.inputType = 'price_per_head'
				this.offerService.updateOfferState(userId, state)
				await ctx.reply('💰 Введите цену за голову (₽):')
			} else if (priceType === 'PER_KG') {
				state.priceType = 'PER_KG'
				state.inputType = 'price_per_kg'
				this.offerService.updateOfferState(userId, state)
				await ctx.reply('⚖️ Введите цену за кг (₽):')
			}
		} catch (error) {
			console.error('Ошибка при выборе типа цены:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	@Action(/view_offer_.*/)
	async handleViewOffer(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			// Извлекаем ID объявления из callback_data
			//@ts-ignore
			const offerId = ctx.callbackQuery.data.replace('view_offer_', '')

			// Получаем объявление из базы данных со всеми связанными данными
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					images: true,
					user: {
						select: {
							name: true,
							phone: true,
							mercuryNumber: true,
						},
					},
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено или было удалено')
				return
			}

			// Формируем сообщение с данными объявления
			let statusText = ''
			switch (offer.status) {
				case 'APPROVED':
					statusText = '🟢 Активно'
					break
				case 'PENDING':
					statusText = '🟡 На модерации'
					break
				case 'ARCHIVED':
					statusText = '⚪ Архивировано'
					break
				case 'REJECTED':
					statusText = '🔴 Отклонено'
					break
			}

			const cattleTypeText = {
				CALVES: '🐮 Телята',
				BULL_CALVES: '🐂 Бычки',
				HEIFERS: '🐄 Телки',
				BREEDING_HEIFERS: '🐄 Нетели',
				BULLS: '🐂 Быки',
				COWS: '🐄 Коровы',
			}[offer.cattleType]

			const purposeText = {
				COMMERCIAL: '💼 Коммерческое',
				BREEDING: '🧬 Племенное',
			}[offer.purpose]

			const offerMessage = `
${statusText}

📋 <b>${offer.title}</b>

${cattleTypeText} - ${offer.breed || 'Порода не указана'}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
🎯 Назначение: ${purposeText}
💰 Цена: ${
				offer.priceType === 'PER_HEAD'
					? offer.pricePerHead > 0
						? `${offer.pricePerHead} ₽/гол`
						: `${offer.pricePerKg} ₽/кг`
					: `${offer.pricePerKg} ₽/кг`
			}
📍 Регион: ${offer.region || 'Не указан'}
${offer.description ? `\n📝 Описание: ${offer.description}` : ''}
${offer.gktDiscount ? `\n🎯 Скидка ЖКТ: ${offer.gktDiscount}%` : ''}
${offer.customsUnion ? '\n🌍 Для стран ТС' : ''}

📅 Создано: ${new Date(offer.createdAt).toLocaleDateString('ru-RU')}`

			// Определяем кнопки в зависимости от роли пользователя
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			const buttons = []

			// Добавляем кнопку запроса контактов для покупателей
			if (user && user.role === 'BUYER') {
				buttons.push([
					{
						text: '📞 Запросить контакты',
						callback_data: `request_contacts_${offerId}`,
					},
				])

				// Добавляем кнопки AI-вопроса и расчета цены для покупателей
				buttons.push([
					{
						text: '🤖 Спросить AI',
						callback_data: `ask_ai_${offerId}`,
					},
					{
						text: '🧮 Рассчитать цену',
						callback_data: `calculate_price_${offerId}`,
					},
				])
			}

			// Добавляем кнопку возврата
			buttons.push([{ text: '« Назад', callback_data: 'browse_offers' }])

			// Отправляем изображения, если они есть
			if (offer.images && offer.images.length > 0) {
				// Отправляем первое изображение с текстом и кнопками
				await ctx.replyWithPhoto(offer.images[0].url, {
					caption: offerMessage,
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: buttons,
					},
				})

				// Отправляем остальные изображения, если их больше одного
				for (let i = 1; i < Math.min(offer.images.length, 5); i++) {
					await ctx.replyWithPhoto(offer.images[i].url)
				}
			} else {
				// Если нет изображений, отправляем только текст
				await ctx.reply(offerMessage, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: buttons,
					},
				})
			}
		} catch (error) {
			console.error('Ошибка при просмотре объявления:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявления')
		}
	}

	// Добавим обработчик для запроса к AI
	@Action(/ask_ai_.*/)
	async handleAskAI(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			// Извлекаем ID объявления из callback_data
			//@ts-ignore
			const offerId = ctx.callbackQuery.data.replace('ask_ai_', '')
			const userId = ctx.from.id

			// Сохраняем состояние для обработки вопроса к AI
			const aiState = {
				offerId,
				inputType: 'ai_question',
				photos: [], // Добавляем пустые массивы
				videos: [],
			}
			this.offerService.updateOfferState(userId, aiState)

			await ctx.reply(
				'🤖 Задайте вопрос об этом объявлении, и AI ответит на него:',
			)
		} catch (error) {
			console.error('Ошибка при запросе к AI:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	// Добавим обработчик для расчета цены
	@Action(/calculate_price_.*/)
	async handleCalculatePrice(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()

			// Извлекаем ID объявления из callback_data
			//@ts-ignore
			const offerId = ctx.callbackQuery.data.replace('calculate_price_', '')

			// Получаем объявление из базы данных
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено или было удалено')
				return
			}

			const userId = ctx.from.id

			// Сохраняем состояние для расчета цены
			const calculateState = {
				offerId,
				inputType: 'calculate_quantity',
				priceType: offer.priceType,
				pricePerHead: offer.pricePerHead,
				pricePerKg: offer.pricePerKg,
				photos: [], // Добавляем пустые массивы
				videos: [],
			}

			this.offerService.updateOfferState(userId, calculateState)

			// Запрашиваем количество в зависимости от типа цены
			if (offer.priceType === 'PER_HEAD') {
				await ctx.reply(
					'🔢 Введите количество голов, которое вы хотите приобрести:',
				)
			} else {
				await ctx.reply(
					'⚖️ Введите количество килограммов, которое вы хотите приобрести:',
				)
			}
		} catch (error) {
			console.error('Ошибка при расчете цены:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/^page_(\d+)$/)
	async handlePagination(@Ctx() ctx: Context) {
		try {
			const callbackQuery = ctx.callbackQuery as any // временное решение
			const match = callbackQuery.data.match(/^page_(\d+)$/)
			if (!match) return

			const page = parseInt(match[1])
			const offers = await this.offerService.getOffersList(ctx, page)

			// Отправляем список объявлений
			await ctx.editMessageText('📋 Список объявлений:', {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						...offers.topOffers.map(offer => [
							{
								text: '👁 Просмотреть',
								callback_data: `view_offer_${offer}`,
							},
						]),
						[
							offers.currentPage > 1
								? {
										text: '⬅️ Назад',
										callback_data: `page_${offers.currentPage - 1}`,
									}
								: null,
							offers.hasMore
								? {
										text: 'Вперед ➡️',
										callback_data: `page_${offers.currentPage + 1}`,
									}
								: null,
						].filter(Boolean),
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при обработке пагинации:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявлений')
		}
	}

	@Action(/carrier_type_.*/)
	async handleCarrierTypeSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			// Исправляем получение data из callbackQuery
			const callbackQuery = ctx.callbackQuery as any
			const type = callbackQuery.data.replace('carrier_type_', '')
			await this.authService.handleUserTypeSelection(ctx, type)
		} catch (error) {
			console.error('Ошибка при выборе типа перевозчика:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('skip_vin')
	async handleSkipVin(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = this.authService.getRegistrationState(userId)

			if (!state) {
				await ctx.reply('❌ Начните регистрацию заново')
				return
			}

			state.vehicleVin = null
			state.inputType = 'email'
			this.authService.updateRegistrationState(userId, state)
			await ctx.reply('📧 Введите ваш email:')
		} catch (error) {
			console.error('Ошибка при пропуске VIN:', error)
			await ctx.reply('❌ Произошла ошибка')
		}
	}

	@Action(/buyer_type_.*/)
	async handleBuyerTypeSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const type = callbackQuery.data.replace('buyer_type_', '')
			await this.authService.handleUserTypeSelection(ctx, type)
		} catch (error) {
			console.error('Ошибка при выборе типа покупателя:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('input_inn')
	async handleInnInput(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)
			if (state) {
				state.inputType = 'inn'
				await this.authService.updateRegistrationState(userId, state)
				await ctx.reply(
					'📝 Введите ИНН организации:\n\n' +
						'ИНН должен содержать 10 цифр\n' +
						'Пример: 7736207543',
				)
			}
		} catch (error) {
			console.error('Ошибка при обработке ввода ИНН:', error)
			await ctx.reply('❌ Произошла ошибка')
		}
	}

	@Action('input_ogrn')
	async handleOgrnInput(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)
			if (state) {
				state.inputType = 'ogrn'
				await this.authService.updateRegistrationState(userId, state)
				await ctx.reply(
					'📝 Введите ОГРН организации:\n\n' +
						'ОГРН должен содержать 13 цифр\n' +
						'Пример: 1027700132195',
				)
			}
		} catch (error) {
			console.error('Ошибка при обработке ввода ОГРН:', error)
			await ctx.reply('❌ Произошла ошибка')
		}
	}

	@Action(/vehicle_type_.*/)
	async handleVehicleType(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const type = callbackQuery.data.replace('vehicle_type_', '')
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)
			if (state) {
				state.vehicleType = type
				state.inputType = 'vehicle_brand'
				await this.authService.updateRegistrationState(userId, state)
				await ctx.reply('🚛 Введите марку транспортного средства:')
			}
		} catch (error) {
			console.error('Ошибка при выборе типа транспорта:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action(/eq_.*/)
	async handleEquipmentSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const equipment = callbackQuery.data.replace('eq_', '')
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)

			if (state) {
				state.equipment = state.equipment || []

				// Преобразуем callback в enum
				const equipmentMap = {
					water: Equipment.WATER_SYSTEM,
					vent: Equipment.VENTILATION,
					temp: Equipment.TEMPERATURE_CONTROL,
					cctv: Equipment.CCTV,
					gps: Equipment.GPS_TRACKER,
					ramp: Equipment.LOADING_RAMP,
				}

				const equipmentEnum =
					equipmentMap[equipment as keyof typeof equipmentMap]
				if (!equipmentEnum) return

				const equipmentIndex = state.equipment.indexOf(equipmentEnum)
				if (equipmentIndex === -1) {
					state.equipment.push(equipmentEnum)
				} else {
					state.equipment.splice(equipmentIndex, 1)
				}

				await this.authService.updateRegistrationState(userId, state)

				// Обновляем сообщение с новыми кнопками
				const keyboard = [
					[
						{
							text: `${state.equipment.includes(Equipment.WATER_SYSTEM) ? '✅' : '💧'} Поилки`,
							callback_data: 'eq_water',
						},
						{
							text: `${state.equipment.includes(Equipment.VENTILATION) ? '✅' : '💨'} Вентиляция`,
							callback_data: 'eq_vent',
						},
					],
					[
						{
							text: `${state.equipment.includes(Equipment.TEMPERATURE_CONTROL) ? '✅' : '🌡️'} Контроль температуры`,
							callback_data: 'eq_temp',
						},
						{
							text: `${state.equipment.includes(Equipment.CCTV) ? '✅' : '📹'} Видеонаблюдение`,
							callback_data: 'eq_cctv',
						},
					],
					[
						{
							text: `${state.equipment.includes(Equipment.GPS_TRACKER) ? '✅' : '📍'} GPS-трекер`,
							callback_data: 'eq_gps',
						},
						{
							text: `${state.equipment.includes(Equipment.LOADING_RAMP) ? '✅' : '🛗'} Погрузочная рампа`,
							callback_data: 'eq_ramp',
						},
					],
					[{ text: '➡️ Далее', callback_data: 'equipment_done' }],
				]

				await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard })
			}
		} catch (error) {
			console.error('Ошибка при выборе оборудования:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('equipment_done')
	async handleEquipmentDone(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)
			if (state) {
				state.inputType = 'working_regions'
				await this.authService.updateRegistrationState(userId, state)
				await ctx.reply('📍 Укажите регионы работы через запятую:')
			}
		} catch (error) {
			console.error('Ошибка при завершении выбора оборудования:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('sanitary_yes')
	async handleSanitaryYes(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)
			if (state) {
				state.sanitaryPassport = true
				state.inputType = 'sanitary_exp_date'
				await this.authService.updateRegistrationState(userId, state)
				await ctx.reply(
					'📅 Введите дату окончания действия санитарного паспорта (ДД.ММ.ГГГГ):',
				)
			}
		} catch (error) {
			console.error('Ошибка при обработке наличия санитарного паспорта:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	@Action('sanitary_no')
	async handleSanitaryNo(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = await this.authService.getRegistrationState(userId)
			if (state) {
				state.sanitaryPassport = false
				state.sanitaryExpDate = null
				// Завершаем регистрацию
				await this.authService.completeRegistration(ctx, state)
			}
		} catch (error) {
			console.error(
				'Ошибка при обработке отсутствия санитарного паспорта:',
				error,
			)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}
}
