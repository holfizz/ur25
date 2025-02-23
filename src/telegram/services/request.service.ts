// Сервис для работы с запросами на покупку
import { Injectable } from '@nestjs/common'
import { Match, Purpose, Request, User } from '@prisma/client'
import { Markup } from 'telegraf'
import { PrismaService } from '../../prisma.service'

interface RequestState {
	purpose?: Purpose
	breed?: string
	quantity?: number
	weight?: number
	age?: number
	deadline?: Date
	maxPrice?: number
	location?: string
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

		if (!requestState.breed) {
			requestState.breed = text
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

			// Создаем запрос
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			const request = await this.prisma.request.create({
				data: {
					breed: requestState.breed,
					quantity: requestState.quantity,
					weight: requestState.weight,
					age: requestState.age,
					deadline: requestState.deadline,
					purpose: requestState.purpose,
					maxPrice: requestState.maxPrice,
					location: requestState.location,
					userId: user.id,
				},
			})

			// Ищем подходящие предложения
			const matches = await this.findMatches(request)

			this.requestStates.delete(userId)

			await ctx.reply(
				`✅ Запрос успешно создан!

🐮 Порода: ${request.breed}
🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🌱 Возраст: ${request.age} мес.
📅 Срок: ${request.deadline.toLocaleDateString()}
🎯 Цель: ${this.getPurposeText(request.purpose)}
💰 Макс. цена: ${request.maxPrice} руб/голову
📍 Доставка: ${request.location}

${
	matches.length > 0
		? `\nНайдено ${matches.length} подходящих предложений! Используйте /matches для просмотра.`
		: '\nПока нет подходящих предложений. Мы уведомим вас при появлении.'
}`,
				{ parse_mode: 'HTML' },
			)
			return true
		}

		return false
	}

	private async findMatches(request) {
		// Логика поиска подходящих предложений
		const matches = await this.prisma.offer.findMany({
			where: {
				breed: request.breed,
				quantity: { gte: request.quantity },
				weight: {
					gte: request.weight * 0.9,
					lte: request.weight * 1.1,
				},
				price: { lte: request.maxPrice },
				status: 'ACTIVE',
			},
		})

		// Создаем записи о совпадениях
		for (const offer of matches) {
			await this.prisma.match.create({
				data: {
					request: {
						connect: {
							id: request.id,
						},
					},
					offer: {
						connect: {
							id: offer.id,
						},
					},
				},
			})
		}

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

		if (!user.offers.length) {
			await ctx.reply(
				'❌ У вас пока нет запросов на покупку.\n\nИспользуйте команду /request для создания нового запроса.',
				Markup.inlineKeyboard([
					[Markup.button.callback('🔍 Создать запрос', 'create_request')],
				]),
			)
			return
		}

		// Создаем кнопки для каждого запроса
		const buttons = user.offers.map((req, index) => [
			Markup.button.callback(
				`${index + 1}. ${req.breed} (${req.matches.length} предложений)`,
				`view_request_${req.id}`,
			),
		])

		buttons.push([
			Markup.button.callback('🔍 Создать новый запрос', 'create_request'),
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
📋 <b>Детали запроса:</b>

🐮 Порода: ${request.breed}
🔢 Количество: ${request.quantity} голов
⚖️ Вес: ${request.weight} кг
🌱 Возраст: ${request.age} мес.
📅 Срок: ${this.formatDate(request.deadline)}
🎯 Цель: ${this.getPurposeText(request.purpose)}
💰 Макс. цена: ${request.maxPrice} ₽/гол
📍 Доставка: ${request.location}

📬 <b>Найденные предложения (${request.matches.length}):</b>`

		const buttons = []

		if (request.matches.length > 0) {
			request.matches.forEach((match, index) => {
				const offer = match.offer
				buttons.push([
					Markup.button.callback(
						`${index + 1}. ${offer.breed} - ${offer.price}₽ (${
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

🐮 Порода: ${offer.breed}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
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
		const user = await this.prisma.user.findUnique({
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

		const activeMatches = user.offers.flatMap(offer =>
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
				`${index + 1}. ${match.request.breed} от ${match.request.user.name}`,
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
}
