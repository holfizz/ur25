import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma.service'
import { CozeService } from './coze.service'

interface AIAnalysisResult {
	topOffers: Array<{
		id: string
		status: 'SUPER_PREMIUM' | 'PREMIUM' | 'REGULAR'
		score: number
	}>
}

@Injectable()
export class AiAnalysisService {
	constructor(
		private prisma: PrismaService,
		private cozeService: CozeService,
		private configService: ConfigService,
	) {}

	// Запускаем обновление каждые 6 часов
	@Cron('0 */6 * * *')
	async updateTopOffers() {
		console.log('Запуск обновления топовых объявлений')

		try {
			// Получаем все активные объявления
			const offers = await this.prisma.offer.findMany({
				where: {
					status: 'APPROVED',
				},
				include: {
					images: true,
					user: true,
				},
				orderBy: [{ user: { status: 'desc' } }, { createdAt: 'desc' }],
				take: 100, // Увеличиваем до 100 объявлений для лучшего анализа
			})

			if (offers.length === 0) {
				console.log('Нет активных объявлений для анализа')
				return
			}

			// Получаем последний запрос для контекста пользователя
			const lastRequest = await this.prisma.request.findFirst({
				orderBy: { createdAt: 'desc' },
			})

			// Формируем контекст пользователя
			const userContext = {
				region: lastRequest?.region || '',
				price: lastRequest?.price || 0,
				cattleType: lastRequest?.cattleType || '',
				breed: lastRequest?.breed || '',
			}

			// Подготавливаем данные для отправки в Coze, упрощаем структуру
			const offersForAnalysis = offers.map(offer => ({
				id: offer.id,
				title: offer.title?.substring(0, 100) || '', // Ограничиваем длину
				price:
					offer.priceType === 'PER_HEAD'
						? offer.pricePerHead
						: offer.pricePerKg,
				priceType: offer.priceType,
				quantity: offer.quantity,
				weight: offer.weight,
				age: offer.age,
				breed: offer.breed,
				region: offer.region,
				imagesCount: offer.images.length,
				gktDiscount: offer.gktDiscount,
				customsUnion: offer.customsUnion,
			}))

			// Отправляем данные для анализа
			console.log('Отправляем данные для анализа объявлений...')
			const data = {
				userContext,
				offers: offersForAnalysis,
			}

			console.log('Размер данных:', JSON.stringify(data))

			// Получаем результаты анализа от Coze
			// Преобразуем объект в строку, так как метод ожидает строку
			const analysisResponse = await this.cozeService.analyzeOffers(
				JSON.stringify(data),
			)

			// Парсим ответ в объект
			let analysis
			try {
				analysis = JSON.parse(analysisResponse)
			} catch (error) {
				console.error('Ошибка при парсинге ответа от Coze:', error)
				return
			}

			if (!analysis || !analysis.topOffers) {
				console.log('Не удалось получить результаты анализа')
				return
			}

			console.log(
				`Получены результаты анализа: ${analysis.topOffers.length} топовых объявлений`,
			)

			// Получаем пользователя для сохранения топовых объявлений
			const adminUser = await this.prisma.user.findFirst({
				where: { role: 'ADMIN' },
			})

			if (!adminUser) {
				console.error('Не найден пользователь с ролью ADMIN')
				return
			}

			// Сохраняем результаты анализа в базу данных
			await this.saveTopOffers(analysis.topOffers, adminUser.id)

			console.log('Обновление топовых объявлений завершено')
		} catch (error) {
			console.error('Ошибка при обновлении топовых объявлений:', error)
		}
	}

	// Метод для получения топовых объявлений
	async getTopOffers() {
		return this.prisma.topOffer.findMany({
			include: {
				offer: {
					include: {
						images: true,
						user: true,
					},
				},
			},
			orderBy: { position: 'asc' },
		})
	}

	// Метод для анализа объявлений на основе запроса пользователя
	async analyzeOffersForRequest(
		offers: any[],
		requestDescription: string,
		userRequest: any,
		userId: string,
	) {
		try {
			console.log('Анализируем объявления для запроса:', requestDescription)

			// Проверяем, есть ли уже топовые объявления для этого пользователя и когда они были созданы
			const existingTopOffers = await this.prisma.topOffer.findMany({
				where: { userId },
				orderBy: { createdAt: 'desc' },
				take: 1,
			})

			// Если есть топовые объявления и они были созданы менее 6 часов назад, используем их
			if (existingTopOffers.length > 0) {
				const lastCreatedAt = existingTopOffers[0].createdAt
				const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 часов назад

				if (lastCreatedAt > sixHoursAgo) {
					console.log(
						'Используем существующие топовые объявления, созданные менее 6 часов назад',
					)

					// Получаем все топовые объявления с данными для этого пользователя
					const topOffers = await this.prisma.topOffer.findMany({
						where: { userId },
						include: {
							offer: true,
						},
						orderBy: { position: 'asc' },
					})

					// Если есть топовые объявления, возвращаем их
					if (topOffers.length > 0) {
						// Находим соответствующие объявления из исходного списка
						const matchedOffers = []
						for (const topOffer of topOffers) {
							const offer = offers.find(o => o.id === topOffer.offerId)
							if (offer) {
								matchedOffers.push({
									...offer,
									matchScore: topOffer.score || 0,
									status: topOffer.status || 'REGULAR',
								})
							}
						}

						// Если нашли соответствующие объявления, возвращаем их
						if (matchedOffers.length > 0) {
							return matchedOffers
						}
					}
				}
			}

			// Если нет существующих топовых объявлений или они устарели, выполняем новый анализ
			console.log('Выполняем новый анализ объявлений')

			// Формируем данные для анализа
			const offersForAnalysis = offers.map(offer => ({
				id: offer.id,
				title: offer.title || '',
				price: offer.price || 0,
				priceType: offer.priceType || 'PER_KG',
				quantity: offer.quantity || 0,
				weight: offer.weight || 0,
				age: offer.age || 0,
				breed: offer.breed || '',
				region: offer.region || '',
				imagesCount: offer.imagesCount || 0,
				gktDiscount: offer.gktDiscount || 0,
				customsUnion: offer.customsUnion || false,
			}))

			// Формируем контекст пользователя из запроса
			const userContext = {
				region: userRequest.region || '',
				price: userRequest.price || 0,
				cattleType: userRequest.cattleType || '',
				breed: userRequest.breed || '',
			}

			// Отправляем данные для анализа
			console.log('Отправляем данные для анализа объявлений...')
			const data = {
				userContext,
				offers: offersForAnalysis,
			}

			console.log('Размер данных:', JSON.stringify(data))

			// Получаем результаты анализа от Coze
			// Преобразуем объект в строку, так как метод ожидает строку
			const analysisResponse = await this.cozeService.analyzeOffers(
				JSON.stringify(data),
			)

			// Парсим ответ в объект
			let analysis
			try {
				analysis = JSON.parse(analysisResponse)
			} catch (error) {
				console.error('Ошибка при парсинге ответа от Coze:', error)
				return offers.slice(0, 10) // Возвращаем первые 10 объявлений в случае ошибки
			}

			if (!analysis || !analysis.topOffers) {
				console.log('Не удалось получить результаты анализа')
				return offers.slice(0, 10) // Возвращаем первые 10 объявлений
			}

			console.log(
				`Получены результаты анализа: ${analysis.topOffers.length} топовых объявлений`,
			)

			// Находим соответствующие объявления из исходного списка
			const matchedOffers = []
			for (const topOffer of analysis.topOffers) {
				const offer = offers.find(o => o.id === topOffer.id)
				if (offer) {
					matchedOffers.push({
						...offer,
						matchScore: topOffer.score || 0,
						status: topOffer.status || 'REGULAR',
					})
				}
			}

			// Сохраняем результаты анализа в базу данных с указанием userId
			await this.saveTopOffers(analysis.topOffers, userId)

			return matchedOffers
		} catch (error) {
			console.error('Ошибка при анализе объявлений:', error)
			return offers.slice(0, 10) // Возвращаем первые 10 объявлений
		}
	}

	// Вспомогательный метод для сохранения топовых объявлений
	private async saveTopOffers(topOffers: any[], userId: string) {
		try {
			console.log(
				'Сохраняем топовые объявления в базу данных:',
				topOffers.length,
				userId ? `для пользователя ${userId}` : 'для всех пользователей',
			)

			// Если указан userId, удаляем только топовые объявления этого пользователя
			if (userId) {
				await this.prisma.topOffer.deleteMany({
					where: { userId },
				})
			} else {
				// Если userId не указан, выходим с ошибкой
				console.error(
					'Ошибка: userId не указан при сохранении топовых объявлений',
				)
				return
			}

			// Текущее время для всех создаваемых записей
			const now = new Date()

			// Удаляем дубликаты по ID
			const uniqueTopOffers = topOffers.filter(
				(offer, index, self) =>
					index === self.findIndex(o => o.id === offer.id),
			)

			console.log(
				`Уникальных объявлений: ${uniqueTopOffers.length} из ${topOffers.length}`,
			)

			// Создаем новые записи для топовых объявлений
			for (let i = 0; i < uniqueTopOffers.length && i < 10; i++) {
				const topOffer = uniqueTopOffers[i]

				// Проверяем, существует ли объявление
				const offerExists = await this.prisma.offer.findUnique({
					where: { id: topOffer.id },
				})

				if (offerExists) {
					try {
						// Используем правильный формат данных для создания TopOffer
						await this.prisma.topOffer.create({
							data: {
								offer: {
									connect: { id: topOffer.id },
								},
								status: topOffer.status || 'REGULAR',
								score: topOffer.score || 0,
								position: i + 1,
								createdAt: now,
								user: {
									connect: { id: userId },
								},
							},
						})
					} catch (createError) {
						console.error(
							`Ошибка при создании записи для объявления ${topOffer.id}:`,
							createError,
						)
					}
				} else {
					console.log(`Объявление с ID ${topOffer.id} не найдено в базе данных`)
				}
			}

			console.log('Топовые объявления успешно сохранены')
		} catch (error) {
			console.error('Ошибка при сохранении топовых объявлений:', error)
		}
	}
}
