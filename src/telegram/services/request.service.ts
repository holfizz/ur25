// Сервис для работы с запросами на покупку
import { Injectable } from '@nestjs/common'
import { CattleType, Match, User } from '@prisma/client'
import { Action, Ctx } from 'nestjs-telegraf'
import { Context, Markup } from 'telegraf'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'
import { TelegramOfferService } from './offer.service'

// Определяем локальный enum Purpose, если его нет в @prisma/client
export enum Purpose {
	MEAT = 'MEAT',
	BREEDING = 'BREEDING',
	DAIRY = 'DAIRY',
	FATTENING = 'FATTENING',
}

interface RequestState {
	purpose?: Purpose
	breed?: string // Порода
	quantity?: number // Количество голов
	weight?: number // Вес
	age?: number // Возраст
	deadline?: string // Сроки (изменяем тип с Date на string)
	maxPrice?: number // Максимальная цена
	location?: string // Местоположение фермы
	region?: string // Регион покупки
	title?: string
	price?: number
	inputType?: string
	cattleType?: CattleType
	description?: string
	ageGroup?: string
	userId?: string
	isExport?: boolean // Для экспорта
	isBreeding?: boolean // Для племенного разведения
	deliveryDate?: string // Добавляем поле для даты доставки
}

interface MatchWithRelations extends Match {
	request: Request & {
		user: User
	}
}

@Injectable()
export class TelegramRequestService {
	private requestStates: Map<number, RequestState> = new Map()

	constructor(
		private prisma: PrismaService,
		private telegramClient: TelegramClient,
		private offerService: TelegramOfferService,
	) {}

	// Переносим функции внутрь класса как приватные методы
	private translateCattleType(type: string): string {
		const translations = {
			COWS: 'Коровы',
			BULLS: 'Быки',
			HEIFERS: 'Телки',
			BREEDING_HEIFERS: 'Нетели',
			CALVES: 'Телята',
			BULL_CALVES: 'Бычки',
		}
		return translations[type] || type
	}

	private translatePurpose(purpose: string): string {
		const translations = {
			MEAT: 'на мясо',
			BREEDING: 'на разведение',
			DAIRY: 'на молочное производство',
			FATTENING: 'на откорм',
		}
		return translations[purpose] || purpose
	}

	async handleRequest(ctx) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Вы должны войти в систему для создания запроса')
			return
		}

		if (user.role !== 'BUYER') {
			await ctx.reply('❌ Только покупатели могут создавать запросы')
			return
		}

		await ctx.reply('🎯 Выберите цель покупки КРС:', {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[
					Markup.button.callback('🥩 Мясо', 'purpose_MEAT'),
					Markup.button.callback('🐄 Разведение', 'purpose_BREEDING'),
				],
				[
					Markup.button.callback('🥛 Молочное производство', 'purpose_DAIRY'),
					Markup.button.callback('⚖️ Откорм', 'purpose_FATTENING'),
				],
				[Markup.button.callback('« Отмена', 'menu')],
			]),
		})
	}

	async handlePurposeCallback(ctx) {
		const userId = ctx.from.id
		const purpose = ctx.callbackQuery.data.split('_')[1] as Purpose

		this.requestStates.set(userId, { purpose })
		await ctx.reply('Введите породу КРС:')
	}

	async handleRequestState(
		ctx,
		userId: number,
		text: string,
	): Promise<boolean> {
		const requestState = this.requestStates.get(userId)
		if (!requestState) return false

		if (!requestState.title) {
			requestState.title = text
			this.requestStates.set(userId, requestState)
			await ctx.reply('Введите количество голов:')
			return true
		}

		if (!requestState.quantity) {
			const quantity = parseInt(text)
			if (isNaN(quantity) || quantity <= 0) {
				await ctx.reply('❌ Введите корректное количество')
				return true
			}
			requestState.quantity = quantity
			this.requestStates.set(userId, requestState)
			await ctx.reply('Введите желаемый вес КРС в кг:')
			return true
		}

		if (!requestState.weight) {
			const weight = parseFloat(text)
			if (isNaN(weight) || weight <= 0) {
				await ctx.reply('❌ Введите корректный вес')
				return true
			}
			requestState.weight = weight
			this.requestStates.set(userId, requestState)
			await ctx.reply('Введите возраст КРС в месяцах:')
			return true
		}

		if (!requestState.age) {
			const age = parseInt(text)
			if (isNaN(age) || age <= 0) {
				await ctx.reply('❌ Введите корректный возраст')
				return true
			}
			requestState.age = age
			this.requestStates.set(userId, requestState)
			await ctx.reply('Выберите цель покупки:', {
				reply_markup: Markup.inlineKeyboard([
					[
						Markup.button.callback('Мясо', 'purpose_MEAT'),
						Markup.button.callback('Разведение', 'purpose_BREEDING'),
					],
					[
						Markup.button.callback('Молочное производство', 'purpose_DAIRY'),
						Markup.button.callback('Откорм', 'purpose_FATTENING'),
					],
				]),
			})
			return true
		}

		if (!requestState.deadline) {
			try {
				const date = new Date(text)
				const today = new Date()
				today.setHours(0, 0, 0, 0)

				if (isNaN(date.getTime())) throw new Error('Invalid date')
				if (date < today) throw new Error('Past date')

				// Максимальный срок - 6 месяцев
				const maxDate = new Date()
				maxDate.setMonth(maxDate.getMonth() + 6)
				if (date > maxDate) throw new Error('Too far')

				requestState.deadline = date.toISOString()
				this.requestStates.set(userId, requestState)
				await ctx.reply('Введите максимальную цену за голову (в рублях):')
				return true
			} catch (error) {
				let errorMessage = '❌ Введите корректную дату в формате ГГГГ-ММ-ДД\n\n'

				if (error.message === 'Past date') {
					errorMessage = '❌ Дата не может быть в прошлом\n\n'
				} else if (error.message === 'Too far') {
					errorMessage = '❌ Максимальный срок - 6 месяцев\n\n'
				}

				await ctx.reply(
					`${errorMessage}` +
						'📅 До какой даты актуален ваш запрос?\n\n' +
						'✏️ Укажите дату в формате: ГГГГ-ММ-ДД\n' +
						'✅ Например: 2024-03-25\n\n' +
						'❗️ Это дата, до которой вы планируете купить КРС.\n' +
						'❗️ Запрос будет автоматически деактивирован после этой даты.',
					{
						reply_markup: Markup.inlineKeyboard([
							[Markup.button.callback('« Назад', 'create_request')],
						]),
					},
				)
				return true
			}
		}

		if (!requestState.maxPrice) {
			const price = parseFloat(text)
			if (isNaN(price) || price <= 0) {
				await ctx.reply('❌ Введите корректную максимальную цену')
				return true
			}
			requestState.maxPrice = price
			this.requestStates.set(userId, requestState)
			await ctx.reply('Введите место доставки:')
			return true
		}

		if (!requestState.location) {
			requestState.location = text
			this.requestStates.set(userId, requestState)

			// Добавляем запрос цены
			await ctx.reply('Введите желаемую цену за голову (в рублях):')
			return true
		}

		if (!requestState.price) {
			const price = parseFloat(text)
			if (isNaN(price) || price <= 0) {
				await ctx.reply('❌ Введите корректную цену')
				return true
			}
			requestState.price = price
			this.requestStates.set(userId, requestState)

			// Создаем запрос
			await this.createRequest(ctx)
			return true
		}

		return false
	}

	async findMatches(request) {
		// Находим подходящие предложения
		const offers = await this.prisma.offer.findMany({
			where: {
				status: 'APPROVED' as const,
				quantity: {
					gte: request.quantity,
				},
				// Можно добавить дополнительные условия для поиска
			},
			include: {
				user: true,
				images: true,
			},
		})

		// Создаем совпадения для каждого найденного предложения
		const matchPromises = offers.map(offer =>
			this.prisma.match.create({
				data: {
					request: { connect: { id: request.id } },
					offer: { connect: { id: offer.id } },
					status: 'PENDING',
				},
			}),
		)

		const matches = await Promise.all(matchPromises)
		return matches
	}

	private getPurposeText(purpose: Purpose): string {
		const texts = {
			MEAT: 'Мясо',
			BREEDING: 'Разведение',
			DAIRY: 'Молочное производство',
			FATTENING: 'Откорм',
		}
		return texts[purpose]
	}

	async handleMyRequests(ctx) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		// Определяем заголовок в зависимости от роли пользователя
		const title = user.role === 'BUYER' ? 'Мои запросы' : 'Запросы покупателей'

		const requests = await this.prisma.request.findMany({
			where:
				user.role === 'SUPPLIER' ? { userId: user.id } : { status: 'ACTIVE' },
			include: {
				matches: true,
				user: true,
			},
			orderBy: { createdAt: 'desc' },
		})

		if (!requests.length) {
			const emptyMessage =
				user.role === 'BUYER'
					? '📭 У вас пока нет запросов на покупку КРС'
					: '📭 Активных запросов от покупателей пока нет'

			await ctx.reply(emptyMessage, {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'menu')]]),
			})
			return
		}

		// Отправляем каждый запрос отдельным сообщением
		for (const request of requests) {
			const message = `
📋 <b>${request.title}</b>

${user.role === 'SUPPLIER' ? `👤 Покупатель: ${request.user.name}\n` : ''}
🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🗓️ Возраст: ${request.age} мес.
📍 Локация: ${request.location}
💰 Цена: ${request.price} ₽/гол
📬 Найдено предложений: ${request.matches.length}
`

			const buttons = []

			if (user.role === 'BUYER') {
				buttons.push([
					Markup.button.callback(
						'👁️ Посмотреть детали',
						`view_request_${request.id}`,
					),
				])
			} else {
				buttons.push([
					Markup.button.callback(
						'📞 Связаться с покупателем',
						`contact_buyer_${request.userId}`,
					),
				])
			}

			buttons.push([Markup.button.callback('« Меню', 'menu')])

			await ctx.reply(message, {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			})
		}
	}

	async handleViewRequest(ctx) {
		const requestId = parseInt(ctx.callbackQuery.data.split('_')[2])
		const request = await this.prisma.request.findUnique({
			where: { id: requestId },
			include: {
				matches: {
					include: {
						offer: {
							include: {
								user: true,
							},
						},
					},
				},
			},
		})

		const requestDetails = `
📋 <b>Запрос #${request.id}</b>

🐄 ${request.title}
🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🗓️ Возраст: ${request.age} мес.
📍 Локация: ${request.location}
💰 Цена: ${request.price} ₽/гол

📬 <b>Найденные предложения (${request.matches.length}):</b>`

		const buttons = []

		if (request.matches.length > 0) {
			request.matches.forEach((match, index) => {
				const offer = match.offer
				buttons.push([
					Markup.button.callback(
						`${index + 1}. ${offer.title} - ${offer.price}₽ (${
							offer.user.name
						})`,
						`view_offer_${offer.id}`,
					),
				])
			})
		}

		buttons.push([Markup.button.callback('« Назад к запросам', 'my_requests')])
		buttons.push([Markup.button.callback('« Меню', 'menu')])

		await ctx.reply(requestDetails, {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard(buttons),
		})
	}

	async handleViewOffer(ctx) {
		const offerId = ctx.callbackQuery.data.split('_')[2]
		const offer = await this.prisma.offer.findUnique({
			where: { id: offerId },
			include: {
				user: true,
				images: true,
			},
		})

		if (!offer) {
			await ctx.reply('❌ Объявление не найдено.')
			return
		}

		const offerDetails = `
📦 <b>Предложение от ${offer.user.name}</b>

🐄 ${offer.title}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🗓️ Возраст: ${offer.age} мес.
💰 Цена: ${offer.price} ₽/гол
📍 Локация: ${offer.location}

👤 <b>Информация о продавце:</b>
📝 Название: ${offer.user.name}
📱 Телефон: ${offer.user.phone || 'Не указан'}
📍 Адрес: ${offer.user.address || 'Не указан'}`

		const buttons = [
			[
				Markup.button.callback(
					'💬 Написать сообщение',
					`chat_${offer.user.id}`,
				),
			],
			[
				Markup.button.callback(
					'📱 Показать контакты',
					`contacts_${offer.user.id}`,
				),
			],
			[
				Markup.button.callback(
					'« Назад к предложениям',
					`view_request_${ctx.match[1]}`,
				),
			],
			[Markup.button.callback('« Меню', 'menu')],
		]

		// Отправляем фото, если есть
		if (offer.images.length > 0) {
			for (const image of offer.images) {
				await ctx.replyWithPhoto(image.url)
			}
		}

		await ctx.reply(offerDetails, {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard(buttons),
		})
	}

	private formatDate(date: Date): string {
		return new Intl.DateTimeFormat('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
		}).format(date)
	}

	async handleIncomingRequests(ctx) {
		const userId = ctx.from.id
		const userWithOffers = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
			include: {
				offers: {
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
				},
			},
		})

		const activeMatches = userWithOffers.offers.flatMap(offer =>
			offer.matches.filter(match => match.status === 'PENDING'),
		)

		if (!activeMatches.length) {
			await ctx.reply('📭 У вас пока нет входящих заявок на ваши объявления', {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'menu')]]),
			})
			return
		}

		const buttons = activeMatches.map((match, index) => [
			Markup.button.callback(
				`${index + 1}. ${match.request.title} от ${match.request.user.name}`,
				`view_incoming_request_${match.request.id}`,
			),
		])

		buttons.push([Markup.button.callback('« Меню', 'menu')])

		await ctx.reply(
			'📬 <b>Входящие заявки:</b>\n\nВыберите заявку для просмотра деталей:',
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			},
		)
	}

	async handleRequestInput(ctx: Context, text: string) {
		const userId = ctx.from.id

		// Получаем текущее состояние и логируем
		const state = this.getRequestState(userId)
		console.log(`Обработка ввода для пользователя ${userId}, состояние:`, state)

		if (!state) {
			console.log(`Состояние не найдено для пользователя ${userId}`)
			return false
		}

		try {
			switch (state.inputType) {
				case 'breed':
					state.breed = text
					state.inputType = 'quantity'
					this.requestStates.set(userId, state)
					await ctx.reply('🔢 Введите необходимое количество голов:')
					return true

				case 'quantity':
					const quantity = parseInt(text)
					if (isNaN(quantity) || quantity <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return true
					}
					state.quantity = quantity
					state.inputType = 'weight'
					this.requestStates.set(userId, state)
					await ctx.reply('⚖️ Введите желаемый вес (в кг):')
					return true

				case 'weight':
					const weight = parseInt(text)
					if (isNaN(weight) || weight <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return true
					}
					state.weight = weight
					state.inputType = 'age'
					this.requestStates.set(userId, state)
					await ctx.reply('🗓️ Введите возраст КРС (в месяцах):')
					return true

				case 'age':
					const age = parseInt(text)
					if (isNaN(age) || age <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return true
					}
					state.age = age
					state.inputType = 'delivery_date'
					this.requestStates.set(userId, state)
					await ctx.reply(
						'📅 Введите желаемые сроки поставки (например, "до 15.06.2023"):',
					)
					return true

				case 'delivery_date':
					state.deliveryDate = text
					state.inputType = 'price'
					this.requestStates.set(userId, state)
					await ctx.reply('💰 Введите желаемую цену (в рублях):')
					return true

				case 'price':
					const price = parseInt(text)
					if (isNaN(price) || price <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return true
					}
					state.price = price
					state.inputType = 'region'
					this.requestStates.set(userId, state)
					await ctx.reply('🌍 Введите регион покупки:')
					return true

				case 'region':
					state.region = text
					state.inputType = 'location'
					this.requestStates.set(userId, state)
					await ctx.reply('📍 Введите место доставки:')
					return true

				case 'location':
					state.location = text
					// Завершаем создание запроса
					await this.createRequest(ctx)
					return true

				default:
					return false
			}
		} catch (error) {
			console.error('Ошибка при обработке ввода запроса:', error)
			await ctx.reply('❌ Произошла ошибка при обработке вашего ввода')
			return true
		}
	}

	// Добавляем метод для инициализации состояния запроса
	initRequestState(userId: number, state: RequestState) {
		this.requestStates.set(userId, state)
	}

	// Метод для начала создания запроса
	async startRequestCreation(ctx: Context) {
		try {
			const userId = ctx.from.id

			// Создаем новое состояние запроса без photos и videos
			const requestState: RequestState = {
				inputType: 'cattle_type',
			}

			// Сохраняем состояние
			this.requestStates.set(userId, requestState)

			// Логируем для отладки
			console.log(
				`Создано новое состояние запроса для пользователя ${userId}:`,
				requestState,
			)

			// Отправляем сообщение с выбором типа скота
			await ctx.reply('🐄 Выберите тип КРС:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '🐄 Коровы', callback_data: 'request_cattle_COWS' },
							{ text: '🐂 Быки', callback_data: 'request_cattle_BULLS' },
						],
						[
							{ text: '🐮 Телки', callback_data: 'request_cattle_HEIFERS' },
							{
								text: '🐄 Нетели',
								callback_data: 'request_cattle_BREEDING_HEIFERS',
							},
						],
						[
							{ text: '🐮 Телята', callback_data: 'request_cattle_CALVES' },
							{ text: '🐂 Бычки', callback_data: 'request_cattle_BULL_CALVES' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при начале создания запроса:', error)
			await ctx.reply('❌ Произошла ошибка при создании запроса')
		}
	}

	async createRequest(ctx: Context) {
		try {
			const userId = ctx.from.id
			const state = this.requestStates.get(userId)

			if (!state) {
				await ctx.reply('❌ Данные запроса не найдены')
				return
			}

			// Проверяем наличие обязательных полей
			if (!state.region || !state.location) {
				await ctx.reply('❌ Необходимо указать регион и местоположение')

				if (!state.region) {
					state.inputType = 'region'
					this.requestStates.set(userId, state)
					await ctx.reply('🌍 Введите регион покупки:')
				} else if (!state.location) {
					state.inputType = 'location'
					this.requestStates.set(userId, state)
					await ctx.reply('📍 Введите место доставки:')
				}
				return
			}

			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			console.log('Создание запроса с данными:', state)

			// Переводим тип КРС и цель на русский язык
			const russianTitle = `${this.translateCattleType(state.cattleType)} ${this.translatePurpose(state.purpose)}`

			// Преобразуем строку даты в формат ISO
			let deadlineDate = null
			if (state.deliveryDate) {
				try {
					// Пытаемся преобразовать строку в формат даты
					const parts = state.deliveryDate.split('.')
					if (parts.length === 3) {
						deadlineDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
					}
				} catch (e) {
					console.error('Ошибка при преобразовании даты:', e)
				}
			}

			// Создаем запрос в базе данных
			const request = await this.prisma.request.create({
				data: {
					title: russianTitle,
					quantity: state.quantity,
					weight: state.weight,
					age: state.age,
					price: state.price,
					location: state.location,
					region: state.region,
					breed: state.breed || 'Не указано',
					status: 'ACTIVE',
					deadline: deadlineDate, // Используем преобразованную дату
					user: { connect: { id: user.id } },
				},
			})

			// Очищаем состояние после создания запроса
			this.requestStates.delete(userId)

			// Находим подходящие предложения
			const matches = await this.findMatches(request)

			// Отправляем сообщение об успешном создании запроса
			await ctx.reply(
				`✅ Запрос успешно создан!\n\n` +
					`🐄 ${russianTitle}\n` +
					`🔢 Количество: ${request.quantity} голов\n` +
					`⚖️ Вес: ${request.weight} кг\n` +
					`🗓️ Возраст: ${request.age} мес.\n` +
					`📍 Локация: ${request.location}\n` +
					`🌍 Регион: ${request.region}\n` +
					`🐮 Порода: ${request.breed}\n` +
					`💰 Цена: ${request.price} ₽/гол\n\n` +
					`${
						matches.length > 0
							? `Найдено ${matches.length} подходящих предложений! Используйте /matches для просмотра.`
							: 'Пока нет подходящих предложений. Мы уведомим вас при появлении.'
					}`,
				{
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[{ text: '📋 Мои запросы', callback_data: 'my_requests' }],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при создании запроса:', error)
			await ctx.reply('❌ Произошла ошибка при создании запроса')
		}
	}

	getRequestState(userId: number): RequestState | undefined {
		return this.requestStates.get(userId)
	}

	// Добавляем метод для обновления состояния запроса
	updateRequestState(userId: number, state: RequestState): void {
		this.requestStates.set(userId, state)
	}

	// Добавляем метод для отображения деталей запроса
	async showRequestDetails(ctx: Context, requestId: number) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем запрос с совпадениями
			const request = await this.prisma.request.findUnique({
				where: { id: requestId },
				include: {
					user: true,
					matches: {
						include: {
							offer: {
								include: {
									user: true,
									images: true,
								},
							},
						},
					},
				},
			})

			if (!request) {
				await ctx.reply('❌ Запрос не найден')
				return
			}

			// Формируем сообщение с деталями запроса
			let message = `📋 <b>Детали запроса #${request.id}</b>\n\n`
			message += `🐮 <b>Название:</b> ${request.title}\n`
			message += `🔢 <b>Количество:</b> ${request.quantity} голов\n`
			message += `⚖️ <b>Вес:</b> ${request.weight} кг\n`
			message += `🗓️ <b>Возраст:</b> ${request.age} мес.\n`
			message += `📍 <b>Локация:</b> ${request.location}\n`
			message += `💰 <b>Цена:</b> ${request.price} ₽/гол\n`
			message += `🔄 <b>Статус:</b> ${this.getStatusText(request.status)}\n`
			message += `📅 <b>Создан:</b> ${request.createdAt.toLocaleDateString()}\n\n`

			// Создаем разные кнопки в зависимости от роли пользователя
			const buttons = []

			if (user.role === 'SUPPLIER') {
				// Для поставщика показываем кнопку "Предложить КРС"
				buttons.push([
					{
						text: '📝 Предложить КРС',
						callback_data: `offer_cattle_${request.id}`,
					},
				])
				buttons.push([
					{ text: '« Назад к списку', callback_data: 'all_requests' },
				])
			} else if (user.role === 'BUYER' && request.userId === user.id) {
				// Для покупателя (владельца запроса) показываем информацию о совпадениях
				if (request.matches.length > 0) {
					message += `🔍 <b>Найдено ${request.matches.length} предложений:</b>\n\n`
					const matchButtons = request.matches.map((match, index) => [
						{
							text: `${index + 1}. ${match.offer.title} (${match.offer.user.name})`,
							callback_data: `view_match_${match.id}`,
						},
					])
					buttons.push(...matchButtons)
				}
				buttons.push([
					{
						text: '❌ Закрыть запрос',
						callback_data: `close_request_${request.id}`,
					},
				])
				buttons.push([{ text: '« Мои запросы', callback_data: 'my_requests' }])
			}

			// Добавляем кнопку меню для всех
			buttons.push([{ text: '« Меню', callback_data: 'menu' }])

			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: buttons,
				},
			})
		} catch (error) {
			console.error('Ошибка при отображении деталей запроса:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке деталей запроса')
		}
	}

	// Добавляем вспомогательный метод для получения текстового представления статуса
	private getStatusText(status: string): string {
		const statusTexts = {
			ACTIVE: '✅ Активен',
			INACTIVE: '⏸️ Приостановлен',
			COMPLETED: '✓ Завершен',
			CANCELLED: '❌ Отменен',
		}
		return statusTexts[status] || status
	}

	// Добавляем метод для отображения деталей совпадения
	async showMatchDetails(ctx: Context, matchId: number) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем совпадение с запросом и предложением
			const match = await this.prisma.match.findUnique({
				where: { id: matchId },
				include: {
					request: true,
					offer: {
						include: {
							user: true,
							images: true,
						},
					},
				},
			})

			if (!match) {
				await ctx.reply('❌ Совпадение не найдено')
				return
			}

			// Проверяем, принадлежит ли запрос текущему пользователю
			if (match.request.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этому совпадению')
				return
			}

			const offer = match.offer
			const supplier = offer.user

			// Формируем сообщение с деталями предложения
			let message = `🔍 <b>Подходящее предложение</b>\n\n`
			message += `🐄 <b>Название:</b> ${offer.title}\n`
			message += `🔢 <b>Количество:</b> ${offer.quantity} голов\n`
			message += `⚖️ <b>Вес:</b> ${offer.weight} кг\n`
			message += `🗓️ <b>Возраст:</b> ${offer.age} мес.\n`
			message += `📍 <b>Локация:</b> ${offer.location}\n`
			message += `💰 <b>Цена:</b> ${offer.price} ₽/${offer.priceType === 'PER_HEAD' ? 'гол' : 'кг'}\n\n`

			message += `👤 <b>Поставщик:</b> ${supplier.name}\n`
			message += `📅 <b>Дата публикации:</b> ${offer.createdAt.toLocaleDateString()}\n\n`

			// Создаем кнопки для действий с предложением
			const buttons = [
				[
					Markup.button.callback(
						'📞 Запросить контакты',
						`request_contacts_${supplier.id}`,
					),
					Markup.button.callback(
						'💬 Написать сообщение',
						`send_message_${supplier.id}`,
					),
				],
				[
					Markup.button.callback(
						'« Назад к запросу',
						`view_request_${match.request.id}`,
					),
					Markup.button.callback('« Меню', 'menu'),
				],
			]

			// Если есть изображения, отправляем их
			if (offer.images && offer.images.length > 0) {
				// Отправляем первое изображение с текстом и кнопками
				const firstImage = offer.images[0]
				await ctx.replyWithPhoto(
					{ url: firstImage.url },
					{
						caption: message,
						parse_mode: 'HTML',
						reply_markup: { inline_keyboard: buttons },
					},
				)

				// Отправляем остальные изображения, если они есть
				for (let i = 1; i < offer.images.length; i++) {
					await ctx.replyWithPhoto({ url: offer.images[i].url })
				}
			} else {
				// Если изображений нет, отправляем только текст с кнопками
				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: { inline_keyboard: buttons },
				})
			}
		} catch (error) {
			console.error('Ошибка при отображении деталей совпадения:', error)
			await ctx.reply('❌ Произошла ошибка при отображении совпадения')
		}
	}

	// Добавляем метод для закрытия запроса
	async closeRequest(ctx: Context, requestId: number) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем запрос
			const request = await this.prisma.request.findUnique({
				where: { id: requestId },
			})

			if (!request) {
				await ctx.reply('❌ Запрос не найден')
				return
			}

			// Проверяем, принадлежит ли запрос текущему пользователю
			if (request.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этому запросу')
				return
			}

			// Обновляем статус запроса на "COMPLETED"
			await this.prisma.request.update({
				where: { id: requestId },
				data: { status: 'COMPLETED' },
			})

			await ctx.reply('✅ Запрос успешно закрыт', {
				reply_markup: {
					inline_keyboard: [
						[
							Markup.button.callback('📋 Мои запросы', 'my_requests'),
							Markup.button.callback('« Меню', 'menu'),
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при закрытии запроса:', error)
			await ctx.reply('❌ Произошла ошибка при закрытии запроса')
		}
	}

	async handleViewRequestDetails(ctx) {
		try {
			const requestId = ctx.callbackQuery.data.split('_')[2]
			const request = await this.prisma.request.findUnique({
				where: { id: parseInt(requestId) },
				include: {
					matches: {
						include: {
							offer: {
								include: {
									user: true,
									images: true,
								},
							},
						},
					},
				},
			})

			if (!request) {
				await ctx.reply('❌ Запрос не найден')
				return
			}

			const message = `
📋 <b>${request.title}</b>

🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🗓️ Возраст: ${request.age} мес.
📍 Локация: ${request.location}
💰 Цена: ${request.price} ₽/гол
🕒 Создан: ${request.createdAt.toLocaleDateString('ru-RU')}

📬 Найденные предложения: ${request.matches.length}
`

			const buttons = []

			// Добавляем кнопки для просмотра совпадений
			if (request.matches.length > 0) {
				buttons.push([
					Markup.button.callback(
						'🔍 Посмотреть предложения',
						`view_matches_${request.id}`,
					),
				])
			}

			// Добавляем кнопки управления
			buttons.push([
				Markup.button.callback('🔄 Обновить', `refresh_request_${request.id}`),
				Markup.button.callback('❌ Закрыть', `close_request_${request.id}`),
			])

			// Добавляем навигационные кнопки
			buttons.push([
				Markup.button.callback('« Назад к запросам', 'my_requests'),
				Markup.button.callback('« Меню', 'menu'),
			])

			await ctx.reply(message, {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			})
		} catch (error) {
			console.error('Ошибка при отображении деталей запроса:', error)
			await ctx.reply('❌ Произошла ошибка при отображении запроса')
		}
	}

	// Добавим новый метод для отображения всех активных запросов покупателей
	async handleBuyerRequests(ctx) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			if (user.role !== 'SUPPLIER') {
				await ctx.reply('❌ Этот раздел доступен только для продавцов')
				return
			}

			// Получаем все активные запросы
			const requests = await this.prisma.request.findMany({
				where: {
					status: 'ACTIVE',
				},
				include: {
					user: true,
					matches: true,
				},
				orderBy: { createdAt: 'desc' },
			})

			if (!requests.length) {
				await ctx.reply('📭 Активных запросов от покупателей пока нет', {
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('« Меню', 'menu')],
					]),
				})
				return
			}

			// Отправляем каждый запрос отдельным сообщением
			for (const request of requests) {
				const message = `
📋 <b>${request.title}</b>

👤 Покупатель: ${request.user.name}
🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🗓️ Возраст: ${request.age} мес.
📍 Локация: ${request.location}
💰 Цена: ${request.price} ₽/гол
🕒 Создан: ${request.createdAt.toLocaleDateString('ru-RU')}
`

				const buttons = [
					[
						Markup.button.callback(
							'📤 Предложить',
							`offer_to_request_${request.id}`,
						),
					],
					[
						Markup.button.callback(
							'📞 Связаться с покупателем',
							`contact_buyer_${request.userId}`,
						),
					],

					[Markup.button.callback('« Меню', 'menu')],
				]

				await ctx.reply(message, {
					parse_mode: 'HTML',
					...Markup.inlineKeyboard(buttons),
				})
			}
		} catch (error) {
			console.error('Ошибка при отображении запросов покупателей:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке запросов')
		}
	}

	// Метод для обработки выбора объявления и создания match
	@Action(/^send_offer_.*/)
	async handleSendOffer(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const [, requestId, offerId] = callbackQuery.data.split('_')

			// Создаем связь между запросом и предложением
			const match = await this.prisma.match.create({
				data: {
					request: { connect: { id: parseInt(requestId) } },
					offer: { connect: { id: offerId } },
					status: 'PENDING',
				},
				include: {
					request: {
						include: { user: true },
					},
					offer: {
						include: { user: true },
					},
				},
			})

			// Отправляем уведомление покупателю
			if (match.request.user.telegramId) {
				const buyerMessage = `
🔔 <b>Новое предложение по вашему запросу!</b>

📋 Ваш запрос: ${match.request.title}
👤 Поставщик: ${match.offer.user.name}
🐮 Предложение: ${match.offer.title}
💰 Цена: ${match.offer.price}₽/${
					match.offer.priceType === 'PER_HEAD' ? 'голову' : 'кг'
				}
`

				await ctx.telegram.sendMessage(
					match.request.user.telegramId,
					buyerMessage,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '👁️ Посмотреть предложение',
										callback_data: `view_match_${match.id}`,
									},
								],
							],
						},
					},
				)
			}

			// Отправляем подтверждение поставщику
			await ctx.reply('✅ Предложение успешно отправлено покупателю', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '« Назад к запросу',
								callback_data: `view_request_${requestId}`,
							},
						],
						[{ text: '« Меню', callback_data: 'menu' }],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при отправке предложения:', error)
			await ctx.reply('❌ Произошла ошибка при отправке предложения')
		}
	}

	// Метод для обработки выбора объявления для отправки
	@Action(/^offer_cattle_.*/)
	async handleOfferCattle(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const requestId = callbackQuery.data.replace('offer_cattle_', '')

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
				include: {
					offers: {
						where: { status: 'APPROVED' },
						include: {
							images: true,
						},
					},
				},
			})

			if (!user || user.role !== 'SUPPLIER') {
				await ctx.reply('❌ Доступно только для поставщиков')
				return
			}

			// ... остальной код метода ...
		} catch (error) {
			console.error('Ошибка при предложении КРС:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	// Добавляем метод для отображения всех запросов
	async showAllRequests(ctx: Context) {
		try {
			// Получаем все активные запросы
			const requests = await this.prisma.request.findMany({
				where: { status: 'ACTIVE' },
				include: {
					user: true,
					matches: true,
				},
				orderBy: {
					createdAt: 'desc',
				},
			})

			if (requests.length === 0) {
				await ctx.reply('📭 Активных запросов пока нет')
				return
			}

			// Формируем сообщение со списком запросов
			let message = '📋 <b>Активные запросы покупателей:</b>\n\n'

			// Создаем сообщение для каждого запроса
			for (const request of requests) {
				message += ` <b>${request.title}</b>\n`
				message += `👤 Покупатель: ${request.user.name}\n`
				message += `🔢 Количество: ${request.quantity} голов\n`
				message += `⚖️ Вес: ${request.weight} кг\n`
				message += `🗓️ Возраст: ${request.age} мес.\n`
				message += `📍 Локация: ${request.location}\n`
				message += `💰 Цена: ${request.price} ₽/гол\n`
				message += `📬 Предложений: ${request.matches.length}\n\n`
			}

			// Создаем кнопки для каждого запроса
			const buttons = requests.map(request => [
				{
					text: `${request.title} - ${request.quantity} голов`,
					callback_data: `view_request_${request.id}`,
				},
			])

			// Добавляем кнопку возврата в меню
			buttons.push([{ text: '« Меню', callback_data: 'menu' }])

			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: buttons,
				},
			})
		} catch (error) {
			console.error('Ошибка при отображении запросов:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке запросов')
		}
	}

	@Action(/^view_matches_.*/)
	async handleViewMatches(@Ctx() ctx: Context) {
		try {
			const callbackQuery = ctx.callbackQuery as any
			const offerId = callbackQuery.data.replace('view_matches_', '')

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

			// Формируем сообщение со списком заявок
			const message =
				`📋 <b>Заявки на покупку (${offer.matches.length}):</b>\n\n` +
				`❗️ Контакты покупателей будут доступны после проверки администратором`

			// Создаем кнопки для каждой заявки
			const buttons = offer.matches.map(match => [
				{
					text: `${match.request.user.name} - ${match.request.quantity} голов`,
					callback_data: `view_match_details_${match.id}`,
				},
			])

			buttons.push([
				{
					text: '« Назад к объявлению',
					callback_data: `view_my_offer_${offerId}`,
				},
			])
			buttons.push([{ text: '« Меню', callback_data: 'menu' }])

			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: { inline_keyboard: buttons },
			})
		} catch (error) {
			console.error('Ошибка при просмотре заявок:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке заявок')
		}
	}

	// Метод для обработки выбора типа скота
	async handleCattleTypeSelection(ctx: Context, cattleType: CattleType) {
		const userId = ctx.from.id

		// Получаем текущее состояние и логируем для отладки
		const state = this.getRequestState(userId)
		console.log(`Получено состояние для пользователя ${userId}:`, state)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните создание запроса заново')
			return
		}

		// Сохраняем выбранный тип скота
		state.cattleType = cattleType
		state.inputType = 'breed' // Переходим к вводу породы

		// Сохраняем обновленное состояние и логируем
		this.requestStates.set(userId, state)
		console.log(
			`Обновлено состояние для пользователя ${userId}:`,
			this.requestStates.get(userId),
		)

		// Отображаем сообщение с запросом породы
		await ctx.reply('🐄 Введите породу скота:')
	}

	// Обработка выбора цели
	async handlePurposeSelection(ctx: Context, purpose: string) {
		console.log('Вызван handlePurposeSelection с целью:', purpose)
		const userId = ctx.from.id
		const state = this.requestStates.get(userId)

		console.log('Текущее состояние:', state)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните создание запроса заново')
			return
		}

		state.purpose = purpose as Purpose
		state.inputType = 'region' // Сначала запрашиваем регион вместо породы
		this.requestStates.set(userId, state)
		console.log('Обновленное состояние:', this.requestStates.get(userId))

		// Сначала запрашиваем регион
		await ctx.reply('🌍 Введите регион покупки:')
	}

	// Завершение создания запроса
	async completeRequest(ctx: Context) {
		const userId = ctx.from.id
		const state = this.requestStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните создание запроса заново')
			return
		}

		try {
			// Получаем пользователя для связи
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Создаем запрос в базе данных с дополнительными полями
			const request = await this.prisma.request.create({
				data: {
					title: `${state.cattleType} для ${state.purpose}`,
					description: state.description || '',
					quantity: state.quantity,
					weight: state.weight,
					price: state.price,
					location: state.location,
					region: state.region,
					breed: state.breed,
					age: state.age,
					deadline: state.deadline,
					isExport: state.isExport,
					isBreeding: state.isBreeding,
					user: { connect: { id: user.id } },
					status: 'ACTIVE',
				},
			})

			// Очищаем состояние
			this.requestStates.delete(userId)

			// Ищем релевантные предложения с учетом региона
			const relevantOffers = await this.findRelevantOffers(request)

			// Отправляем сообщение об успешном создании запроса с дополнительными полями
			await ctx.reply(
				'✅ Ваш запрос успешно создан!\n\n' +
					`Тип КРС: ${state.cattleType}\n` +
					`Порода: ${state.breed}\n` +
					`Цель: ${state.purpose}\n` +
					`Регион: ${state.region}\n` +
					`Количество: ${state.quantity} голов\n` +
					`Вес: ${state.weight} кг\n` +
					`Возраст: ${state.age} мес.\n` +
					`Сроки: ${state.deadline}\n` +
					`Цена: ${state.price} руб.\n` +
					`Местоположение фермы: ${state.location}\n` +
					`Экспорт: ${state.isExport ? 'Да' : 'Нет'}\n` +
					`Племенное разведение: ${state.isBreeding ? 'Да' : 'Нет'}\n` +
					(state.description ? `Описание: ${state.description}\n\n` : '\n') +
					'Ваш запрос отправлен на поиск подходящих предложений.',
			)

			// Показываем релевантные предложения, если они есть
			if (relevantOffers.length > 0) {
				await ctx.reply('🔍 Найдены подходящие предложения:')

				for (const offer of relevantOffers) {
					const priceInfo =
						offer.priceType === 'PER_HEAD'
							? `${offer.price} руб. за голову`
							: `${offer.price} руб. за кг`

					await ctx.reply(
						`🐄 ${offer.title}\n\n` +
							`Тип КРС: ${offer.cattleType}\n` +
							`Количество: ${offer.quantity} голов\n` +
							`Вес: ${offer.weight} кг\n` +
							`Цена: ${priceInfo}\n` +
							`Местоположение: ${offer.location}\n\n` +
							`${offer.description || ''}`,
						{
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '📞 Связаться с продавцом',
											callback_data: `contact_seller_${offer.id}`,
										},
									],
								],
							},
						},
					)
				}
			} else {
				await ctx.reply(
					'❗ К сожалению, подходящих предложений пока нет.\n\n' +
						'Ожидайте и мониторьте все объявления. Мы уведомим вас, когда появятся подходящие предложения.',
				)
			}

			// Предлагаем вернуться в меню
			await ctx.reply('Выберите дальнейшее действие:', {
				reply_markup: {
					inline_keyboard: [
						[{ text: '📋 Мои запросы', callback_data: 'my_requests' }],
						[{ text: '📱 Меню', callback_data: 'menu' }],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при создании запроса:', error)
			await ctx.reply(
				'❌ Произошла ошибка при создании запроса. Пожалуйста, попробуйте позже.',
			)
		}
	}

	// Поиск релевантных предложений
	async findRelevantOffers(request: any) {
		// Рассчитываем диапазон цен (±30%)
		const minPrice = Math.floor(request.price * 0.7)
		const maxPrice = Math.ceil(request.price * 1.3)

		// Ищем предложения, соответствующие запросу с учетом региона
		const offers = await this.prisma.offer.findMany({
			where: {
				cattleType: request.title.split(' ')[0] as any,
				quantity: {
					gte: request.quantity * 0.7,
					lte: request.quantity * 1.3,
				},
				weight: {
					gte: request.weight * 0.7,
					lte: request.weight * 1.3,
				},
				price: {
					gte: minPrice,
					lte: maxPrice,
				},
				...(request.region
					? {
							OR: [
								{ region: request.region },
								{ region: { contains: request.region } },
								{ location: { contains: request.region } },
							],
						}
					: {}),
				status: 'APPROVED' as const,
			},
			take: 5,
		})

		return offers
	}

	// Обработка запроса на контакт с продавцом
	async handleRequestContacts(ctx: Context) {
		try {
			await ctx.answerCbQuery()

			// Извлекаем ID объявления из callback_data
			//@ts-ignore
			const callbackData = ctx.callbackQuery.data
			const offerId = callbackData.replace('request_contacts_', '')
			const userId = ctx.from.id

			// Получаем пользователя из базы данных
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь')
				return
			}

			// Получаем объявление
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: { user: true },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено или было удалено')
				return
			}

			// Проверяем наличие существующих запросов
			const existingRequest = await this.prisma.contactRequest.findFirst({
				where: {
					offerId: offerId,
					buyerId: user.id,
					status: 'PENDING',
				},
			})

			if (existingRequest) {
				await ctx.reply(
					'⚠️ Вы уже отправили запрос на контакты для этого объявления. Ожидайте подтверждения от администратора.',
				)
				return
			}

			// Сохраняем состояние для дальнейшей обработки комментария
			const requestState = {
				offerId,
				inputType: 'contact_request_comment',
				photos: [], // Добавляем обязательные поля
				videos: [], // Добавляем обязательные поля
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

	// Обработка выбора экспорта
	async handleExportSelection(ctx: Context, isExport: boolean) {
		const userId = ctx.from.id
		const state = this.requestStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните создание запроса заново')
			return
		}

		state.isExport = isExport

		// Спрашиваем о племенном разведении
		state.inputType = 'breeding'
		this.requestStates.set(userId, state)

		await ctx.reply('🧬 Планируется ли племенное разведение?', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '✅ Да', callback_data: 'request_breeding_yes' },
						{ text: '❌ Нет', callback_data: 'request_breeding_no' },
					],
				],
			},
		})
	}

	// Обработка выбора племенного разведения
	async handleBreedingSelection(ctx: Context, isBreeding: boolean) {
		const userId = ctx.from.id
		const state = this.requestStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните создание запроса заново')
			return
		}

		state.isBreeding = isBreeding

		// Переходим к описанию
		state.inputType = 'description'
		this.requestStates.set(userId, state)

		await ctx.reply(
			'📝 Введите дополнительное описание (или нажмите "Пропустить"):',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '⏩ Пропустить', callback_data: 'skip_description' }],
					],
				},
			},
		)
	}
}
