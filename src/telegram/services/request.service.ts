// Сервис для работы с запросами на покупку
import { Injectable } from '@nestjs/common'
import { Match, User } from '@prisma/client'
import { Context, Markup } from 'telegraf'
import { PrismaService } from '../../prisma.service'
import { Purpose } from '../../types/purpose.enum'

interface RequestState {
	purpose?: Purpose
	breed?: string
	quantity?: number
	weight?: number
	age?: number
	deadline?: Date
	maxPrice?: number
	location?: string
	title?: string
	price?: number
	inputType?: string
}

interface MatchWithRelations extends Match {
	request: Request & {
		user: User
	}
}

@Injectable()
export class TelegramRequestService {
	private requestStates: Map<number, RequestState> = new Map()

	constructor(private prisma: PrismaService) {}

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

				requestState.deadline = date
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
				status: 'ACTIVE',
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

		const requests = await this.prisma.request.findMany({
			where: { userId: user.id },
			include: {
				matches: true,
			},
			orderBy: { createdAt: 'desc' },
		})

		if (!requests.length) {
			await ctx.reply('📭 У вас пока нет запросов на покупку КРС', {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'menu')]]),
			})
			return
		}

		const buttons = requests.map((req, index) => [
			Markup.button.callback(
				`${index + 1}. ${req.title} (${req.matches.length} предложений)`,
				`view_request_${req.id}`,
			),
		])

		buttons.push([Markup.button.callback('« Меню', 'menu')])

		await ctx.reply(
			'📋 <b>Ваши запросы:</b>\n\nВыберите запрос для просмотра деталей:',
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			},
		)
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
		try {
			const userId = ctx.from.id
			const state = this.requestStates.get(userId)

			if (!state || !state.inputType) {
				await ctx.reply('❌ Начните создание запроса заново')
				return
			}

			console.log('Обработка ввода для запроса:', state.inputType, text)

			// Обрабатываем ввод в зависимости от текущего шага
			switch (state.inputType) {
				case 'title':
					state.title = text
					// Пропускаем шаг с description и сразу переходим к quantity
					state.inputType = 'quantity'
					await ctx.reply('🔢 Введите количество голов:')
					break
				case 'quantity':
					const quantity = parseInt(text)
					if (isNaN(quantity) || quantity <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return
					}
					state.quantity = quantity
					state.inputType = 'weight'
					await ctx.reply('⚖️ Введите вес (кг):')
					break
				case 'weight':
					const weight = parseInt(text)
					if (isNaN(weight) || weight <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return
					}
					state.weight = weight
					state.inputType = 'age'
					await ctx.reply('🗓️ Введите возраст (месяцев):')
					break
				case 'age':
					const age = parseInt(text)
					if (isNaN(age) || age <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return
					}
					state.age = age
					state.inputType = 'price'
					await ctx.reply('💰 Введите максимальную цену (₽):')
					break
				case 'price':
					const price = parseInt(text)
					if (isNaN(price) || price <= 0) {
						await ctx.reply('❌ Пожалуйста, введите корректное число')
						return
					}
					state.price = price
					state.inputType = 'location'
					await ctx.reply('📍 Введите местоположение:')
					break
				case 'location':
					state.location = text
					state.inputType = 'completed' // Помечаем, что ввод завершен
					await this.createRequest(ctx) // Создаем запрос только один раз
					return // Выходим из метода, чтобы не сохранять состояние снова
				default:
					await ctx.reply('❌ Неизвестный шаг создания запроса')
					break
			}

			// Сохраняем обновленное состояние
			this.requestStates.set(userId, state)
		} catch (error) {
			console.error('Ошибка при обработке ввода для запроса:', error)
			await ctx.reply('❌ Произошла ошибка при создании запроса')
		}
	}

	// Добавляем метод для инициализации состояния запроса
	initRequestState(userId: number, state: RequestState) {
		this.requestStates.set(userId, state)
	}

	// Добавляем метод для начала создания запроса
	async startRequestCreation(ctx: Context) {
		try {
			const userId = ctx.from.id

			// Инициализируем новое состояние запроса
			const requestState: RequestState = {
				inputType: 'title',
			}

			this.requestStates.set(userId, requestState)

			await ctx.reply(
				'📝 <b>Создание нового запроса на покупку КРС</b>\n\n' +
					'Пожалуйста, введите название запроса:',
				{ parse_mode: 'HTML' },
			)
		} catch (error) {
			console.error('Ошибка при создании запроса:', error)
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

			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			console.log('Создание запроса с данными:', state)

			// Создаем запрос в базе данных, исключая поле description, которого нет в модели
			const request = await this.prisma.request.create({
				data: {
					title: state.title,
					// Удаляем поле description, так как оно отсутствует в модели
					quantity: state.quantity,
					weight: state.weight,
					age: state.age,
					price: state.price,
					location: state.location,
					status: 'ACTIVE',
					user: { connect: { id: user.id } },
				},
			})

			// Очищаем состояние после создания запроса
			this.requestStates.delete(userId)

			// Находим подходящие предложения
			const matches = await this.findMatches(request)

			// Отправляем сообщение об успешном создании запроса, исключая поле description
			await ctx.reply(
				`✅ Запрос успешно создан!\n\n` +
					`🐄 ${request.title}\n` +
					// Удаляем строку с description
					`🔢 Количество: ${request.quantity} голов\n` +
					`⚖️ Вес: ${request.weight} кг\n` +
					`🗓️ Возраст: ${request.age} мес.\n` +
					`📍 Локация: ${request.location}\n` +
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

			if (!request) {
				await ctx.reply('❌ Запрос не найден')
				return
			}

			// Проверяем, принадлежит ли запрос текущему пользователю
			if (request.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этому запросу')
				return
			}

			// Формируем сообщение с деталями запроса
			let message = `📋 <b>Детали запроса #${request.id}</b>\n\n`
			message += `🐄 <b>Название:</b> ${request.title}\n`

			// Проверяем наличие поля description с использованием оператора in
			// Это позволит избежать ошибки типизации
			if ('description' in request && request.description) {
				message += `📝 <b>Описание:</b> ${request.description}\n`
			}

			message += `🔢 <b>Количество:</b> ${request.quantity} голов\n`
			message += `⚖️ <b>Вес:</b> ${request.weight} кг\n`
			message += `🗓️ <b>Возраст:</b> ${request.age} мес.\n`
			message += `📍 <b>Локация:</b> ${request.location}\n`
			message += `💰 <b>Цена:</b> ${request.price} ₽/гол\n`
			message += `🔄 <b>Статус:</b> ${this.getStatusText(request.status)}\n`
			message += `📅 <b>Создан:</b> ${request.createdAt.toLocaleDateString()}\n\n`

			// Добавляем информацию о совпадениях
			if (request.matches.length > 0) {
				message += `🔍 <b>Найдено ${request.matches.length} подходящих предложений:</b>\n\n`

				// Создаем кнопки для просмотра совпадений
				const matchButtons = request.matches.map((match, index) => [
					Markup.button.callback(
						`${index + 1}. ${match.offer.title} (${match.offer.user.name})`,
						`view_match_${match.id}`,
					),
				])

				// Добавляем кнопки навигации
				matchButtons.push([
					Markup.button.callback('📋 Мои запросы', 'my_requests'),
					Markup.button.callback('« Меню', 'menu'),
				])

				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: matchButtons,
					},
				})
			} else {
				message += '🔍 <b>Пока нет подходящих предложений.</b>\n'
				message += 'Мы уведомим вас, когда появятся новые предложения.'

				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								Markup.button.callback(
									'🔄 Обновить',
									`view_request_${request.id}`,
								),
								Markup.button.callback(
									'❌ Закрыть запрос',
									`close_request_${request.id}`,
								),
							],
							[
								Markup.button.callback('📋 Мои запросы', 'my_requests'),
								Markup.button.callback('« Меню', 'menu'),
							],
						],
					},
				})
			}
		} catch (error) {
			console.error('Ошибка при отображении деталей запроса:', error)
			await ctx.reply('❌ Произошла ошибка при отображении запроса')
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
}
