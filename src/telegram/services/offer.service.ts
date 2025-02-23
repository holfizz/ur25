// Сервис для работы с объявлениями
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fetch from 'node-fetch'
import { Context, Markup } from 'telegraf'
import { S3Service } from '../../common/services/s3.service'
import { PrismaService } from '../../prisma.service'

interface OfferState {
	title?: string
	description?: string
	price?: number
	quantity?: number
	breed?: string
	age?: number
	weight?: number
	location?: string
	photos?: Array<{ url: string; key: string }>
}

interface UploadedFile {
	buffer: Buffer
	originalname: string
	mimetype: string
	fieldname: string
	encoding: string
	size: number
}

@Injectable()
export class TelegramOfferService {
	private offerStates: Map<number, OfferState> = new Map()

	constructor(
		private prisma: PrismaService,
		private s3Service: S3Service,
		private configService: ConfigService,
	) {}

	// Методы для работы с объявлениями
	async handleCreateOffer(ctx) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Вы должны войти в систему для создания объявления')
			return
		}

		if (user.role !== 'SUPPLIER') {
			await ctx.reply('❌ Только поставщики могут создавать объявления')
			return
		}

		this.offerStates.set(userId, { photos: [] })
		await ctx.reply(
			'📸 Отправьте фотографии КРС\n\n' +
				'❗️ Важно: отправьте все фотографии одним сообщением (до 10 штук)\n' +
				'✅ Рекомендуется:\n' +
				'• Фото животных в полный рост\n' +
				'• При хорошем освещении\n' +
				'• С разных ракурсов',
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('« Отмена', 'menu')],
				]),
			},
		)
	}

	async handleOfferState(ctx, userId: number, text: string): Promise<boolean> {
		const offerState = this.offerStates.get(userId)
		if (!offerState) return false

		if (!offerState.title && offerState.photos?.length > 0) {
			offerState.title = text
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите описание объявления:', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.description && offerState.title) {
			offerState.description = text
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите цену за голову (в рублях):', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.price && offerState.description) {
			const price = parseFloat(text)
			if (isNaN(price) || price <= 0) {
				await ctx.reply('❌ Введите корректную цену', {
					reply_markup: Markup.inlineKeyboard([
						[Markup.button.callback('« Назад', 'create_offer')],
					]),
				})
				return true
			}
			offerState.price = price
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите количество голов:', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.quantity && offerState.price) {
			const quantity = parseInt(text)
			if (isNaN(quantity) || quantity <= 0) {
				await ctx.reply('❌ Введите корректное количество', {
					reply_markup: Markup.inlineKeyboard([
						[Markup.button.callback('« Назад', 'create_offer')],
					]),
				})
				return true
			}
			offerState.quantity = quantity
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите породу КРС:', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.breed && offerState.quantity) {
			offerState.breed = text
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите возраст КРС в месяцах:', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.age && offerState.breed) {
			const age = parseInt(text)
			if (isNaN(age) || age <= 0) {
				await ctx.reply('❌ Введите корректный возраст', {
					reply_markup: Markup.inlineKeyboard([
						[Markup.button.callback('« Назад', 'create_offer')],
					]),
				})
				return true
			}
			offerState.age = age
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите вес КРС в кг:', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.weight && offerState.age) {
			const weight = parseFloat(text)
			if (isNaN(weight) || weight <= 0) {
				await ctx.reply('❌ Введите корректный вес', {
					reply_markup: Markup.inlineKeyboard([
						[Markup.button.callback('« Назад', 'create_offer')],
					]),
				})
				return true
			}
			offerState.weight = weight
			this.offerStates.set(userId, offerState)
			await ctx.reply('Введите местоположение КРС:', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад', 'create_offer')],
				]),
			})
			return true
		}

		if (!offerState.location && offerState.weight) {
			offerState.location = text

			// Создаем объявление
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			const offer = await this.prisma.offer.create({
				data: {
					title: offerState.title,
					description: offerState.description,
					price: offerState.price,
					quantity: offerState.quantity,
					breed: offerState.breed,
					age: offerState.age,
					weight: offerState.weight,
					location: offerState.location,
					user: {
						connect: {
							id: user.id,
						},
					},
					images: {
						create: offerState.photos.map(photo => ({
							url: photo.url,
							key: photo.key,
						})),
					},
				},
				include: {
					images: true,
				},
			})

			this.offerStates.delete(userId)

			await ctx.reply(
				`✅ Объявление успешно создано!

📝 ${offer.title}
💰 Цена: ${offer.price} руб/голову
🔢 Количество: ${offer.quantity} голов
🐮 Порода: ${offer.breed}
🌱 Возраст: ${offer.age} мес.
⚖️ Вес: ${offer.weight} кг
📍 Локация: ${offer.location}

${offer.description}

Фотографии:
${offer.images.map(img => img.url).join('\n')}`,
				{ parse_mode: 'HTML' },
			)
			return true
		}

		return false
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

	async handleBrowseOffers(ctx) {
		console.log('handleBrowseOffers вызван')
		const userId = ctx.from.id

		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})
		console.log('Пользователь:', user)

		const offers = await this.prisma.offer.findMany({
			where: {
				status: 'ACTIVE',
			},
			include: {
				user: true,
				images: true,
			},
			orderBy: {
				createdAt: 'desc',
			},
			take: 10,
		})
		console.log('Найденные объявления:', offers)

		if (!offers.length) {
			console.log('Нет активных объявлений')
			await ctx.reply('📭 Пока нет активных объявлений', {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'menu')]]),
			})
			return
		}

		const buttons = offers.map(offer => {
			const buttonText = `${
				offer.title || offer.breed
			} - ${offer.price.toLocaleString('ru-RU')}₽ (${offer.user.name})`
			const callbackData = `view_offer_${offer.id}`
			console.log('Создана кнопка:', { buttonText, callbackData })
			return [Markup.button.callback(buttonText, callbackData)]
		})

		buttons.push([Markup.button.callback('« Меню', 'menu')])
		console.log('Финальные кнопки:', buttons)

		await ctx.reply(
			`🐮 <b>Доступный КРС:</b>\n\nВыберите объявление для просмотра деталей:`,
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			},
		)
	}

	async handleViewOffer(ctx) {
		console.log('handleViewOffer вызван')
		console.log('Callback query:', ctx.callbackQuery)

		const offerId = ctx.callbackQuery.data.split('_')[2]
		console.log('ID объявления:', offerId)

		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})
		console.log('Пользователь:', user)

		try {
			const offer = await this.prisma.offer.findUnique({
				where: {
					id: offerId,
				},
				include: {
					user: true,
					images: true,
				},
			})
			console.log('Найденное объявление:', offer)

			if (!offer) {
				console.log('Объявление не найдено')
				await ctx.reply('❌ Объявление не найдено или было удалено', {
					reply_markup: Markup.inlineKeyboard([
						[Markup.button.callback('« Назад к списку', 'browse_offers')],
					]),
				})
				return
			}

			// Отправляем фотографии
			if (offer.images && offer.images.length > 0) {
				console.log('Отправка фотографий:', offer.images)
				try {
					const mediaGroup = offer.images.map(image => ({
						type: 'photo',
						media: image.url,
						caption:
							image === offer.images[0] ? `${offer.title || 'КРС'}` : undefined,
					}))
					await ctx.replyWithMediaGroup(mediaGroup)
				} catch (error) {
					console.error('Ошибка при отправке фотографий:', error)
					await ctx.reply('⚠️ Не удалось загрузить фотографии')
				}
			}

			const offerDetails = `
📦 <b>${offer.title || 'КРС'}</b>

🐮 Порода: ${offer.breed}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${offer.price.toLocaleString('ru-RU')} ₽/гол
📍 Регион: ${offer.location.split(' ')[0]}

📝 Описание:
${offer.description || 'Описание отсутствует'}`

			const buttons = [
				[
					Markup.button.callback(
						'💬 Запросить подробности',
						`request_info_${offer.id}`,
					),
				],
				[
					Markup.button.callback(
						'🤝 Заявить о намерении купить',
						`express_interest_${offer.id}`,
					),
				],
				[Markup.button.callback('« Назад к списку', 'browse_offers')],
				[Markup.button.callback('« Меню', 'menu')],
			]

			await ctx.reply(offerDetails, {
				parse_mode: 'HTML',
				...Markup.inlineKeyboard(buttons),
			})
		} catch (error) {
			console.error('Ошибка при получении объявления:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявления', {
				reply_markup: Markup.inlineKeyboard([
					[Markup.button.callback('« Назад к списку', 'browse_offers')],
				]),
			})
		}
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
}
