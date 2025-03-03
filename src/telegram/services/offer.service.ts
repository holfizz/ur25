// Сервис для работы с объявлениями
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CattlePurpose, CattleType, PriceType } from '@prisma/client'
import fetch from 'node-fetch'
import { Context, Markup } from 'telegraf'
import { S3Service } from '../../common/services/s3.service'
import { PrismaService } from '../../prisma.service'
import { CozeService } from '../../services/coze.service'
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
	gktDiscount?: number
	region?: string
	fullAddress?: string
	customsUnion?: boolean
	videoUrl?: string
	addingGutDiscount?: boolean
	aiOfferId?: string
	calculateOfferId?: string
	userId?: string
	address?: string
	offerId?: string // Добавляем свойство offerId
	contactRequestId?: string // Добавляем поле для ID запроса контактов
	commentText?: string // Добавляем поле для текста комментария
}

interface OfferListResponse {
	topOffers: string[] // Массив отформатированных сообщений
	hasMore: boolean
	currentPage: number
	totalPages: number
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
		private cozeService: CozeService,
	) {}

	// Оставляем только одну реализацию каждого метода
	public getOfferState(userId: number): OfferState | undefined {
		return this.offerStates.get(userId)
	}

	public updateOfferState(userId: number, state: OfferState): void {
		this.offerStates.set(userId, state)
	}

	async handleCreateOffer(ctx: Context) {
		const telegramId = ctx.from.id // Получаем как number

		// Получаем пользователя из базы данных
		const user = await this.prisma.user.findUnique({
			where: { telegramId: telegramId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь.')
			return
		}

		if (!user?.mercuryNumber) {
			// Если номера нет, запрашиваем его
			this.offerStates.set(telegramId, {
				photos: [],
				videos: [],
				inputType: 'mercury_number',
			})
			await ctx.reply(
				'🔢 Для создания объявления необходимо указать номер в системе "Меркурий".\n\nПожалуйста, введите ваш номер:',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '⏩ Пропустить', callback_data: 'skip_mercury_offer' }],
							[{ text: '« Отмена', callback_data: 'menu' }],
						],
					},
				},
			)
			return
		}

		// Если номер есть или пользователь пропустил, начинаем создание объявления
		this.offerStates.set(telegramId, {
			photos: [],
			videos: [],
		})
		await ctx.reply(
			'📸 Загрузите фотографии или видео КРС (до 5 файлов)\n\n' +
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
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			console.log('Обработка ввода:', state.inputType, text)

			switch (state.inputType) {
				case 'title':
					state.title = text
					state.inputType = 'description'
					this.updateOfferState(userId, state)
					await ctx.reply('📝 Введите описание объявления:')
					break

				case 'description':
					state.description = text
					state.inputType = 'cattle_type'
					this.offerStates.set(userId, state)
					await ctx.reply('🐮 Выберите тип КРС:', {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: '🐄 Телята', callback_data: 'cattle_type_CALVES' },
									{
										text: '🐂 Бычки',
										callback_data: 'cattle_type_BULL_CALVES',
									},
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
					this.updateOfferState(userId, state)
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
					this.updateOfferState(userId, state)
					await ctx.reply('🔢 Введите количество голов:')
					break

				case 'quantity':
					const quantityValue = parseInt(text)
					if (isNaN(quantityValue) || quantityValue <= 0) {
						await ctx.reply(
							'❌ Введите корректное количество (целое число больше 0)',
						)
						return
					}
					state.quantity = quantityValue
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
					const discountValue = parseFloat(text)
					if (
						isNaN(discountValue) ||
						discountValue < 0 ||
						discountValue > 100
					) {
						await ctx.reply('❌ Введите корректную скидку (число от 0 до 100)')
						return
					}
					state.gktDiscount = discountValue
					state.inputType = 'region'
					this.offerStates.set(userId, state)
					await ctx.reply('📍 Введите регион:')
					break

				case 'region':
					state.region = text
					state.inputType = 'full_address'
					this.offerStates.set(userId, state)

					await ctx.reply('📍 Введите полный адрес:')
					break

				case 'full_address':
					state.fullAddress = text
					await this.createOffer(ctx, state)
					break

				case 'ai_question':
					try {
						if (!state.offerId) {
							await ctx.reply('❌ Ошибка: ID объявления не найден')
							return
						}

						// Получаем объявление из базы данных
						const offer = await this.prisma.offer.findUnique({
							where: { id: state.offerId },
							select: {
								title: true,
								description: true,
								cattleType: true,
								breed: true,
								purpose: true,
								priceType: true,
								pricePerHead: true,
								pricePerKg: true,
								quantity: true,
								weight: true,
								age: true,
								region: true,
								gktDiscount: true,
								customsUnion: true,
								status: true,
							},
						})

						if (!offer) {
							await ctx.reply('❌ Объявление не найдено или было удалено')
							return
						}

						await ctx.reply('🤖 Обрабатываю ваш вопрос...')

						try {
							// Формируем контекст только с безопасными данными
							const context = `Объявление КРС:
							Название: ${offer.title}
							Описание: ${offer.description || 'Не указано'}
							Тип КРС: ${offer.cattleType}
							Порода: ${offer.breed || 'Не указана'}
							Назначение: ${offer.purpose}
							Количество: ${offer.quantity} голов
							Вес: ${offer.weight} кг
							Возраст: ${offer.age} мес.
							Цена: ${
								offer.priceType === 'PER_HEAD'
									? `${offer.pricePerHead} ₽/гол`
									: `${offer.pricePerKg} ₽/кг`
							}
							Регион: ${offer.region || 'Не указан'}
							${offer.gktDiscount > 0 ? `Скидка ЖКТ: ${offer.gktDiscount}%` : ''}
							${offer.customsUnion ? 'Для стран Таможенного союза' : ''}`

							const answer = await this.cozeService.generateResponse(
								context,
								text,
							)

							await ctx.reply(`🤖 ${answer}`, {
								reply_markup: {
									inline_keyboard: [
										[
											{
												text: '« Назад к объявлению',
												callback_data: `view_offer_${state.offerId}`,
											},
										],
									],
								},
							})
						} catch (aiError) {
							console.error('Ошибка AI:', aiError)
							await ctx.reply(
								'❌ Не удалось получить ответ от AI. Попробуйте другой вопрос.',
							)
						}

						// Не удаляем состояние, а обновляем его для следующего вопроса
						state.inputType = 'ai_question'
						this.offerStates.set(userId, state)
					} catch (error) {
						console.error('Ошибка при обработке AI запроса:', error)
						await ctx.reply('❌ Произошла ошибка при обработке запроса')
					}
					break

				case 'calculate_quantity':
					try {
						const calcQuantity = parseFloat(text)
						if (isNaN(calcQuantity) || calcQuantity <= 0) {
							await ctx.reply(
								'❌ Введите корректное количество (число больше 0)',
							)
							return
						}

						if (!state.offerId) {
							await ctx.reply('❌ Ошибка: ID объявления не найден')
							return
						}

						state.quantity = calcQuantity

						// Получаем объявление для расчета
						const calcOffer = await this.prisma.offer.findUnique({
							where: { id: state.offerId },
						})

						if (!calcOffer) {
							await ctx.reply('❌ Объявление не найдено или было удалено')
							return
						}

						// Проверяем доступное количество
						const isExceedingQuantity = calcQuantity > calcOffer.quantity

						// Рассчитываем базовую стоимость для доступного количества
						const actualQuantity = isExceedingQuantity
							? calcOffer.quantity
							: calcQuantity
						let basePrice = 0
						if (calcOffer.priceType === 'PER_HEAD') {
							basePrice = calcOffer.pricePerHead * actualQuantity
						} else {
							basePrice = calcOffer.pricePerKg * actualQuantity
						}

						// Применяем скидку ЖКТ, если есть
						let finalPrice = basePrice
						if (calcOffer.gktDiscount > 0) {
							const discount = (basePrice * calcOffer.gktDiscount) / 100
							finalPrice = basePrice - discount
						}

						// Форматируем сообщение с результатом
						let message = `💰 <b>Расчет стоимости:</b>\n\n`

						if (isExceedingQuantity) {
							message +=
								`⚠️ <b>Внимание:</b> В наличии только ${calcOffer.quantity} голов.\n` +
								`Расчет будет произведен для доступного количества.\n` +
								`Свяжитесь с поставщиком, возможно у него есть дополнительные головы.\n\n`
						}

						message +=
							`Количество: ${actualQuantity} ${calcOffer.priceType === 'PER_HEAD' ? 'голов' : 'кг'}\n` +
							`Цена за ${calcOffer.priceType === 'PER_HEAD' ? 'голову' : 'кг'}: ${calcOffer.priceType === 'PER_HEAD' ? calcOffer.pricePerHead : calcOffer.pricePerKg} ₽\n` +
							`Базовая стоимость: ${basePrice.toLocaleString('ru-RU')} ₽\n` +
							(calcOffer.gktDiscount > 0
								? `Скидка ЖКТ (${calcOffer.gktDiscount}%): ${(basePrice - finalPrice).toLocaleString('ru-RU')} ₽\n`
								: '') +
							`\n<b>Итоговая стоимость: ${finalPrice.toLocaleString('ru-RU')} ₽</b>`

						const buttons = [
							[
								{
									text: '📞 Запросить контакты',
									callback_data: `request_contacts_${state.offerId}`,
								},
							],
							[
								{
									text: '« Назад к объявлению',
									callback_data: `view_offer_${state.offerId}`,
								},
							],
						]

						await ctx.reply(message, {
							parse_mode: 'HTML',
							reply_markup: {
								inline_keyboard: buttons,
							},
						})

						// Очищаем состояние
						this.offerStates.delete(userId)
					} catch (error) {
						console.error('Ошибка при расчете стоимости:', error)
						await ctx.reply('❌ Произошла ошибка при расчете стоимости')
					}
					break

				case 'contact_request_comment':
					// Получаем текст из сообщения (отсутствует в текущем коде)
					const commentText = text // Используем параметр функции

					// Получаем информацию о пользователе
					const buyerUser = await this.prisma.user.findUnique({
						where: { telegramId: userId.toString() },
					})

					if (!buyerUser) {
						await ctx.reply('❌ Пожалуйста, сначала авторизуйтесь')
						return
					}

					const contactOffer = await this.prisma.offer.findUnique({
						where: { id: state.offerId },
						include: {
							user: true,
						},
					})

					if (!contactOffer) {
						await ctx.reply('❌ Объявление не найдено или было удалено')
						return
					}

					// Создаем запрос на контакты в базе данных
					const contactRequest = await this.prisma.contactRequest.create({
						data: {
							status: 'PENDING',
							comment: commentText, // Используем сохраненный комментарий
							offer: { connect: { id: contactOffer.id } },
							buyer: { connect: { id: buyerUser.id } },
							seller: { connect: { id: contactOffer.user.id } },
						},
					})

					// Отправляем уведомление администраторам
					const adminUsers = await this.prisma.user.findMany({
						where: { role: 'ADMIN' },
					})

					for (const admin of adminUsers) {
						if (admin.telegramId) {
							try {
								await this.telegramClient.sendMessage(
									admin.telegramId,
									`📩 <b>Новый запрос на контакты!</b>
									
Покупатель: ${buyerUser.name} (${buyerUser.phone || 'телефон не указан'})
Объявление: ${contactOffer.title}
Комментарий: ${text || 'Не указан'}

<b>Действия</b>`,
									{
										parse_mode: 'HTML',
										reply_markup: {
											inline_keyboard: [
												[
													{
														text: '✅ Одобрить',
														callback_data: `approve_contact_${contactRequest.id}`,
													},
													{
														text: '❌ Отклонить',
														callback_data: `reject_contact_${contactRequest.id}`,
													},
												],
												[
													{
														text: '👁️ Просмотреть объявление',
														callback_data: `admin_view_offer_${contactOffer.id}`,
													},
												],
											],
										},
									},
								)
							} catch (error) {
								console.error(
									`Ошибка при отправке уведомления администратору ${admin.telegramId}:`,
									error,
								)
							}
						}
					}

					// Отправляем подтверждение пользователю
					await ctx.reply(
						'📤 Ваш запрос на получение контактов отправлен! После одобрения модератором вы получите контактные данные продавца.',
						{
							reply_markup: {
								inline_keyboard: [
									[
										{
											text: '« Назад к объявлению',
											callback_data: `view_offer_${state.offerId}`,
										},
									],
								],
							},
						},
					)

					// Очищаем состояние
					this.offerStates.delete(userId)
					break

				case 'waiting_for_comment':
					try {
						if (!state.contactRequestId) {
							await ctx.reply('❌ Ошибка: ID запроса не найден')
							return
						}

						// Обновляем существующий запрос, добавляя комментарий
						await this.prisma.contactRequest.update({
							where: { id: state.contactRequestId },
							data: {
								comment: text, // Используем существующее поле или добавьте его в модель
								status: 'PENDING',
							},
						})

						// Уведомляем администраторов о новом комментарии
						const admins = await this.prisma.user.findMany({
							where: { role: 'ADMIN' },
						})

						for (const admin of admins) {
							if (admin.telegramId) {
								await this.telegramClient.sendMessage(
									admin.telegramId,
									`📝 Новый комментарий к запросу контактов #${state.contactRequestId}\n\n` +
										`Текст: ${text}\n\n` +
										`Действия:`,
									{
										reply_markup: {
											inline_keyboard: [
												[
													{
														text: '✅ Одобрить',
														callback_data: `approve_comment_${state.contactRequestId}`,
													},
													{
														text: '❌ Отклонить',
														callback_data: `reject_comment_${state.contactRequestId}`,
													},
												],
											],
										},
									},
								)
							}
						}

						await ctx.reply(
							'✅ Ваш комментарий отправлен на модерацию. ' +
								'Вы получите уведомление после рассмотрения.',
							{
								reply_markup: {
									inline_keyboard: [
										[{ text: '« В главное меню', callback_data: 'menu' }],
									],
								},
							},
						)

						// Очищаем состояние
						this.offerStates.delete(userId)
					} catch (error) {
						console.error('Ошибка при сохранении комментария:', error)
						await ctx.reply('❌ Произошла ошибка при сохранении комментария')
					}
					break
			}
		} catch (error) {
			console.error('Ошибка при обработке ввода:', error)
			await ctx.reply('❌ Произошла ошибка при обработке ввода')
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

			// Проверяем и приводим значения к правильным enum
			const validCattleTypes = [
				'CALVES',
				'BULL_CALVES',
				'HEIFERS',
				'BREEDING_HEIFERS',
				'BULLS',
				'COWS',
			]
			if (!state.cattleType || !validCattleTypes.includes(state.cattleType)) {
				state.cattleType = 'CALVES'
			}

			// Определяем тип цены на основе введенных данных
			let priceType = 'PER_HEAD'
			if (state.pricePerKg && state.pricePerKg > 0) {
				priceType = 'PER_KG'
			} else if (state.pricePerHead && state.pricePerHead > 0) {
				priceType = 'PER_HEAD'
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
				status: 'PENDING' as const,
				mercuryNumber: state.mercuryNumber,
				contactPerson: state.contactPerson,
				contactPhone: state.contactPhone,
				cattleType: state.cattleType as CattleType,
				purpose: state.purpose || 'COMMERCIAL',
				priceType: priceType as PriceType, // Используем определенный выше тип цены
				pricePerKg: state.pricePerKg || 0,
				pricePerHead: state.pricePerHead || 0,
				gktDiscount: state.gktDiscount || 0,
				region: state.region || state.location,
				location: state.region || '',
				fullAddress: state.fullAddress || state.region,
				customsUnion: state.customsUnion || false,
				videoUrl:
					state.videos && state.videos.length > 0 ? state.videos[0].url : '',
				// Устанавливаем основную цену в зависимости от типа
				price:
					priceType === 'PER_HEAD'
						? state.pricePerHead || 0
						: state.pricePerKg || 0,
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
			data: { status: 'APPROVED' as const },
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
			data: { status: 'REJECTED' as const },
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

			this.updateOfferState(userId, offerState)

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

	async handleBrowseOffers(ctx: Context, page = 1) {
		try {
			const offers = await this.prisma.offer.findMany({
				where: { status: 'APPROVED' },
				orderBy: [{ user: { status: 'desc' } }, { createdAt: 'desc' }],
				skip: (page - 1) * 10,
				take: 10,
				include: {
					user: true,
				},
			})

			if (!offers || offers.length === 0) {
				await ctx.reply('🔍 Объявления не найдены')
				return
			}

			const totalOffers = await this.prisma.offer.count({
				where: { status: 'APPROVED' },
			})

			const totalPages = Math.ceil(totalOffers / 10)

			// Формируем кнопки для каждого объявления
			const keyboard = [
				...offers.map(offer => {
					const statusIcon = {
						SUPER_PREMIUM: '💎',
						PREMIUM: '⭐️',
						REGULAR: '',
					}[offer.user?.status || 'REGULAR']

					const cattleType =
						{
							CALVES: '🐮 Телята',
							BULL_CALVES: '🐂 Бычки',
							HEIFERS: '🐄 Телки',
							BREEDING_HEIFERS: '🐄 Нетели',
							BULLS: '🐂 Быки',
							COWS: '🐄 Коровы',
						}[offer.cattleType] || offer.cattleType

					const price =
						offer.priceType === 'PER_HEAD'
							? `${offer.pricePerHead?.toLocaleString()} ₽/гол`
							: `${offer.pricePerKg?.toLocaleString()} ₽/кг`

					return [
						{
							text: `${statusIcon} ${cattleType} ${offer.breed || ''} - ${price}`,
							callback_data: `view_offer_${offer.id}`,
						},
					]
				}),
				[
					// Кнопки навигации
					...(page > 1
						? [
								{
									text: '⬅️ Назад',
									callback_data: `browse_offers_${page - 1}`,
								},
							]
						: []),
					...(page < totalPages
						? [
								{
									text: 'Вперед ➡️',
									callback_data: `browse_offers_${page + 1}`,
								},
							]
						: []),
				],
				[{ text: '« Меню', callback_data: 'menu' }],
			]

			const message = `📋 Список объявлений (страница ${page} из ${totalPages}):`

			// Если это callback query, обновляем существующее сообщение
			if ('callback_query' in ctx.update) {
				await ctx.editMessageText(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: keyboard,
					},
				})
			} else {
				// Иначе отправляем новое сообщение
				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: keyboard,
					},
				})
			}
		} catch (error) {
			console.error('Ошибка при просмотре объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке объявлений')
		}
	}

	// Метод для получения только региона
	private getRegionOnly(location: string): string {
		// Берем только первое слово из локации (предполагается, что это регион)
		return location.split(' ')[0]
	}

	// Обработчик запроса контактов
	async handleContactRequest(ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id
			//@ts-ignore
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

			// Получаем существующие запросы на контакты
			const existingRequests = await this.prisma.contactRequest.findMany({
				where: {
					offerId: offerId,
					buyerId: user.id, // Заменили requesterId на buyerId
					status: 'PENDING',
				},
			})

			if (existingRequests.length > 0) {
				if (existingRequests[0].status === 'APPROVED') {
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
				} else if (existingRequests[0].status === 'PENDING') {
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
			const contactRequest = await this.prisma.contactRequest.create({
				data: {
					status: 'PENDING',
					offer: { connect: { id: offer.id } },
					buyer: { connect: { id: user.id } }, // Заменили requester на buyer
					seller: { connect: { id: offer.user.id } }, // Добавили связь с продавцом
				},
			})

			// Отправляем уведомление администратору
			const adminUsers = await this.prisma.user.findMany({
				where: { role: 'ADMIN' },
			})

			for (const admin of adminUsers) {
				if (admin.telegramId) {
					try {
						await this.telegramClient.sendMessage(
							admin.telegramId,
							`📩 <b>Новый запрос на контакты!</b>
							
Покупатель: ${user.name} (${user.phone || 'телефон не указан'})
Объявление: ${offer.title}

<b>Действия</b>`,
							{
								parse_mode: 'HTML',
								reply_markup: {
									inline_keyboard: [
										[
											{
												text: '✅ Одобрить',
												callback_data: `approve_contact_${contactRequest.id}`,
											},
											{
												text: '❌ Отклонить',
												callback_data: `reject_contact_${contactRequest.id}`,
											},
										],
										[
											{
												text: '👁️ Просмотреть объявление',
												callback_data: `admin_view_offer_${offer.id}`,
											},
										],
									],
								},
							},
						)
					} catch (error) {
						console.error(
							`Ошибка при отправке уведомления администратору ${admin.telegramId}:`,
							error,
						)
					}
				}
			}

			// Отправляем сообщение пользователю
			await ctx.reply(
				'📤 Ваш запрос на получение контактов отправлен! После одобрения модератором вы получите контактные данные продавца.',
				{
					reply_markup: {
						inline_keyboard: [
							[
								Markup.button.callback(
									'« Назад к объявлению',
									`view_offer_${offer.id}`,
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

	async handleViewOffer(ctx: Context, offerId: string) {
		try {
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					user: true,
					images: true,
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			const statusIcon = {
				SUPER_PREMIUM: '💎',
				PREMIUM: '⭐️',
				REGULAR: '',
			}[offer.offerStatus || 'REGULAR']

			const message = `
🟢 Активно

${statusIcon} <b>${offer.title}</b>

${offer.cattleType} - ${offer.breed}
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${
				offer.priceType === 'PER_HEAD'
					? `${offer.pricePerHead?.toLocaleString()} ₽/гол`
					: `${offer.pricePerKg?.toLocaleString()} ₽/кг`
			}
📍 Регион: ${offer.region || 'Не указан'}

📝 Описание: ${offer.description}
${offer.gktDiscount ? `\n🎯 Скидка ЖКТ: ${offer.gktDiscount}%` : ''}
${offer.customsUnion ? '\n🌍 Для стран ТС' : ''}

📅 Создано: ${new Date(offer.createdAt).toLocaleDateString('ru-RU')}`

			// Если есть изображения, отправляем первое изображение с текстом
			if (offer.images && offer.images.length > 0) {
				// Проверяем, что URL изображения действительный
				const imageUrl = offer.images[0].url
				if (!imageUrl.startsWith('http')) {
					// Если URL недействительный, отправляем только текст
					await ctx.reply(message, {
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '📞 Запросить контакты',
										callback_data: `request_contacts_${offer.id}`,
									},
								],
								[{ text: '« Назад', callback_data: 'browse_offers_1' }],
							],
						},
					})
				} else {
					await ctx.replyWithPhoto(imageUrl, {
						caption: message,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '📞 Запросить контакты',
										callback_data: `request_contacts_${offer.id}`,
									},
								],
								[{ text: '« Назад', callback_data: 'browse_offers_1' }],
							],
						},
					})
				}
			} else {
				// Если изображений нет, отправляем только текст
				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '📞 Запросить контакты',
									callback_data: `request_contacts_${offer.id}`,
								},
							],
							[{ text: '« Назад', callback_data: 'browse_offers_1' }],
						],
					},
				})
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

			for (const offer of user.offers) {
				const statusBadge =
					offer.status === 'PENDING' ? '⏳ На модерации\n' : ''

				const message = `
${statusBadge}📋 ${offer.title}

🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
🌱 Возраст: ${offer.age} мес.
💰 Цена: ${
					offer.priceType === 'PER_HEAD'
						? offer.pricePerHead > 0
							? `${offer.pricePerHead} ₽/гол`
							: `${offer.pricePerKg} ₽/кг`
						: `${offer.pricePerKg} ₽/кг`
				}
📍 Регион: ${offer.region}
📊 Заявок: ${offer.matches.length}`

				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '👁 Просмотреть',
									callback_data: `view_offer_${offer.id}`,
								},
							],
							[
								{
									text: '✏️ Редактировать',
									callback_data: `edit_offer_${offer.id}`,
								},
								{
									text: '❌ Удалить',
									callback_data: `delete_offer_${offer.id}`,
								},
							],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				})
			}
		} catch (error) {
			console.error('Ошибка при отображении объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при получении списка объявлений')
		}
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
					where: { status: 'APPROVED' as const },
					include: {
						images: true,
						user: true,
					},
					orderBy: { createdAt: 'desc' },
					skip,
					take: pageSize,
				}),
				this.prisma.offer.count({
					where: { status: 'APPROVED' as const },
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
					buyerId: user.id, // Заменили requesterId на buyerId
					status: 'PENDING',
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
					status: 'PENDING',
					offer: { connect: { id: offerId } },
					buyer: { connect: { id: user.id } }, // Заменили requester на buyer
					seller: { connect: { id: offer.user.id } }, // Добавили связь с продавцом
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

	// Метод для обработки запроса к ИИ
	async handleAskAI(ctx: Context, offerId: string) {
		try {
			await ctx.answerCbQuery()
			const userId = ctx.from.id

			// Сохраняем состояние для обработки вопроса к AI
			const aiState = {
				offerId, // Сохраняем ID объявления
				inputType: 'ai_question',
				photos: [],
				videos: [],
			}
			this.updateOfferState(userId, aiState)

			await ctx.reply(
				'🤖 Задайте вопрос об этом объявлении, и AI ответит на него:',
			)
		} catch (error) {
			console.error('Ошибка при запросе к AI:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	// Метод для обработки вопроса к ИИ
	async handleAIQuestion(ctx: Context, text: string) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state || !state.aiOfferId) {
				await ctx.reply('❌ Сессия истекла. Пожалуйста, начните заново.')
				return
			}

			const offerId = state.aiOfferId

			// Получаем объявление со всеми связанными данными
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					images: true,
					user: true,
				},
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				this.offerStates.delete(userId)
				return
			}

			// Отправляем сообщение о загрузке
			const loadingMessage = await ctx.reply('🤖 ИИ обрабатывает ваш вопрос...')

			// Формируем подробный контекст для ИИ на основе данных объявления
			const aiContext = `
Подробная информация об объявлении КРС:
- Название: ${offer.title}
- Тип КРС: ${this.getCattleTypeText(offer.cattleType)}
- Порода: ${offer.breed}
- Назначение: ${offer.purpose === 'BREEDING' ? 'Племенной' : 'Товарный'}
- Количество: ${offer.quantity} голов
- Вес одной головы: ${offer.weight} кг
- Возраст: ${offer.age} месяцев
- Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/гол` : `${offer.pricePerKg} ₽/кг`}
- Регион: ${offer.region}
- Описание: ${offer.description || 'Отсутствует'}
${offer.gktDiscount > 0 ? `- Скидка на ЖКТ: ${offer.gktDiscount}%` : ''}
${offer.customsUnion ? '- Ввоз из стран Таможенного союза: Да' : '- Ввоз из стран Таможенного союза: Нет'}`

			// Отправляем запрос к Coze
			const aiResponse = await this.cozeService.generateResponse(
				aiContext,
				text,
			)

			// Удаляем сообщение о загрузке
			await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id)

			// Отправляем ответ ИИ
			await ctx.reply(`🤖 <b>Ответ ИИ:</b>\n\n${aiResponse}`, {
				parse_mode: 'HTML',
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
			})

			// Не удаляем состояние, а обновляем его для следующего вопроса
			state.inputType = 'ai_question'
			this.offerStates.set(userId, state)
		} catch (error) {
			console.error('Ошибка при обработке вопроса к ИИ:', error)
			await ctx.reply('❌ Произошла ошибка при обработке вопроса')
		}
	}

	// Метод для расчета стоимости
	async handleCalculatePrice(ctx: Context, offerId: string) {
		try {
			// Получаем объявление из базы данных
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				return
			}

			// Сохраняем состояние пользователя для ожидания ввода количества
			const userId = ctx.from.id
			this.offerStates.set(userId, {
				photos: [],
				videos: [],
				inputType: 'calculate_quantity',
				offerId: offerId, // Сохраняем offerId в состоянии
			})

			// Отправляем сообщение с просьбой ввести количество
			await ctx.reply(
				`💰 <b>Расчет стоимости</b>\n\n` +
					`В наличии: ${offer.quantity} голов\n` +
					`Вес одной головы: ${offer.weight} кг\n\n` +
					`Введите количество голов, которое вы хотите приобрести (от 1 до ${offer.quantity}):`,
				{
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '« Отмена',
									callback_data: `view_offer_${offerId}`,
								},
							],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при расчете стоимости:', error)
			await ctx.reply('❌ Произошла ошибка при расчете стоимости')
		}
	}

	// Метод для обработки ввода количества
	async handleCalculateQuantity(ctx: Context, text: string) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state || !state.calculateOfferId) {
				await ctx.reply('❌ Сессия истекла. Пожалуйста, начните заново.')
				return
			}

			const offerId = state.calculateOfferId

			// Получаем объявление
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
			})

			if (!offer) {
				await ctx.reply('❌ Объявление не найдено')
				this.offerStates.delete(userId)
				return
			}

			// Проверяем введенное количество
			const quantity = parseInt(text)
			if (isNaN(quantity) || quantity <= 0) {
				await ctx.reply('❌ Пожалуйста, введите корректное число.')
				return
			}

			if (quantity > offer.quantity) {
				await ctx.reply(
					`❌ Введенное количество (${quantity}) превышает доступное (${offer.quantity}). Пожалуйста, введите число от 1 до ${offer.quantity}.`,
				)
				return
			}

			// Рассчитываем стоимость
			let totalPrice = 0
			let pricePerUnit = 0
			let totalWeight = 0

			if (offer.priceType === 'PER_HEAD') {
				pricePerUnit = offer.pricePerHead
				totalPrice = quantity * pricePerUnit
				totalWeight = quantity * offer.weight
			} else {
				pricePerUnit = offer.pricePerKg
				totalWeight = quantity * offer.weight
				totalPrice = totalWeight * pricePerUnit
			}

			// Применяем скидку на ЖКТ, если она есть
			let discountAmount = 0
			if (offer.gktDiscount > 0) {
				discountAmount = (totalPrice * offer.gktDiscount) / 100
				totalPrice -= discountAmount
			}

			// Форматируем числа для красивого отображения
			const formattedTotalPrice = totalPrice.toLocaleString('ru-RU')
			const formattedPricePerUnit = pricePerUnit.toLocaleString('ru-RU')
			const formattedDiscountAmount = discountAmount.toLocaleString('ru-RU')

			// Формируем сообщение с расчетом
			let message = `💰 <b>Расчет стоимости</b>\n\n`
			message += `🐄 Количество: ${quantity} голов\n`
			message += `⚖️ Общий вес: ${totalWeight} кг\n\n`

			if (offer.priceType === 'PER_HEAD') {
				message += `💵 Цена за голову: ${formattedPricePerUnit} ₽\n`
			} else {
				message += `💵 Цена за кг: ${formattedPricePerUnit} ₽\n`
			}

			if (offer.gktDiscount > 0) {
				message += `🔻 Скидка на ЖКТ (${offer.gktDiscount}%): ${formattedDiscountAmount} ₽\n`
			}

			message += `\n<b>Итоговая стоимость: ${formattedTotalPrice} ₽</b>`

			// Отправляем сообщение с расчетом
			await ctx.reply(message, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '🔄 Новый расчет',
								callback_data: `calculate_price_${offerId}`,
							},
						],
						[
							{
								text: '📞 Запросить контакты',
								callback_data: `request_contacts_${offerId}`,
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
			})

			// Очищаем состояние
			this.offerStates.delete(userId)
		} catch (error) {
			console.error('Ошибка при обработке количества:', error)
			await ctx.reply('❌ Произошла ошибка при расчете стоимости')
		}
	}

	async getOffersForBuyer(buyerId: string, requestId: number) {
		// Получаем запрос покупателя
		const request = await this.prisma.request.findUnique({
			where: { id: requestId },
		})

		// Получаем подходящие предложения
		const offers = await this.prisma.offer.findMany({
			where: {
				status: 'APPROVED' as const,
				quantity: { gte: request.quantity },
			},
			include: {
				user: true,
			},
			orderBy: [
				{ createdAt: 'desc' }, // Убираем сортировку по статусу, так как это поле не определено в схеме
			],
		})

		return offers
	}

	async handleOfferTitle(ctx: Context, title: string) {
		try {
			// Проверяем авторизацию перед обработкой
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
				return
			}

			// Проверяем роль пользователя
			if (user.role !== 'SUPPLIER') {
				await ctx.reply('❌ Только поставщики могут создавать объявления')
				return
			}

			const state = this.offerStates.get(userId)
			if (!state) {
				await ctx.reply(
					'❌ Произошла ошибка. Пожалуйста, начните создание объявления заново',
				)
				return
			}

			state.title = title
			state.userId = user.id // Сохраняем ID пользователя в состоянии
			this.offerStates.set(userId, state)

			// Продолжаем процесс создания объявления...
			await ctx.reply('🐮 Выберите тип КРС:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '🐄 Коровы', callback_data: 'offer_cattle_COWS' },
							{ text: '🐂 Быки', callback_data: 'offer_cattle_BULLS' },
						],
						[
							{ text: '🐮 Телки', callback_data: 'offer_cattle_HEIFERS' },
							{
								text: '🐄 Нетели',
								callback_data: 'offer_cattle_BREEDING_HEIFERS',
							},
						],
						[
							{ text: '🐮 Телята', callback_data: 'offer_cattle_CALVES' },
							{ text: '🐂 Бычки', callback_data: 'offer_cattle_BULL_CALVES' },
						],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при обработке названия объявления:', error)
			await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте позже')
		}
	}

	async handleMediaDone(ctx: Context) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			// Проверяем, есть ли загруженные фото или видео
			const totalFiles =
				(state.photos?.length || 0) + (state.videos?.length || 0)
			if (totalFiles === 0) {
				await ctx.reply('⚠️ Пожалуйста, загрузите хотя бы одно фото или видео')
				return
			}

			// Устанавливаем следующий шаг - ввод названия объявления
			state.inputType = 'title'
			this.updateOfferState(userId, state)

			// Запрашиваем название объявления
			await ctx.reply('📝 Введите название объявления:')
		} catch (error) {
			console.error('Ошибка при завершении загрузки медиа:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}

	async finalizeOffer(ctx: Context) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			// Получаем пользователя из базы данных
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Создаем объявление в базе данных
			const offer = await this.prisma.offer.create({
				data: {
					title: state.title,
					description: state.description,
					cattleType: state.cattleType,
					breed: state.breed,
					purpose: state.purpose,
					priceType: state.priceType,
					pricePerHead: state.pricePerHead,
					pricePerKg: state.pricePerKg,
					quantity: state.quantity,
					weight: state.weight,
					age: state.age,
					region: state.region,
					location: state.location,
					gktDiscount: state.gktDiscount || 0,
					customsUnion: state.customsUnion || false,
					status: 'PENDING' as const, // Статус "на модерации"
					userId: user.id,
				},
			})

			// Добавляем изображения
			if (state.photos && state.photos.length > 0) {
				for (const photo of state.photos) {
					await this.prisma.image.create({
						data: {
							url: photo.url,
							key: photo.key, // Добавляем ключ из состояния
							offer: { connect: { id: offer.id } },
						},
					})
				}
			}

			// Добавляем видео, если есть
			if (state.videoUrl) {
				// Сохраняем URL видео в поле объявления
				await this.prisma.offer.update({
					where: { id: offer.id },
					data: { videoUrl: state.videoUrl },
				})
			}

			// Очищаем состояние
			this.offerStates.delete(userId)

			// Отправляем сообщение об успешном создании объявления
			await ctx.reply(
				'✅ Объявление успешно создано и отправлено на модерацию!\n\n' +
					'После проверки администратором оно будет опубликовано на площадке. ' +
					'Вы получите уведомление, когда объявление будет одобрено.',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '« Вернуться в меню', callback_data: 'menu' }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при финализации объявления:', error)
			await ctx.reply('❌ Произошла ошибка при создании объявления')
		}
	}

	async showCattleTypeSelection(ctx: Context) {
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
	}

	async handleCattleTypeSelection(ctx: Context, cattleType: CattleType) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.cattleType = cattleType
			state.inputType = 'breed'
			this.updateOfferState(userId, state)

			// Запрашиваем породу
			await ctx.reply('🐮 Введите породу КРС:')
		} catch (error) {
			console.error('Ошибка при выборе типа КРС:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	async handlePurposeSelection(ctx: Context, purpose: CattlePurpose) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.purpose = purpose
			state.inputType = 'price_type'
			this.updateOfferState(userId, state)

			// Запрашиваем тип цены
			await ctx.reply('💰 Выберите тип цены:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '💵 За голову', callback_data: 'price_type_PER_HEAD' },
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

	async handlePriceTypeSelection(ctx: Context, priceType: PriceType) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.priceType = priceType
			state.inputType =
				priceType === 'PER_HEAD' ? 'price_per_head' : 'price_per_kg'
			this.updateOfferState(userId, state)

			await ctx.reply(
				priceType === 'PER_HEAD'
					? '💵 Введите цену за голову (в рублях):'
					: '⚖️ Введите цену за килограмм (в рублях):',
			)
		} catch (error) {
			console.error('Ошибка при выборе типа цены:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	async handleCustomsUnionSelection(ctx: Context, isCustomsUnion: boolean) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			state.customsUnion = isCustomsUnion
			state.inputType = 'region' // Меняем на запрос региона вместо gut_discount
			this.updateOfferState(userId, state)

			// Запрашиваем регион
			await ctx.reply('📍 Введите регион:')
		} catch (error) {
			console.error('Ошибка при выборе таможенного союза:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	async handleGutDiscountSelection(ctx: Context, hasDiscount: boolean) {
		try {
			const userId = ctx.from.id
			const state = this.getOfferState(userId)

			if (!state) {
				await ctx.reply('❌ Начните создание объявления заново')
				return
			}

			if (hasDiscount) {
				state.inputType = 'gkt_discount'
				this.updateOfferState(userId, state)
				await ctx.reply('Введите процент скидки на ЖКТ (число от 0 до 100):')
			} else {
				state.gktDiscount = 0
				state.inputType = 'region'
				this.updateOfferState(userId, state)
				await ctx.reply('📍 Введите регион:')
			}
		} catch (error) {
			console.error('Ошибка при выборе скидки ЖКТ:', error)
			await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.')
		}
	}

	async handleMyAds(ctx: Context) {
		try {
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
				where: { userId: user.id },
				orderBy: { createdAt: 'desc' },
				include: { images: true },
			})

			if (offers.length === 0) {
				await ctx.reply('У вас пока нет объявлений', {
					reply_markup: {
						inline_keyboard: [
							[{ text: '📝 Создать объявление', callback_data: 'create_ad' }],
							[{ text: '« В главное меню', callback_data: 'menu' }],
						],
					},
				})
				return
			}

			// Отправляем список объявлений
			await ctx.reply('📋 Ваши объявления:', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '📝 Создать новое объявление',
								callback_data: 'create_ad',
							},
						],
					],
				},
			})

			// Отправляем каждое объявление отдельным сообщением
			for (const offer of offers) {
				const statusText = {
					PENDING: '🟡 На модерации',
					APPROVED: '🟢 Активно',
					REJECTED: '🔴 Отклонено',
					ARCHIVED: '⚪️ В архиве',
				}[offer.status]

				const message = `
${statusText}

📋 <b>${offer.title}</b>
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
💰 Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/гол` : `${offer.pricePerKg} ₽/кг`}
📅 Создано: ${new Date(offer.createdAt).toLocaleDateString('ru-RU')}`

				await ctx.reply(message, {
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '👁 Просмотреть',
									callback_data: `view_offer_${offer.id}`,
								},
							],
							[
								{
									text: '✏️ Редактировать',
									callback_data: `edit_offer_${offer.id}`,
								},
								{
									text: '❌ Удалить',
									callback_data: `delete_offer_${offer.id}`,
								},
							],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				})
			}
		} catch (error) {
			console.error('Ошибка при получении объявлений:', error)
			await ctx.reply('❌ Произошла ошибка при получении списка объявлений')
		}
	}

	async getRecommendedOffers(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
		})

		// Получаем объявления с учетом статуса и рейтинга
		const offers = await this.prisma.offer.findMany({
			where: {
				status: 'APPROVED',
			},
			orderBy: [
				{ user: { status: 'desc' } }, // Сначала SUPER_PREMIUM, потом PREMIUM
				{ aiScore: 'desc' }, // Затем по рейтингу AI
				{ createdAt: 'desc' }, // И по дате создания
			],
			include: {
				user: true,
				images: true,
			},
			take: 10, // Берем топ-10 объявлений
		})

		// Форматируем объявления для отображения
		const formattedOffers = offers.map(offer => {
			const statusIcon = {
				SUPER_PREMIUM: '💎', // Алмаз для SUPER_PREMIUM
				PREMIUM: '⭐️', // Звезда для PREMIUM
				REGULAR: '', // Ничего для обычных
			}[offer.user.status]

			return `${statusIcon} <b>${offer.title}</b>
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
💰 Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/гол` : `${offer.pricePerKg} ₽/кг`}
📍 Регион: ${offer.region || 'Не указан'}
${offer.gktDiscount ? `\n🎯 Скидка ЖКТ: ${offer.gktDiscount}%` : ''}
${offer.customsUnion ? '\n🌍 Для стран ТС' : ''}`
		})

		return formattedOffers
	}

	async getOffersList(ctx: Context, page = 1): Promise<OfferListResponse> {
		const userId = ctx.from.id
		const ITEMS_PER_PAGE = 10

		// Получаем последний запрос пользователя
		const lastRequest = await this.prisma.request.findFirst({
			where: { userId: userId.toString() },
			orderBy: { createdAt: 'desc' },
		})

		// Формируем контекст пользователя
		const userContext = {
			region: lastRequest?.region?.toLowerCase() || '',
			price: lastRequest?.price || 0,
			cattleType: lastRequest?.cattleType || '',
			breed: lastRequest?.breed || '',
		}

		// Получаем объявления с базовой фильтрацией
		let offers = await this.prisma.offer.findMany({
			where: {
				status: 'APPROVED',
			},
			include: {
				images: true,
				user: true,
			},
			orderBy: { createdAt: 'desc' },
		})

		// Предварительная сортировка на бэкенде
		offers = offers
			.filter(offer => {
				const offerRegion = (offer.region || '').toLowerCase()
				const requestRegion = userContext.region.toLowerCase()
				return !requestRegion || offerRegion.includes(requestRegion)
			})
			.sort((a, b) => {
				const priceA =
					a.priceType === 'PER_HEAD' ? a.pricePerHead : a.pricePerKg
				const priceB =
					b.priceType === 'PER_HEAD' ? b.pricePerHead : b.pricePerKg
				const diffA = Math.abs(priceA - userContext.price)
				const diffB = Math.abs(priceB - userContext.price)
				return diffA - diffB
			})

		// Берем топ-20 или дополняем последними
		let offersForAnalysis = offers.slice(0, 20)
		if (offersForAnalysis.length < 20) {
			const remaining = await this.prisma.offer.findMany({
				where: {
					status: 'APPROVED',
					id: { notIn: offersForAnalysis.map(o => o.id) },
				},
				take: 20 - offersForAnalysis.length,
				orderBy: { createdAt: 'desc' },
				include: {
					// Добавляем include
					images: true,
					user: true,
				},
			})
			offersForAnalysis = [...offersForAnalysis, ...remaining]
		}

		// Отправляем на анализ в Coze
		const analysis = await this.cozeService.generateResponse(
			JSON.stringify({
				userContext,
				offers: offersForAnalysis.map(o => ({
					id: o.id,
					title: o.title,
					description: o.description,
					price: o.priceType === 'PER_HEAD' ? o.pricePerHead : o.pricePerKg,
					priceType: o.priceType,
					quantity: o.quantity,
					weight: o.weight,
					age: o.age,
					breed: o.breed,
					region: o.region,
					imagesCount: o.images.length,
					gktDiscount: o.gktDiscount,
					customsUnion: o.customsUnion,
				})),
			}),
			'Проанализируй объявления и верни топ-10 с учетом контекста пользователя',
		)

		try {
			const result = JSON.parse(analysis)
			const analyzedOffers = await Promise.all(
				result.topOffers.map(async item => {
					const offer = await this.prisma.offer.findUnique({
						where: { id: item.id },
						include: { user: true },
					})
					return {
						...offer,
						user: {
							...offer.user,
							status: item.status,
						},
					}
				}),
			)

			// Форматируем объявления
			const formattedOffers = analyzedOffers.map(offer =>
				this.formatOffer(offer),
			)

			// Получаем обычные объявления с пагинацией
			const regularOffers = await this.prisma.offer.findMany({
				where: {
					status: 'APPROVED',
					id: { notIn: analyzedOffers.map(o => o.id) },
				},
				orderBy: { createdAt: 'desc' },
				skip: (page - 1) * ITEMS_PER_PAGE,
				take: ITEMS_PER_PAGE,
				include: { user: true },
			})

			const totalRegularOffers = await this.prisma.offer.count({
				where: {
					status: 'APPROVED',
					id: { notIn: analyzedOffers.map(o => o.id) },
				},
			})

			return {
				topOffers: [...formattedOffers],
				hasMore: page * ITEMS_PER_PAGE < totalRegularOffers,
				currentPage: page,
				totalPages: Math.ceil(totalRegularOffers / ITEMS_PER_PAGE),
			}
		} catch (error) {
			console.error('Ошибка при обработке результатов анализа:', error)
			return {
				topOffers: [],
				hasMore: false,
				currentPage: page,
				totalPages: 0,
			}
		}
	}

	private formatOffer(offer: any): string {
		const statusIcon = {
			SUPER_PREMIUM: '💎',
			PREMIUM: '⭐️',
			REGULAR: '',
		}[offer.user?.status || 'REGULAR']

		return `${statusIcon} <b>${offer.title}</b>
🔢 Количество: ${offer.quantity} голов
⚖️ Вес: ${offer.weight} кг
💰 Цена: ${offer.priceType === 'PER_HEAD' ? `${offer.pricePerHead} ₽/гол` : `${offer.pricePerKg} ₽/кг`}
📍 Регион: ${offer.region || 'Не указан'}
${offer.gktDiscount ? `\n🎯 Скидка ЖКТ: ${offer.gktDiscount}%` : ''}
${offer.customsUnion ? '\n🌍 Для стран ТС' : ''}`
	}
}
