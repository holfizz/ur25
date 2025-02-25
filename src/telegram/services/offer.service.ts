// Сервис для работы с объявлениями
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CattlePurpose, CattleType, PriceType } from '@prisma/client'
import fetch from 'node-fetch'
import { Context, Markup } from 'telegraf'
import { CallbackQuery } from 'telegraf/typings/core/types/typegram'
import { S3Service } from '../../common/services/s3.service'
import { PrismaService } from '../../prisma.service'
import { TelegramProfileService } from '../services/profile.service'
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
	gutDiscount?: number
	region?: string
	fullAddress?: string
	customsUnion?: boolean
	videoUrl?: string
	addingGutDiscount?: boolean
}

@Injectable()
export class TelegramOfferService {
	private offerStates: Map<number, OfferState> = new Map()

	constructor(
		private prisma: PrismaService,
		private s3Service: S3Service,
		private configService: ConfigService,
		private telegramClient: TelegramClient,
		private profileService: TelegramProfileService,
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
				state.gutDiscount = discount
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
				gutDiscount: state.gutDiscount || 0,
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
${offer.gutDiscount > 0 ? `🔻 Скидка на ЖКТ: ${offer.gutDiscount}%\n` : ''}
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
	async handleContactRequest(ctx) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			const callbackData = ctx.callbackQuery.data
			const offerId = callbackData.replace('request_contact_', '')

			// Получаем пользователя
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявление с информацией о владельце
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					user: true,
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Проверяем, не является ли пользователь владельцем объявления
			if (offer.userId === user.id) {
				await ctx.reply('❌ Вы не можете запросить контакты своего объявления')
				return
			}

			// Проверяем, не запрашивал ли пользователь уже контакты
			const existingRequest = await this.prisma.contactRequest.findFirst({
				where: {
					offerId: offer.id,
					requesterId: user.id,
				},
			})

			if (existingRequest) {
				if (existingRequest.status === 'APPROVED') {
					// Если запрос уже одобрен, показываем контакты
					await ctx.reply(
						`📞 <b>Контактная информация:</b>\n\n` +
							`👤 Контактное лицо: ${offer.contactPerson || offer.user.name}\n` +
							`📱 Телефон: ${offer.contactPhone || offer.user.phone || 'Не указан'}\n` +
							`📧 Email: ${offer.user.email}`,
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
											text: '« Назад',
											callback_data: `view_offer_${offer.id}`,
										},
									],
								],
							},
						},
					)
				} else if (existingRequest.status === 'PENDING') {
					await ctx.reply(
						'⏳ Ваш запрос на получение контактов уже отправлен и ожидает рассмотрения.',
						{
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '« Назад',
											callback_data: `view_offer_${offer.id}`,
										},
									],
								],
							},
						},
					)
				} else {
					await ctx.reply(
						'❌ Ваш запрос на получение контактов был отклонен продавцом.',
						{
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '« Назад',
											callback_data: `view_offer_${offer.id}`,
										},
									],
								],
							},
						},
					)
				}
				return
			}

			// Создаем запрос на контакты
			await this.prisma.contactRequest.create({
				data: {
					offer: { connect: { id: offer.id } },
					requester: { connect: { id: user.id } },
					status: 'PENDING',
				},
			})

			// Отправляем уведомление владельцу объявления
			if (offer.user.telegramId) {
				await this.telegramClient.sendMessage(
					offer.user.telegramId,
					`📬 <b>Новый запрос на контакты</b>\n\n` +
						`Пользователь ${user.name || user.email} запрашивает контактные данные для вашего объявления "${offer.title}".\n\n` +
						`Вы можете одобрить или отклонить этот запрос.`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '✅ Одобрить',
										callback_data: `approve_contact_${user.id}_${offer.id}`,
									},
									{
										text: '❌ Отклонить',
										callback_data: `reject_contact_${user.id}_${offer.id}`,
									},
								],
							],
						},
					},
				)
			}

			await ctx.reply(
				'✅ Запрос на получение контактов отправлен.\n\n' +
					'Вы получите уведомление, когда продавец ответит на ваш запрос.',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '« Назад', callback_data: `view_offer_${offer.id}` }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при запросе контактов:', error)
			await ctx.reply('❌ Произошла ошибка при запросе контактов')
		}
	}

	async handleViewOffer(ctx: Context) {
		try {
			// Получаем ID объявления из callback_data
			const callbackQuery = ctx.callbackQuery as CallbackQuery.DataQuery
			let offerId = callbackQuery.data.replace('view_offer_', '')

			// Очищаем ID от возможных лишних символов
			if (offerId.includes('@')) {
				offerId = offerId.split('@')[0]
			}

			console.log(`Просмотр объявления с ID: ${offerId}`)

			// Отправляем сообщение о загрузке
			const loadingMessage = await ctx.reply('⏳ Загрузка объявления...')

			// Получаем объявление из базы данных
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: { images: true, user: true },
			})

			if (!offer) {
				console.log(`Объявление с ID ${offerId} не найдено`)
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					loadingMessage.message_id,
					undefined,
					'❌ Объявление не найдено',
				)
				return
			}

			console.log(`Объявление найдено: ${offer.title}`)

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
				console.log(`Найдено ${offer.images.length} изображений`)

				if (offer.images.length === 1) {
					// Если фотография одна, отправляем ее отдельно
					await ctx.replyWithPhoto(offer.images[0].url)
				} else if (offer.images.length > 1) {
					// Если фотографий несколько, отправляем их как медиагруппу
					const mediaGroup = offer.images.slice(0, 10).map(image => ({
						type: 'photo',
						media: image.url,
					}))

					console.log('Отправка медиагруппы:', mediaGroup)

					try {
						// @ts-ignore - типы Telegraf не полностью поддерживают медиагруппы
						await ctx.replyWithMediaGroup(mediaGroup)
					} catch (mediaError) {
						console.error('Ошибка при отправке медиагруппы:', mediaError)
						// В случае ошибки отправляем фотографии по одной
						for (const image of offer.images) {
							try {
								await ctx.replyWithPhoto(image.url)
							} catch (singlePhotoError) {
								console.error('Ошибка при отправке фото:', singlePhotoError)
							}
						}
					}
				}
			} else {
				console.log('Изображения не найдены')
			}

			// 3. Наконец, отправляем текст объявления с кнопками
			console.log('Отправка текста объявления')
			const offerText = this.formatOfferText(offer)
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
			console.error('Ошибка при просмотре объявления:', error)
			await ctx.reply(`❌ Произошла ошибка: ${error.message}`)
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
${offer.gutDiscount > 0 ? `🔻 Скидка на ЖКТ: ${offer.gutDiscount}%\n` : ''}
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
					},
				},
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Проверяем, является ли пользователь поставщиком
			if (user.role !== 'SUPPLIER') {
				await ctx.reply(
					'❌ Только поставщики могут иметь объявления.\n\n' +
						'Если вы хотите стать поставщиком, пожалуйста, создайте новый аккаунт с соответствующей ролью.',
				)
				return
			}

			if (!user.offers.length) {
				await ctx.reply(
					'📭 У вас пока нет объявлений.\n\n' +
						'Используйте кнопку "Создать объявление" для создания нового объявления.',
					{
						reply_markup: {
							inline_keyboard: [
								[{ text: '📝 Создать объявление', callback_data: 'create_ad' }],
								[{ text: '« Меню', callback_data: 'menu' }],
							],
						},
					},
				)
				return
			}

			// Формируем сообщение со списком объявлений
			let message = `📋 <b>Ваши объявления:</b>\n\n`

			// Создаем кнопки для каждого объявления
			const offerButtons = user.offers.map((offer, index) => [
				Markup.button.callback(
					`${index + 1}. ${offer.title} - ${offer.price}₽ - ${offer.matches.length} заявок`,
					`view_offer_${offer.id}`,
				),
			])

			// Добавляем кнопки навигации
			offerButtons.push([
				Markup.button.callback('📝 Создать новое объявление', 'create_ad'),
				Markup.button.callback('« Меню', 'menu'),
			])

			// Отправляем сообщение с кнопками
			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: { inline_keyboard: offerButtons },
			})
		} catch (error) {
			console.error('Ошибка при отображении списка своих объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке ваших объявлений')
		}
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

	// Добавляем метод handleVideo, который вызывается в telegram.service.ts
	async handleVideo(ctx: Context) {
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

	// Добавляем метод для отображения деталей объявления
	async showOfferDetails(ctx: Context, offerId: string) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявление с изображениями и информацией о пользователе
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					images: true,
					user: true,
					matches: true,
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Формируем сообщение с деталями объявления
			const message = this.formatOfferText(offer)

			// Создаем кнопки для действий с объявлением
			const buttons = []

			// Если пользователь является владельцем объявления
			if (offer.userId === user.id) {
				buttons.push([
					Markup.button.callback('✏️ Редактировать', `edit_offer_${offer.id}`),
					Markup.button.callback('❌ Удалить', `delete_offer_${offer.id}`),
				])

				// Если есть совпадения, добавляем кнопку для просмотра
				if (offer.matches && offer.matches.length > 0) {
					buttons.push([
						Markup.button.callback(
							`👁️ Просмотр заявок (${offer.matches.length})`,
							`view_matches_${offer.id}`,
						),
					])
				}
			}
			// Если пользователь не является владельцем объявления и является покупателем
			else if (user.role === 'BUYER') {
				buttons.push([
					Markup.button.callback(
						'📞 Запросить контакты',
						`request_contacts_${offer.id}`,
					),
					Markup.button.callback(
						'💬 Написать сообщение',
						`send_message_${offer.userId}`,
					),
				])

				buttons.push([
					Markup.button.callback(
						'🛒 Создать заявку',
						`create_request_for_${offer.id}`,
					),
				])
			}

			// Добавляем кнопки навигации
			buttons.push([
				Markup.button.callback('« Назад к объявлениям', 'my_ads'),
				Markup.button.callback('« Меню', 'menu'),
			])

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

				// Если есть видео, отправляем его
				if (offer.videoUrl) {
					await ctx.replyWithVideo({ url: offer.videoUrl })
				}
			} else if (offer.videoUrl) {
				// Если нет изображений, но есть видео, отправляем видео с текстом и кнопками
				await ctx.replyWithVideo(
					{ url: offer.videoUrl },
					{
						caption: message,
						parse_mode: 'HTML',
						reply_markup: { inline_keyboard: buttons },
					},
				)
			} else {
				// Если нет ни изображений, ни видео, отправляем только текст с кнопками
				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: { inline_keyboard: buttons },
				})
			}
		} catch (error) {
			console.error('Ошибка при отображении деталей объявления:', error)
			await ctx.reply('❌ Произошла ошибка при отображении объявления')
		}
	}

	// Добавляем метод для отображения списка объявлений
	async showOffersList(ctx: Context, page: number = 1) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			const pageSize = 5 // Количество объявлений на странице
			const skip = (page - 1) * pageSize

			// Получаем объявления с пагинацией
			const [offers, totalCount] = await Promise.all([
				this.prisma.offer.findMany({
					where: { status: 'ACTIVE' },
					include: {
						images: true,
						user: true,
					},
					orderBy: { createdAt: 'desc' },
					skip,
					take: pageSize,
				}),
				this.prisma.offer.count({
					where: { status: 'ACTIVE' },
				}),
			])

			if (offers.length === 0) {
				await ctx.reply('📭 Пока нет доступных объявлений')
				return
			}

			// Формируем сообщение со списком объявлений
			let message = `📋 <b>Доступные объявления (${page}/${Math.ceil(totalCount / pageSize)}):</b>\n\n`

			// Создаем кнопки для каждого объявления
			const offerButtons = offers.map(offer => [
				Markup.button.callback(
					`${offer.title} - ${offer.price}₽ - ${offer.location}`,
					`view_offer_${offer.id}`,
				),
			])

			// Добавляем кнопки пагинации
			const paginationButtons = []

			if (page > 1) {
				paginationButtons.push(
					Markup.button.callback('⬅️ Предыдущая', `browse_offers_${page - 1}`),
				)
			}

			if (page * pageSize < totalCount) {
				paginationButtons.push(
					Markup.button.callback('➡️ Следующая', `browse_offers_${page + 1}`),
				)
			}

			// Добавляем кнопки навигации
			const navigationButtons = [Markup.button.callback('« Меню', 'menu')]

			// Объединяем все кнопки
			const keyboard = [
				...offerButtons,
				paginationButtons.length > 0 ? paginationButtons : [],
				navigationButtons,
			]

			// Отправляем сообщение с кнопками
			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: { inline_keyboard: keyboard },
			})
		} catch (error) {
			console.error('Ошибка при отображении списка объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявлений')
		}
	}

	// Добавляем метод для проверки возможности создания предложения
	async canCreateOffer(ctx: Context): Promise<boolean> {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Вы должны войти в систему для создания объявления')
				return false
			}

			// Проверяем, является ли пользователь поставщиком
			if (user.role !== 'SUPPLIER') {
				await ctx.reply(
					'❌ Только поставщики могут создавать объявления.\n\n' +
						'Если вы хотите стать поставщиком, пожалуйста, создайте новый аккаунт с соответствующей ролью.',
				)
				return false
			}

			return true
		} catch (error) {
			console.error(
				'Ошибка при проверке возможности создания объявления:',
				error,
			)
			await ctx.reply('❌ Произошла ошибка при проверке ваших прав')
			return false
		}
	}

	// Добавляем метод для начала редактирования объявления
	async startEditOffer(ctx: Context, offerId: string) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявление
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Проверяем, принадлежит ли объявление текущему пользователю
			if (offer.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этому объявлению')
				return
			}

			// Отправляем сообщение с выбором поля для редактирования
			await ctx.reply('✏️ Выберите, что вы хотите изменить:', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '📝 Название',
								callback_data: `edit_offer_title_${offerId}`,
							},
							{
								text: '📋 Описание',
								callback_data: `edit_offer_description_${offerId}`,
							},
						],
						[
							{
								text: '🔢 Количество',
								callback_data: `edit_offer_quantity_${offerId}`,
							},
							{ text: '⚖️ Вес', callback_data: `edit_offer_weight_${offerId}` },
						],
						[
							{
								text: '🌱 Возраст',
								callback_data: `edit_offer_age_${offerId}`,
							},
							{ text: '💰 Цена', callback_data: `edit_offer_price_${offerId}` },
						],
						[
							{
								text: '🌍 Локация',
								callback_data: `edit_offer_location_${offerId}`,
							},
							{
								text: '🐮 Порода',
								callback_data: `edit_offer_breed_${offerId}`,
							},
						],
						[
							{
								text: '« Назад к объявлению',
								callback_data: `view_offer_${offerId}`,
							},
							{ text: '« Меню', callback_data: 'menu' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при начале редактирования объявления:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании объявления')
		}
	}

	// Добавляем метод для подтверждения удаления объявления
	async confirmDeleteOffer(ctx: Context, offerId: string) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявление
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Проверяем, принадлежит ли объявление текущему пользователю
			if (offer.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этому объявлению')
				return
			}

			// Удаляем изображения из S3
			// @ts-ignore
			if (offer.images && offer.images.length > 0) {
				// @ts-ignore

				for (const image of offer.images) {
					if (image.key) {
						await this.s3Service.deleteFile(image.key)
					}
				}
			}

			// Удаляем объявление из базы данных
			await this.prisma.offer.delete({
				where: { id: offerId },
			})

			// Отправляем сообщение об успешном удалении
			await ctx.reply('✅ Объявление успешно удалено', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '📋 Мои объявления', callback_data: 'my_ads' },
							{ text: '« Меню', callback_data: 'menu' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при удалении объявления:', error)
			await ctx.reply('❌ Произошла ошибка при удалении объявления')
		}
	}

	// Добавляем метод для отображения списка совпадений с объявлением
	async showOfferMatches(ctx: Context, offerId: string) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявление с совпадениями
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

			// Проверяем, принадлежит ли объявление текущему пользователю
			if (offer.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этому объявлению')
				return
			}

			if (!offer.matches || offer.matches.length === 0) {
				await ctx.reply('📭 Пока нет заявок на это объявление', {
					reply_markup: {
						inline_keyboard: [
							[
								Markup.button.callback(
									'« Назад к объявлению',
									`view_offer_${offerId}`,
								),
								Markup.button.callback('« Меню', 'menu'),
							],
						],
					},
				})
				return
			}

			// Формируем сообщение со списком совпадений
			let message = `📋 <b>Заявки на объявление "${offer.title}":</b>\n\n`

			// Создаем кнопки для каждого совпадения
			const matchButtons = offer.matches.map((match, index) => {
				const request = match.request
				const buyer = request.user

				return [
					Markup.button.callback(
						`${index + 1}. ${request.title} - ${buyer.name || buyer.email}`,
						`view_match_details_${match.id}`,
					),
				]
			})

			// Добавляем кнопки навигации
			matchButtons.push([
				Markup.button.callback('« Назад к объявлению', `view_offer_${offerId}`),
				Markup.button.callback('« Меню', 'menu'),
			])

			// Отправляем сообщение с кнопками
			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: { inline_keyboard: matchButtons },
			})
		} catch (error) {
			console.error('Ошибка при отображении списка совпадений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке заявок')
		}
	}

	// Добавляем метод для отображения деталей совпадения
	async showMatchDetails(ctx: Context, matchId: string) {
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
				where: { id: parseInt(matchId) },
				include: {
					request: {
						include: {
							user: true,
						},
					},
					offer: {
						include: {
							user: true,
						},
					},
				},
			})

			if (!match) {
				await ctx.reply('❌ Заявка не найдена')
				return
			}

			// Проверяем, принадлежит ли объявление текущему пользователю
			if (match.offer.userId !== user.id) {
				await ctx.reply('❌ У вас нет доступа к этой заявке')
				return
			}

			const request = match.request
			const buyer = request.user

			// Формируем сообщение с деталями заявки
			let message = `🔍 <b>Детали заявки</b>\n\n`
			message += `🐄 <b>Название:</b> ${request.title}\n`
			message += `🔢 <b>Количество:</b> ${request.quantity} голов\n`
			message += `⚖️ <b>Вес:</b> ${request.weight} кг\n`
			message += `🗓️ <b>Возраст:</b> ${request.age} мес.\n`
			message += `💰 <b>Цена:</b> ${request.price} ₽/гол\n`
			message += `📍 <b>Локация:</b> ${request.location}\n\n`

			// Добавляем информацию о покупателе
			message += `👤 <b>Покупатель:</b> ${buyer.name || buyer.email}\n`
			message += `📅 <b>Дата создания:</b> ${request.createdAt.toLocaleDateString()}\n\n`

			// Создаем кнопки для действий с заявкой
			const buttons = [
				[
					Markup.button.callback(
						'💬 Написать сообщение',
						`send_message_${buyer.id}`,
					),
					Markup.button.callback('📞 Контакты', `show_contacts_${buyer.id}`),
				],
				[
					Markup.button.callback(
						'« Назад к заявкам',
						`view_matches_${match.offer.id}`,
					),
					Markup.button.callback('« Меню', 'menu'),
				],
			]

			// Отправляем сообщение с кнопками
			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: { inline_keyboard: buttons },
			})
		} catch (error) {
			console.error('Ошибка при отображении деталей заявки:', error)
			await ctx.reply('❌ Произошла ошибка при отображении деталей заявки')
		}
	}

	// Добавляем метод для запроса контактов
	async requestContacts(ctx: Context, offerId: string) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Получаем объявление с информацией о пользователе
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					user: true,
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Проверяем, не является ли пользователь владельцем объявления
			if (offer.userId === user.id) {
				await ctx.reply('❌ Вы не можете запросить контакты своего объявления')
				return
			}

			// Проверяем, существует ли уже запрос на контакты
			const existingRequest = await this.prisma.contactRequest.findFirst({
				where: {
					offerId,
					requesterId: user.id,
				},
			})

			if (existingRequest) {
				if (existingRequest.status === 'APPROVED') {
					// Если запрос уже одобрен, показываем контакты
					await this.profileService.showContacts(ctx, offer.user.id)
				} else if (existingRequest.status === 'PENDING') {
					await ctx.reply(
						'⏳ Ваш запрос на получение контактов находится на рассмотрении',
					)
				} else {
					await ctx.reply('❌ Ваш запрос на получение контактов был отклонен')
				}
				return
			}

			// Создаем новый запрос на контакты
			await this.prisma.contactRequest.create({
				data: {
					offer: { connect: { id: offerId } },
					requester: { connect: { id: user.id } },
					status: 'PENDING',
				},
			})

			// Отправляем уведомление владельцу объявления
			if (offer.user.telegramId) {
				await this.telegramClient.sendMessage(
					offer.user.telegramId,
					`👋 <b>Новый запрос на контакты</b>\n\n` +
						`Пользователь ${user.name || user.email} запрашивает ваши контактные данные для объявления "${offer.title}".\n\n` +
						`Вы можете одобрить или отклонить этот запрос в личном кабинете.`,
					{
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '✅ Одобрить',
										callback_data: `approve_contact_request_${existingRequest.id}`,
									},
									{
										text: '❌ Отклонить',
										callback_data: `reject_contact_request_${existingRequest.id}`,
									},
								],
							],
						},
					},
				)
			}

			await ctx.reply(
				'✅ Запрос на получение контактов отправлен.\n\n' +
					'Мы уведомим вас, когда владелец объявления ответит на ваш запрос.',
				{
					reply_markup: {
						inline_keyboard: [
							[
								Markup.button.callback(
									'« Назад к объявлению',
									`view_offer_${offerId}`,
								),
								Markup.button.callback('« Меню', 'menu'),
							],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при запросе контактов:', error)
			await ctx.reply('❌ Произошла ошибка при запросе контактов')
		}
	}
}
