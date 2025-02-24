// Сервис для работы с объявлениями
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fetch from 'node-fetch'
import { Context, Markup } from 'telegraf'
import {
	CallbackQuery,
	InputMediaPhoto,
} from 'telegraf/typings/core/types/typegram'
import { S3Service } from '../../common/services/s3.service'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'

interface UploadedFile {
	buffer: Buffer
	originalname: string
	mimetype: string
	fieldname: string
	encoding: string
	size: number
	url?: string
	type?: string
}

interface OfferState {
	photos: Array<{ url: string; key: string }>
	inputType?: string
	title?: string
	quantity?: number
	weight?: number
	age?: number
	price?: number
	location?: string
	description?: string
	mercuryNumber?: string
	contactPerson?: string
	contactPhone?: string
	breed?: string
}

@Injectable()
export class TelegramOfferService {
	private offerStates: Map<number, OfferState> = new Map()

	constructor(
		private prisma: PrismaService,
		private s3Service: S3Service,
		private configService: ConfigService,
		private telegramClient: TelegramClient,
	) {}

	async handleCreateOffer(ctx: Context) {
		const userId = ctx.from.id

		// Проверяем наличие номера Меркурий у пользователя
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user?.mercuryNumber) {
			// Если номера нет, запрашиваем его
			this.offerStates.set(userId, { photos: [], inputType: 'mercury_number' })
			await ctx.reply(
				'🔢 Для создания объявления необходимо указать номер в системе "Меркурий".\n\nПожалуйста, введите ваш номер:',
				{
					reply_markup: {
						inline_keyboard: [[Markup.button.callback('« Отмена', 'menu')]],
					},
				},
			)
			return
		}

		// Если номер есть, начинаем создание объявления
		this.offerStates.set(userId, { photos: [] })
		await ctx.reply(
			'📸 Отправьте фотографии КРС (до 5 фото)\n\n' +
				'✅ Рекомендуется:\n' +
				'• Фото животных в полный рост\n' +
				'• При хорошем освещении\n' +
				'• С разных ракурсов',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '➡️ Продолжить', callback_data: 'photos_done' }],
						[{ text: '« Отмена', callback_data: 'menu' }],
					],
				},
			},
		)
	}

	async handlePhotoUpload(ctx: Context, fileUrl: string, userId: number) {
		const state = this.offerStates.get(userId)
		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		if (state.photos.length >= 5) {
			await ctx.reply('❌ Достигнут лимит фотографий (максимум 5)')
			return
		}

		try {
			// Загружаем фото в S3
			const uploadResult = await this.s3Service.uploadFile({
				buffer: Buffer.from(await (await fetch(fileUrl)).arrayBuffer()),
				originalname: `photo_${Date.now()}.jpg`,
				mimetype: 'image/jpeg',
				fieldname: 'file',
				encoding: '7bit',
				size: 0,
			})

			state.photos.push({
				url: uploadResult.url,
				key: uploadResult.key,
			})

			this.offerStates.set(userId, state)

			await ctx.reply(
				`✅ Фото ${state.photos.length}/5 добавлено\n\nДобавьте еще фото или нажмите "Продолжить"`,
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '➡️ Продолжить', callback_data: 'photos_done' }],
							[{ text: '« Отмена', callback_data: 'menu' }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при загрузке фото:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке фото')
		}
	}

	async handleOfferInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const state = this.offerStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		switch (state.inputType) {
			case 'mercury_number':
				await this.prisma.user.update({
					where: { telegramId: userId.toString() },
					data: { mercuryNumber: text },
				})
				await this.handleCreateOffer(ctx)
				break

			case 'title':
				state.title = text
				state.inputType = 'breed'
				await ctx.reply('🐮 Введите породу КРС:')
				break

			case 'breed':
				state.breed = text
				state.inputType = 'quantity'
				await ctx.reply('🔢 Введите количество голов:')
				break

			case 'quantity':
				const quantity = parseInt(text)
				if (isNaN(quantity) || quantity <= 0) {
					await ctx.reply('❌ Введите корректное количество')
					return
				}
				state.quantity = quantity
				state.inputType = 'weight'
				await ctx.reply('⚖️ Введите вес (кг):')
				break

			case 'weight':
				const weight = parseFloat(text)
				if (isNaN(weight) || weight <= 0) {
					await ctx.reply('❌ Введите корректный вес')
					return
				}
				state.weight = weight
				state.inputType = 'age'
				await ctx.reply('🌱 Введите возраст (месяцев):')
				break

			case 'age':
				const age = parseInt(text)
				if (isNaN(age) || age <= 0) {
					await ctx.reply('❌ Введите корректный возраст')
					return
				}
				state.age = age
				state.inputType = 'price'
				await ctx.reply('💰 Введите цену за голову (₽):')
				break

			case 'price':
				const price = parseFloat(text)
				if (isNaN(price) || price <= 0) {
					await ctx.reply('❌ Введите корректную цену')
					return
				}
				state.price = price
				state.inputType = 'location'
				await ctx.reply('📍 Введите регион:')
				break

			case 'location':
				state.location = text
				state.inputType = 'mercury'
				await ctx.reply('📋 Введите RU-номер в системе "Меркурий":')
				break

			case 'mercury':
				state.mercuryNumber = text
				state.inputType = 'contact_person'
				await ctx.reply('👤 Введите ФИО контактного лица:')
				break

			case 'contact_person':
				state.contactPerson = text
				state.inputType = 'contact_phone'
				await ctx.reply('📱 Введите контактный телефон:')
				break

			case 'contact_phone':
				if (!this.validatePhone(text)) {
					await ctx.reply(
						'❌ Неверный формат номера. Введите в формате +7XXXXXXXXXX',
					)
					return
				}
				state.contactPhone = text
				state.inputType = 'description'
				await ctx.reply('📝 Введите дополнительное описание:')
				break

			case 'description':
				state.description = text
				await this.createOffer(ctx, state)
				break
		}

		this.offerStates.set(userId, state)
	}

	async createOffer(ctx: Context, state: OfferState) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			const offer = await this.prisma.offer.create({
				data: {
					user: { connect: { id: user.id } },
					title: state.title,
					description: state.description,
					price: state.price,
					quantity: state.quantity,
					age: state.age,
					weight: state.weight,
					location: state.location,
					breed: state.breed,
					status: 'PENDING',
					mercuryNumber: state.mercuryNumber,
					contactPerson: state.contactPerson,
					contactPhone: state.contactPhone,
					images: {
						create: state.photos.map(photo => ({
							url: photo.url,
							key: photo.key,
						})),
					},
				},
			})

			this.offerStates.delete(userId)
			await ctx.reply(
				'✅ Объявление создано и отправлено на модерацию!\n\nПосле проверки администратором, оно станет доступно в общем списке.',
				{
					reply_markup: {
						inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
					},
				},
			)

			// Уведомляем админов
			await this.notifyAdmins(offer)
		} catch (error) {
			console.error('Ошибка при создании объявления:', error)
			await ctx.reply('❌ Произошла ошибка при создании объявления')
		}
	}

	// Добавляем метод для уведомления админов
	private async notifyAdmins(offer: any) {
		const admins = await this.prisma.user.findMany({
			where: { role: 'ADMIN' },
		})

		for (const admin of admins) {
			if (admin.telegramId) {
				const message = `
🆕 Новое объявление на модерацию:

📝 Название: ${offer.title}
💰 Цена: ${offer.price} руб/голову
🔢 Количество: ${offer.quantity} голов
🐮 Порода: ${offer.breed}
🌱 Возраст: ${offer.age} мес.
⚖️ Вес: ${offer.weight} кг
📍 Локация: ${offer.location}

${offer.description}

Используйте команду /verify_offer_${offer.id} для подтверждения
`
				await this.telegramClient.sendMessage(admin.telegramId, message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '✅ Подтвердить',
									callback_data: `verify_offer_${offer.id}`,
								},
								{
									text: '❌ Отклонить',
									callback_data: `reject_offer_${offer.id}`,
								},
							],
						],
					},
				})
			}
		}
	}

	// Добавляем метод для подтверждения объявления
	async verifyOffer(offerId: string) {
		const offer = await this.prisma.offer.update({
			where: { id: offerId },
			data: { status: 'ACTIVE' },
			include: { user: true },
		})

		// Уведомляем пользователя о подтверждении
		if (offer.user.telegramId) {
			await this.telegramClient.sendMessage(
				offer.user.telegramId,
				`✅ Ваше объявление "${offer.title}" было подтверждено модератором и опубликовано!`,
			)
		}

		return offer
	}

	// Добавляем метод для отклонения объявления
	async rejectOffer(offerId: string) {
		const offer = await this.prisma.offer.update({
			where: { id: offerId },
			data: { status: 'REJECTED' },
			include: { user: true },
		})

		// Уведомляем пользователя об отклонении
		if (offer.user.telegramId) {
			await this.telegramClient.sendMessage(
				offer.user.telegramId,
				`❌ Ваше объявление "${offer.title}" было отклонено модератором.`,
			)
		}

		return offer
	}

	async handlePhoto(ctx) {
		const userId = ctx.from.id
		const offerState = this.offerStates.get(userId)

		if (!offerState) {
			await ctx.reply('❌ Сначала начните создание объявления')
			return
		}

		if (!offerState.photos) {
			offerState.photos = []
		}

		if (offerState.photos.length >= 10) {
			await ctx.reply(
				'❌ Достигнут лимит фотографий (10 шт)\n\nВведите название объявления:',
				{
					reply_markup: Markup.inlineKeyboard([
						[Markup.button.callback('« Назад', 'create_offer')],
					]),
				},
			)
			return
		}

		try {
			// Получаем файл из Telegram
			const photo = ctx.message.photo[ctx.message.photo.length - 1]
			const file = await ctx.telegram.getFile(photo.file_id)

			// Скачиваем файл
			const response = await fetch(
				`https://api.telegram.org/file/bot${this.configService.get(
					'BOT_TOKEN',
				)}/${file.file_path}`,
			)
			const buffer = Buffer.from(await response.arrayBuffer())

			// Создаем объект файла для S3
			const s3File: UploadedFile = {
				buffer,
				originalname: `photo_${Date.now()}.jpg`,
				mimetype: 'image/jpeg',
				fieldname: 'file',
				encoding: '7bit',
				size: buffer.length,
			}

			// Загружаем в S3
			const uploadedFile = await this.s3Service.uploadFile(s3File)

			// Сохраняем URL и ключ файла
			offerState.photos.push({
				url: uploadedFile.url,
				key: uploadedFile.key,
			})

			this.offerStates.set(userId, offerState)

			if (offerState.photos.length === 1) {
				await ctx.reply('Отлично! Теперь введите название объявления:')
			} else {
				await ctx.reply(
					`Фото ${offerState.photos.length}/10 загружено. Отправьте еще или введите название объявления:`,
				)
			}
		} catch (error) {
			console.error('Ошибка при обработке фото:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке фото')
		}
	}

	async handleMyOffers(ctx) {
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
				[Markup.button.callback('📝 Создать новое объявление', 'create_offer')],
				[Markup.button.callback('« Назад', 'menu')],
			]),
		})
	}

	async handleBrowseOffers(ctx: Context, page: number = 1) {
		const ITEMS_PER_PAGE = 10
		const skip = (page - 1) * ITEMS_PER_PAGE

		const totalOffers = await this.prisma.offer.count({
			where: {
				status: 'ACTIVE',
			},
		})

		const totalPages = Math.ceil(totalOffers / ITEMS_PER_PAGE)

		const offers = await this.prisma.offer.findMany({
			where: {
				status: 'ACTIVE',
			},
			include: {
				images: true,
			},
			orderBy: {
				createdAt: 'desc',
			},
			take: ITEMS_PER_PAGE,
			skip: skip,
		})

		if (!offers.length) {
			await ctx.reply('📭 Пока нет активных объявлений', {
				reply_markup: {
					inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
				},
			})
			return
		}

		// Создаем кнопки для каждого предложения
		const offerButtons = offers.map(offer => [
			{
				text: `${offer.price.toLocaleString('ru-RU')}₽ - ${offer.breed || 'КРС'}`,
				callback_data: `view_offer_${offer.id}`,
			},
		])

		// Добавляем кнопки пагинации
		const paginationButtons = []
		if (totalPages > 1) {
			const buttons = []
			if (page > 1) {
				buttons.push({
					text: '« Предыдущая',
					callback_data: `browse_offers_${page - 1}`,
				})
			}
			if (page < totalPages) {
				buttons.push({
					text: 'Следующая »',
					callback_data: `browse_offers_${page + 1}`,
				})
			}
			if (buttons.length > 0) {
				paginationButtons.push(buttons)
			}
		}

		await ctx.reply('📋 <b>Выберите предложение:</b>', {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					...offerButtons,
					...paginationButtons,
					[{ text: '« Меню', callback_data: 'menu' }],
				],
			},
		})
	}

	// Метод для получения только региона
	private getRegionOnly(location: string): string {
		// Берем только первое слово из локации (предполагается, что это регион)
		return location.split(' ')[0]
	}

	// Обработчик запроса контактов
	async handleContactRequest(ctx: Context) {
		const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
		const offerId = callbackQuery.data.split('_')[2]
		const userId = ctx.from.id

		const [user, offer] = await Promise.all([
			this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			}),
			this.prisma.offer.findUnique({
				where: { id: offerId },
				include: { user: true },
			}),
		])

		await ctx.reply(
			'📱 Запрос на получение контактов отправлен администратору',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '« Назад', callback_data: `view_offer_${offerId}` }],
						[{ text: '« Меню', callback_data: 'menu' }],
					],
				},
			},
		)

		// Уведомляем админов
		const admins = await this.prisma.user.findMany({
			where: { role: 'ADMIN' },
		})

		const approveUrl = `${process.env.API_URL}/api/approve-contacts?offerId=${offerId}&userId=${user.id}`

		const adminMessage = `
🔔 Новый запрос на контакты

От кого:
👤 ${user.name}
📧 ${user.email}
📱 ${user.phone || 'Телефон не указан'}

Запрашивает информацию по объявлению:
🐮 ${offer.breed || 'КРС'}
💰 ${offer.price.toLocaleString('ru-RU')}₽/гол
🔢 ${offer.quantity} голов
📍 ${this.getRegionOnly(offer.location)}

<a href="${approveUrl}">🔗 Разрешить доступ к контактам</a>`

		for (const admin of admins) {
			if (admin.telegramId) {
				await this.telegramClient.sendMessage(admin.telegramId, adminMessage, {
					parse_mode: 'HTML',
					disable_web_page_preview: true,
				})
			}
		}
	}

	async handleViewOffer(ctx: Context) {
		const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
		const offerId = callbackQuery.data.split('_')[2]

		const offer = await this.prisma.offer.findUnique({
			where: { id: offerId },
			include: { images: true },
		})

		if (!offer) {
			await ctx.reply('❌ Объявление не найдено или было удалено', {
				reply_markup: {
					inline_keyboard: [
						[{ text: '« Назад', callback_data: 'browse_offers' }],
					],
				},
			})
			return
		}

		// Отправляем все фотографии одним сообщением
		if (offer.images && offer.images.length > 0) {
			const mediaGroup: InputMediaPhoto[] = offer.images.map(
				(image, index) => ({
					type: 'photo',
					media: image.url,
					caption: index === 0 ? `🐮 <b>КРС</b>` : undefined,
					parse_mode: index === 0 ? 'HTML' : undefined,
				}),
			)

			await ctx.replyWithMediaGroup(mediaGroup)
		}

		const offerDetails = `
${offer.breed ? `🐄 Порода: ${offer.breed}\n` : ''}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${offer.price.toLocaleString('ru-RU')} ₽/гол
📍 Регион: ${this.getRegionOnly(offer.location)}

📝 ${offer.description || 'Описание отсутствует'}`

		await ctx.reply(offerDetails, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: '📲 Запросить контакты',
							callback_data: `request_contacts_${offer.id}`,
						},
					],
					[{ text: '« Назад к списку', callback_data: 'browse_offers' }],
					[{ text: '« Меню', callback_data: 'menu' }],
				],
			},
		})
	}

	async showMyOffers(ctx: Context) {
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
	offer.status === 'PENDING'
		? '⏳ На проверке'
		: offer.matches.length > 0
			? `✅ Заявок: ${offer.matches.length}`
			: ''
}`,
			)
			.join('\n\n')

		await ctx.reply(`📋 <b>Ваши объявления:</b>\n${offersList}`, {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('📝 Создать новое объявление', 'create_offer')],
				[Markup.button.callback('« Назад', 'menu')],
			]),
		})
	}

	getOfferState(userId: number): OfferState | undefined {
		return this.offerStates.get(userId)
	}

	async handlePhotosDone(ctx: Context) {
		const userId = ctx.from.id
		const state = this.offerStates.get(userId)

		if (!state || !state.photos || state.photos.length === 0) {
			await ctx.reply('❌ Необходимо добавить хотя бы одно фото')
			return
		}

		state.inputType = 'title'
		this.offerStates.set(userId, state)
		await ctx.reply('📝 Введите название объявления:')
	}

	async handleOfferTitleInput(ctx: Context, title: string) {
		const userId = ctx.from.id
		const state = this.offerStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		state.title = title
		state.inputType = 'quantity'
		this.offerStates.set(userId, state)
		await ctx.reply('🔢 Введите количество голов:')
	}

	private validatePhone(phone: string): boolean {
		const phoneRegex = /^\+?[0-9]{10,15}$/
		return phoneRegex.test(phone)
	}

	async askForDetail(
		ctx: Context,
		userId: number,
		detail: string,
		emoji: string,
		nextStep: string,
	) {
		const offerState = this.offerStates.get(userId)

		// Не устанавливаем флаг, а сразу подготавливаем поле для значения
		if (nextStep === 'description') {
			offerState.description = null // Инициализируем поле для описания
		}

		this.offerStates.set(userId, offerState)

		await ctx.reply(`${emoji} Введите ${detail}:`, {
			reply_markup: {
				inline_keyboard: [[Markup.button.callback('« Назад', 'create_offer')]],
			},
		})
	}

	async startOfferCreation(ctx: Context) {
		const userId = ctx.from.id
		this.offerStates.set(userId, { photos: [] })
		await ctx.reply(
			'📸 Для начала отправьте фотографии КРС (до 5 фото)\n\nКогда закончите добавлять фото, нажмите "Продолжить"',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '➡️ Продолжить', callback_data: 'photos_done' }],
					],
				},
			},
		)
	}
}
