// Сервис для работы с объявлениями
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CattlePurpose, CattleType, PriceType } from '@prisma/client'
import fetch from 'node-fetch'
import { Context, Markup } from 'telegraf'
import { CallbackQuery } from 'telegraf/typings/core/types/typegram'
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
	videos: Array<{ url: string }>
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
	cattleType?: CattleType
	purpose?: CattlePurpose
	priceType?: PriceType
	pricePerKg?: number
	pricePerHead?: number
	gktDiscount?: number
	region?: string
	fullAddress?: string
	customsUnion?: boolean
	videoUrl?: string
	addingGktDiscount?: boolean
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
			this.offerStates.set(userId, {
				photos: [],
				videos: [],
				inputType: 'mercury_number',
			})
			await ctx.reply(
				'🔢 Для создания объявления необходимо указать номер в системе "Меркурий".\n\nПожалуйста, введите ваш номер:',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '⏩ Пропустить', callback_data: 'skip_mercury' }],
							[{ text: '« Отмена', callback_data: 'menu' }],
						],
					},
				},
			)
			return
		}

		// Если номер есть или пользователь пропустил, начинаем создание объявления
		this.offerStates.set(userId, {
			photos: [],
			videos: [],
		})
		await ctx.reply(
			'📸 Отправьте фотографии или видео КРС (до 5 файлов)\n\n' +
				'✅ Рекомендуется:\n' +
				'• Фотографии животных в полный рост\n' +
				'• Съемка при хорошем освещении\n' +
				'• Фото с разных ракурсов\n' +
				'• Видео с обходом животных\n\n' +
				'⚠️ Поддерживаются фото и видео до 50MB',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '➡️ Продолжить', callback_data: 'media_done' }],
						[{ text: '« Отмена', callback_data: 'menu' }],
					],
				},
			},
		)
	}

	async handlePhotoUpload(ctx: Context) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			// Проверяем лимит файлов
			const totalFiles =
				(state.photos?.length || 0) + (state.videos?.length || 0)
			if (totalFiles >= 5) {
				await ctx.reply('❌ Достигнут лимит медиафайлов (максимум 5)')
				return
			}

			// Получаем фотографию с наилучшим качеством
			const message = ctx.message
			if (!('photo' in message)) {
				await ctx.reply('❌ Не удалось получить фотографию')
				return
			}

			const photos = message.photo
			const bestPhoto = photos[photos.length - 1]
			const fileId = bestPhoto.file_id

			// Получаем информацию о файле
			const fileInfo = await ctx.telegram.getFile(fileId)
			const fileUrl = `https://api.telegram.org/file/bot${this.configService.get('TELEGRAM_BOT_TOKEN')}/${fileInfo.file_path}`

			// Загружаем файл в буфер
			const response = await fetch(fileUrl)
			const buffer = await response.buffer()

			// Создаем объект файла для загрузки в S3
			const file: UploadedFile = {
				buffer,
				originalname: `photo_${Date.now()}.jpg`,
				mimetype: 'image/jpeg',
				fieldname: 'photo',
				encoding: '7bit',
				size: buffer.length,
			}

			// Загружаем файл в S3
			const uploadedFile = await this.s3Service.uploadFile(file)

			// Добавляем фотографию в состояние
			if (!state.photos) {
				state.photos = []
			}
			state.photos.push({
				url: uploadedFile.url,
				key: uploadedFile.key,
			})

			this.updateOfferState(userId, state)

			// Обновляем счетчик файлов
			const newTotalFiles =
				(state.photos?.length || 0) + (state.videos?.length || 0)
			const remainingFiles = 5 - newTotalFiles

			// Отправляем сообщение о загрузке фотографии
			await ctx.reply(
				`✅ Фотография загружена (${newTotalFiles}/5)\n\n${
					remainingFiles > 0
						? `Вы можете загрузить еще ${remainingFiles} медиафайл(ов) или нажать кнопку "Готово" для продолжения.`
						: 'Достигнут лимит медиафайлов. Нажмите "Готово" для продолжения.'
				}`,
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '✅ Готово', callback_data: 'media_done' }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при загрузке фотографии:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке фотографии')
		}
	}

	// Добавляем метод валидации телефона
	private validatePhone(phone: string): boolean {
		const phoneRegex = /^\+?[0-9]{10,15}$/
		return phoneRegex.test(phone)
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
				state.inputType = 'description'
				this.offerStates.set(userId, state)
				await ctx.reply('📝 Введите описание объявления:')
				break

			case 'description':
				state.description = text
				state.inputType = 'cattle_type'
				this.offerStates.set(userId, state)

				// Запрашиваем тип КРС через кнопки
				await ctx.reply('🐮 Выберите тип КРС:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '🐄 Телята', callback_data: 'cattle_type_CALVES' },
								{ text: '🐂 Бычки', callback_data: 'cattle_type_BULL_CALVES' },
							],
							[
								{ text: '🐄 Телки', callback_data: 'cattle_type_HEIFERS' },
								{
									text: '🐄 Нетели',
									callback_data: 'cattle_type_BREEDING_HEIFERS',
								},
							],
							[
								{ text: '🐂 Быки', callback_data: 'cattle_type_BULLS' },
								{ text: '🐄 Коровы', callback_data: 'cattle_type_COWS' },
							],
						],
					},
				})
				break

			case 'breed':
				state.breed = text
				state.inputType = 'purpose'
				this.offerStates.set(userId, state)

				// Запрашиваем назначение через кнопки
				await ctx.reply('🎯 Выберите назначение КРС:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '🏪 Товарный', callback_data: 'purpose_COMMERCIAL' },
								{ text: '🧬 Племенной', callback_data: 'purpose_BREEDING' },
							],
						],
					},
				})
				break

			case 'price_per_head':
				const pricePerHead = parseFloat(text)
				if (isNaN(pricePerHead) || pricePerHead <= 0) {
					await ctx.reply('❌ Введите корректную цену (число больше 0)')
					return
				}
				state.pricePerHead = pricePerHead
				state.inputType = 'quantity'
				this.offerStates.set(userId, state)
				await ctx.reply('🔢 Введите количество голов:')
				break

			case 'price_per_kg':
				const pricePerKg = parseFloat(text)
				if (isNaN(pricePerKg) || pricePerKg <= 0) {
					await ctx.reply('❌ Введите корректную цену (число больше 0)')
					return
				}
				state.pricePerKg = pricePerKg
				state.inputType = 'quantity'
				this.offerStates.set(userId, state)
				await ctx.reply('🔢 Введите количество голов:')
				break

			case 'quantity':
				const quantity = parseInt(text)
				if (isNaN(quantity) || quantity <= 0) {
					await ctx.reply(
						'❌ Введите корректное количество (целое число больше 0)',
					)
					return
				}
				state.quantity = quantity
				state.inputType = 'weight'
				this.offerStates.set(userId, state)
				await ctx.reply('⚖️ Введите вес одной головы (кг):')
				break

			case 'weight':
				const weight = parseFloat(text)
				if (isNaN(weight) || weight <= 0) {
					await ctx.reply('❌ Введите корректный вес')
					return
				}
				state.weight = weight
				state.inputType = 'age'
				this.offerStates.set(userId, state)
				await ctx.reply('🌱 Введите возраст (месяцев):')
				break

			case 'age':
				const age = parseInt(text)
				if (isNaN(age) || age <= 0) {
					await ctx.reply(
						'❌ Введите корректный возраст (целое число больше 0)',
					)
					return
				}
				state.age = age
				state.inputType = 'ask_gkt_discount'
				this.offerStates.set(userId, state)

				// Спрашиваем про скидку ЖКТ через кнопки
				await ctx.reply('Будет ли скидка на ЖКТ?', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✅ Да', callback_data: 'gut_yes' },
								{ text: '❌ Нет', callback_data: 'gut_no' },
							],
						],
					},
				})
				break

			case 'gkt_discount':
				const discount = parseFloat(text)
				if (isNaN(discount) || discount < 0 || discount > 100) {
					await ctx.reply('❌ Введите корректную скидку (число от 0 до 100)')
					return
				}
				state.gktDiscount = discount
				state.inputType = 'region'
				this.offerStates.set(userId, state)
				await ctx.reply('📍 Введите регион:')
				break

			case 'region':
				state.region = text
				state.inputType = 'customs_union'
				this.offerStates.set(userId, state)

				// Спрашиваем о Таможенном Союзе
				await ctx.reply('Состоит ли в Реестре Таможенного Союза?', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✅ Да', callback_data: 'customs_yes' },
								{ text: '❌ Нет', callback_data: 'customs_no' },
							],
						],
					},
				})
				break

			case 'full_address':
				state.fullAddress = text
				await this.createOffer(ctx, state)
				break
		}
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

			// Проверяем, что тип КРС соответствует допустимым значениям
			const validCattleTypes = [
				'CALVES',
				'BULL_CALVES',
				'HEIFERS',
				'BREEDING_HEIFERS',
				'BULLS',
				'COWS',
			]

			if (!state.cattleType || !validCattleTypes.includes(state.cattleType)) {
				// Если тип КРС недопустимый, устанавливаем значение по умолчанию
				state.cattleType = 'CALVES'
			}

			// Подготавливаем данные для создания объявления
			const offerData = {
				user: { connect: { id: user.id } },
				title: state.title,
				description: state.description,
				quantity: state.quantity,
				age: state.age,
				weight: state.weight,
				breed: state.breed,
				status: 'PENDING',
				mercuryNumber: state.mercuryNumber,
				contactPerson: state.contactPerson,
				contactPhone: state.contactPhone,
				cattleType: state.cattleType,
				purpose: state.purpose || CattlePurpose.COMMERCIAL,
				priceType: state.priceType || PriceType.PER_HEAD,
				pricePerKg: state.pricePerKg || 0,
				pricePerHead: state.pricePerHead || 0,
				gktDiscount: state.gktDiscount || 0,
				region: state.region || state.location,
				location: state.region || '',
				fullAddress: state.fullAddress || state.region,
				customsUnion: state.customsUnion || false,
				// Используем URL первого видео, если есть
				videoUrl:
					state.videos && state.videos.length > 0 ? state.videos[0].url : '',
				price: state.pricePerHead || state.pricePerKg || 0,
			}

			// Добавляем фотографии, если они есть
			if (state.photos && state.photos.length > 0) {
				offerData['images'] = {
					create: state.photos.map(photo => ({
						url: photo.url,
						key: photo.key,
					})),
				}
			}

			console.log(
				'Создание объявления с данными:',
				JSON.stringify(offerData, null, 2),
			)

			// Создаем объявление в базе данных
			const offer = await this.prisma.offer.create({
				data: offerData,
				include: {
					images: true,
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
🐮 Тип: ${this.getCattleTypeText(offer.cattleType)}
🎯 Назначение: ${this.getPurposeText(offer.purpose)}
💰 Цена: ${
					offer.priceType === 'PER_HEAD'
						? `${offer.pricePerHead} руб/голову`
						: `${offer.pricePerKg} руб/кг`
				}
${offer.gktDiscount > 0 ? `🔻 Скидка на ЖКТ: ${offer.gktDiscount}%\n` : ''}
🔢 Количество: ${offer.quantity} голов
🐮 Порода: ${offer.breed}
🌱 Возраст: ${offer.age} мес.
⚖️ Вес: ${offer.weight} кг
📍 Регион: ${offer.region}
📍 Полный адрес: ${offer.fullAddress}
${offer.customsUnion ? '✅ Состоит в Реестре ТС\n' : '❌ Не состоит в Реестре ТС\n'}
${offer.videoUrl ? `🎥 Видео: ${offer.videoUrl}\n` : ''}

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
		const userId = ctx.from.id

		// Проверяем авторизацию пользователя
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply('❌ Для просмотра объявлений необходимо авторизоваться', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '🔑 Войти', callback_data: 'login' },
							{ text: '📝 Регистрация', callback_data: 'register' },
						],
					],
				},
			})
			return
		}

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
		try {
			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			const offerId = callbackQuery.data.replace('view_offer_', '')

			// Отправляем сообщение о загрузке
			const loadingMessage = await ctx.reply('⏳ Загрузка объявления...')

			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: { images: true },
			})

			if (!offer) {
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					loadingMessage.message_id,
					undefined,
					'❌ Объявление не найдено',
				)
				return
			}

			// Формируем текст объявления
			const offerText = this.formatOfferText(offer)

			try {
				// Удаляем сообщение о загрузке
				await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id)

				// 1. Сначала отправляем видео, если оно есть
				if (offer.videoUrl && offer.videoUrl !== '-') {
					const videoLoadingMsg = await ctx.reply('🎥 Загрузка видео...')

					try {
						if (
							offer.videoUrl.includes('youtube.com') ||
							offer.videoUrl.includes('youtu.be')
						) {
							await ctx.telegram.deleteMessage(
								ctx.chat.id,
								videoLoadingMsg.message_id,
							)
							await ctx.reply(
								`🎥 <a href="${offer.videoUrl}">Смотреть видео</a>`,
								{
									parse_mode: 'HTML',
								},
							)
						} else {
							await ctx.replyWithVideo(offer.videoUrl)
							await ctx.telegram.deleteMessage(
								ctx.chat.id,
								videoLoadingMsg.message_id,
							)
						}
					} catch (videoError) {
						console.error('Ошибка при отправке видео:', videoError)
						await ctx.telegram.editMessageText(
							ctx.chat.id,
							videoLoadingMsg.message_id,
							undefined,
							`🎥 <a href="${offer.videoUrl}">Смотреть видео</a>`,
							{ parse_mode: 'HTML' },
						)
					}
				}

				// 2. Затем отправляем фотографии, если они есть
				if (offer.images && offer.images.length > 0) {
					if (offer.images.length === 1) {
						// Если фотография одна, отправляем ее отдельно
						await ctx.replyWithPhoto(offer.images[0].url)
					} else if (offer.images.length > 1) {
						// Если фотографий несколько, отправляем их как медиагруппу
						const mediaGroup = offer.images.slice(0, 10).map(image => ({
							type: 'photo',
							media: image.url,
						}))

						// @ts-ignore - типы Telegraf не полностью поддерживают медиагруппы
						await ctx.replyWithMediaGroup(mediaGroup)
					}
				}

				// 3. Наконец, отправляем текст объявления с кнопками
				// Используем оба варианта кнопки "Назад" для надежности
				await ctx.reply(offerText, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '📞 Запросить контакты',
									callback_data: `request_contacts_${offer.id}`,
								},
							],
							[
								{
									text: '« Назад к списку',
									callback_data: 'back_to_offers_list',
								},
							],
							[
								{
									text: '« Меню',
									callback_data: 'menu',
								},
							],
						],
					},
				})
			} catch (error) {
				console.error('Ошибка при отправке объявления:', error)

				// В случае ошибки, отправляем только текст
				await ctx.reply(offerText, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '📞 Запросить контакты',
									callback_data: `request_contacts_${offer.id}`,
								},
							],
							[
								{
									text: '« Назад к списку',
									callback_data: 'back_to_offers_list',
								},
							],
							[
								{
									text: '« Меню',
									callback_data: 'menu',
								},
							],
						],
					},
				})

				// Если есть видео, добавляем ссылку на него
				if (offer.videoUrl && offer.videoUrl !== '-') {
					await ctx.reply(`🎥 <a href="${offer.videoUrl}">Смотреть видео</a>`, {
						parse_mode: 'HTML',
					})
				}
			}
		} catch (error) {
			console.error('Ошибка при просмотре объявления:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявления')
		}
	}

	// Вспомогательный метод для форматирования текста объявления
	formatOfferText(offer) {
		return `
🐮 <b>${offer.title}</b>

🐄 Тип КРС: ${this.getCattleTypeText(offer.cattleType)}
🧬 Порода: ${offer.breed}
🎯 Назначение: ${offer.purpose === 'BREEDING' ? 'Племенной' : 'Товарный'}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.

💰 Цена: ${
			offer.priceType === 'PER_HEAD'
				? `${offer.pricePerHead.toLocaleString('ru-RU')} ₽/голову`
				: `${offer.pricePerKg.toLocaleString('ru-RU')} ₽/кг`
		}
${offer.gktDiscount > 0 ? `🔻 Скидка на ЖКТ: ${offer.gktDiscount}%\n` : ''}
📍 Регион: ${offer.region}
📝 ${offer.description || 'Описание отсутствует'}`
	}

	// Вспомогательный метод для получения текстового представления типа КРС
	getCattleTypeText(cattleType) {
		const types = {
			CALVES: 'Телята',
			BULL_CALVES: 'Бычки',
			HEIFERS: 'Телки',
			BREEDING_HEIFERS: 'Нетели',
			BULLS: 'Быки',
			COWS: 'Коровы',
		}
		return types[cattleType] || cattleType
	}

	private getPurposeText(purpose: string): string {
		return purpose === 'COMMERCIAL' ? 'Товарный' : 'Племенной'
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
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.inputType = 'title'
			this.updateOfferState(userId, state)
			await ctx.reply('📝 Введите название объявления:')
		} catch (error) {
			console.error('Ошибка при завершении загрузки фото:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	async startOfferCreation(ctx: Context) {
		const userId = ctx.from.id

		// Проверяем роль пользователя
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

		// Инициализируем состояние с пустыми массивами для фото и видео
		this.offerStates.set(userId, { photos: [], videos: [] })
		await ctx.reply(
			'📸 Загрузите медиафайлы КРС (до 5 файлов)\n\n' +
				'✅ Рекомендуется:\n' +
				'• Фотографии животных в полный рост\n' +
				'• Съемка при хорошем освещении\n' +
				'• Фото с разных ракурсов\n' +
				'• Видео с обходом животных\n\n' +
				'⚠️ Поддерживаются фото и видео до 50MB',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '➡️ Продолжить', callback_data: 'media_done' }],
						[{ text: '« Отмена', callback_data: 'menu' }],
					],
				},
			},
		)
	}

	// Добавляем обработчик видео
	async handleVideo(ctx: Context) {
		const userId = ctx.from.id
		const state = this.offerStates.get(userId)
		//@ts-ignore
		const video = ctx.message.video

		if (!state) {
			await ctx.reply('❌ Начните создание объявления заново')
			return
		}

		const totalFiles = state.photos.length + state.videos.length
		if (totalFiles >= 5) {
			await ctx.reply('❌ Достигнут лимит файлов (максимум 5)')
			return
		}

		if (video.file_size > 50 * 1024 * 1024) {
			await ctx.reply(
				'❌ Размер видео превышает 50MB. Пожалуйста, отправьте файл меньшего размера.',
			)
			return
		}

		// Получаем ссылку на файл
		const fileLink = await ctx.telegram.getFile(video.file_id)
		const videoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileLink.file_path}`

		// Сохраняем ссылку на видео в состоянии
		state.videos.push({ url: videoUrl })
		this.offerStates.set(userId, state)

		await ctx.reply(
			`✅ Видео ${totalFiles + 1}/5 загружено\n\nДобавьте еще файлы или нажмите "Продолжить"`,
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '➡️ Продолжить', callback_data: 'media_done' }],
						[{ text: '« Отмена', callback_data: 'menu' }],
					],
				},
			},
		)
	}

	// Добавляем публичный метод для обновления состояния
	updateOfferState(userId: number, state: OfferState): void {
		this.offerStates.set(userId, state)
	}

	// Обработка загрузки видео
	async handleVideoUpload(ctx: Context) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			// Проверяем лимит файлов
			const totalFiles =
				(state.photos?.length || 0) + (state.videos?.length || 0)
			if (totalFiles >= 5) {
				await ctx.reply('❌ Достигнут лимит медиафайлов (максимум 5)')
				return
			}

			// Получаем видео
			const message = ctx.message
			if (!('video' in message)) {
				await ctx.reply('❌ Не удалось получить видео')
				return
			}

			const video = message.video

			// Проверяем размер видео
			if (video.file_size > 50 * 1024 * 1024) {
				await ctx.reply(
					'❌ Размер видео превышает 50MB. Пожалуйста, отправьте файл меньшего размера.',
				)
				return
			}

			const fileId = video.file_id

			// Получаем информацию о файле
			const fileInfo = await ctx.telegram.getFile(fileId)
			const fileUrl = `https://api.telegram.org/file/bot${this.configService.get('TELEGRAM_BOT_TOKEN')}/${fileInfo.file_path}`

			// Загружаем файл в буфер
			const response = await fetch(fileUrl)
			const buffer = await response.buffer()

			// Создаем объект файла для загрузки в S3
			const file: UploadedFile = {
				buffer,
				originalname: `video_${Date.now()}.mp4`,
				mimetype: 'video/mp4',
				fieldname: 'video',
				encoding: '7bit',
				size: buffer.length,
			}

			// Загружаем файл в S3
			const uploadedFile = await this.s3Service.uploadFile(file)

			// Добавляем видео в состояние
			if (!state.videos) {
				state.videos = []
			}
			state.videos.push({
				url: uploadedFile.url,
			})

			// Сохраняем URL видео для объявления
			state.videoUrl = uploadedFile.url

			this.updateOfferState(userId, state)

			// Обновляем счетчик файлов
			const newTotalFiles =
				(state.photos?.length || 0) + (state.videos?.length || 0)
			const remainingFiles = 5 - newTotalFiles

			// Отправляем сообщение о загрузке видео
			await ctx.reply(
				`✅ Видео загружено (${newTotalFiles}/5)\n\n${
					remainingFiles > 0
						? `Вы можете загрузить еще ${remainingFiles} медиафайл(ов) или нажать кнопку "Готово" для продолжения.`
						: 'Достигнут лимит медиафайлов. Нажмите "Готово" для продолжения.'
				}`,
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '✅ Готово', callback_data: 'media_done' }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при загрузке видео:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке видео')
		}
	}
}
