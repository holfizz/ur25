import {
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common'
import { S3Service } from '../common/services/s3.service'
import { PrismaService } from '../prisma.service'
import { TelegramClient } from '../telegram/telegram.client'
import { CreateOfferDto } from './dto/create-offer.dto'

@Injectable()
export class OfferService {
	constructor(
		private prisma: PrismaService,
		private s3Service: S3Service,
		private telegramClient: TelegramClient,
	) {}

	async create(
		userId: string,
		dto: CreateOfferDto,
		files: Express.Multer.File[],
	) {
		// Загружаем фотографии в S3
		const uploadPromises = files.map(file => this.s3Service.uploadFile(file))
		const uploadedFiles = await Promise.all(uploadPromises)

		// Создаем объявление с фотографиями
		const offer = await this.prisma.offer.create({
			data: {
				title: dto.title,
				description: dto.description,
				price: dto.price,
				quantity: dto.quantity,
				breed: dto.breed,
				age: dto.age,
				weight: dto.weight,
				location: dto.location,
				cattleType: dto.cattleType,
				purpose: dto.purpose,
				priceType: dto.priceType,
				pricePerKg: dto.pricePerKg || 0,
				pricePerHead: dto.pricePerHead || 0,
				gktDiscount: dto.gktDiscount || 0,
				region: dto.region,
				fullAddress: dto.fullAddress,
				customsUnion: dto.customsUnion,
				videoUrl: dto.videoUrl,
				mercuryNumber: dto.mercuryNumber,
				contactPerson: dto.contactPerson,
				contactPhone: dto.contactPhone,
				user: {
					connect: {
						id: userId,
					},
				},
				images: {
					create: uploadedFiles.map(file => ({
						url: file.url,
						key: file.key,
					})),
				},
			},
			include: {
				images: true,
			},
		})

		return offer
	}

	async delete(offerId: string) {
		// Получаем объявление с фотографиями
		const offer = await this.prisma.offer.findUnique({
			where: { id: offerId },
			include: { images: true },
		})

		// Удаляем фотографии из S3
		await Promise.all(
			offer.images.map(image => this.s3Service.deleteFile(image.key)),
		)

		// Удаляем объявление из базы
		await this.prisma.offer.delete({
			where: { id: offerId },
		})
	}

	async verifyOffer(offerId: string) {
		try {
			// Сначала проверяем, существует ли объявление
			const existingOffer = await this.prisma.offer.findUnique({
				where: { id: offerId },
			})

			if (!existingOffer) {
				return {
					success: false,
					message: 'Offer not found',
					error: `Offer with ID ${offerId} does not exist`,
				}
			}

			// Если объявление существует, обновляем его
			const offer = await this.prisma.offer.update({
				where: { id: offerId },
				data: {
					status: 'APPROVED',
				},
			})

			// Отправляем уведомление пользователю
			try {
				const user = await this.prisma.user.findUnique({
					where: { id: offer.userId },
				})

				if (user && user.telegramId) {
					await this.telegramClient.sendMessage(
						user.telegramId,
						`✅ Ваше объявление "${offer.title}" прошло модерацию и опубликовано!`,
					)
				}
			} catch (notificationError) {
				console.error('Failed to send notification:', notificationError)
				// Продолжаем выполнение, даже если уведомление не отправлено
			}

			return {
				success: true,
				message: 'Offer verified successfully',
				offer,
			}
		} catch (error) {
			console.error('Error verifying offer:', error)
			return {
				success: false,
				message: 'Failed to verify offer',
				error: error.message,
			}
		}
	}

	async rejectOffer(offerId: string) {
		try {
			const offer = await this.prisma.offer.update({
				where: { id: offerId },
				data: { status: 'REJECTED' },
				include: { user: true },
			})

			// Отправляем уведомление в Telegram
			if (offer.user.telegramId) {
				await this.telegramClient.sendMessage(
					offer.user.telegramId,
					`❌ Ваше объявление "${offer.title}" было отклонено модератором.`,
				)
			}

			return {
				success: true,
				message: 'Offer rejected successfully',
				offer,
			}
		} catch (error) {
			return {
				success: false,
				message: 'Failed to reject offer',
				error: error.message,
			}
		}
	}

	async findAll(filters?: Record<string, string>) {
		const where: any = {
			status: 'APPROVED', // Показываем только одобренные объявления
		}

		// Фильтрация по регионам
		if (filters?.regions) {
			where.region = { in: filters.regions.split(',') }
		}

		// Поиск по тексту (в заголовке и описании)
		if (filters?.search) {
			where.OR = [
				{ title: { contains: filters.search, mode: 'insensitive' } },
				{ description: { contains: filters.search, mode: 'insensitive' } },
				{ breed: { contains: filters.search, mode: 'insensitive' } },
			]
		}

		// Фильтрация по цене
		if (filters?.minPrice || filters?.maxPrice) {
			const priceFilter: any = {}

			if (filters.priceType === 'PER_HEAD') {
				if (filters.minPrice) {
					priceFilter.pricePerHead = { gte: parseInt(filters.minPrice) }
				}
				if (filters.maxPrice) {
					priceFilter.pricePerHead = {
						...priceFilter.pricePerHead,
						lte: parseInt(filters.maxPrice),
					}
				}
				where.priceType = 'PER_HEAD'
			} else if (filters.priceType === 'PER_KG') {
				if (filters.minPrice) {
					priceFilter.pricePerKg = { gte: parseInt(filters.minPrice) }
				}
				if (filters.maxPrice) {
					priceFilter.pricePerKg = {
						...priceFilter.pricePerKg,
						lte: parseInt(filters.maxPrice),
					}
				}
				where.priceType = 'PER_KG'
			} else {
				// Если тип цены не указан, ищем по обоим полям
				const priceConditions = []

				if (filters.minPrice) {
					priceConditions.push({
						pricePerHead: { gte: parseInt(filters.minPrice) },
					})
					priceConditions.push({
						pricePerKg: { gte: parseInt(filters.minPrice) },
					})
				}

				if (filters.maxPrice) {
					priceConditions.push({
						pricePerHead: { lte: parseInt(filters.maxPrice) },
					})
					priceConditions.push({
						pricePerKg: { lte: parseInt(filters.maxPrice) },
					})
				}

				if (priceConditions.length > 0) {
					where.OR = [...(where.OR || []), ...priceConditions]
				}
			}

			// Добавляем фильтр по цене в основной where
			if (Object.keys(priceFilter).length > 0) {
				where.AND = [...(where.AND || []), priceFilter]
			}
		} else if (filters?.priceType) {
			// Если указан только тип цены без диапазона
			where.priceType = filters.priceType
		}

		// Фильтрация по породе
		if (filters?.breed) {
			where.breed = { contains: filters.breed, mode: 'insensitive' }
		}

		// Фильтрация по количеству голов
		if (filters?.minQuantity) {
			where.quantity = { gte: parseInt(filters.minQuantity) }
		}
		if (filters?.maxQuantity) {
			where.quantity = {
				...(where.quantity || {}),
				lte: parseInt(filters.maxQuantity),
			}
		}

		// Фильтрация по таможенному союзу
		if (filters?.customsUnion === 'true') {
			where.customsUnion = true
		} else if (filters?.customsUnion === 'false') {
			where.customsUnion = false
		}

		console.log('Применяемые фильтры:', where) // Для отладки

		const page = parseInt(filters?.page || '1', 10)
		const pageSize = parseInt(filters?.pageSize || '40', 10)
		const skip = (page - 1) * pageSize

		const [offers, total] = await Promise.all([
			this.prisma.offer.findMany({
				where,
				include: {
					images: true,
					user: {
						select: {
							id: true,
							name: true,
							email: true,
						},
					},
				},
				orderBy: {
					createdAt: 'desc',
				},
				skip,
				take: pageSize,
			}),
			this.prisma.offer.count({ where }),
		])

		return { offers, total }
	}

	async getRegionsWithCount() {
		try {
			// Получаем все регионы с количеством объявлений
			const regionsWithCount = await this.prisma.$queryRaw`
				SELECT "region", COUNT(*) as "count"
				FROM "Offer"
				WHERE "status" = 'APPROVED' AND "region" IS NOT NULL
				GROUP BY "region"
				ORDER BY "count" DESC
			`

			return regionsWithCount
		} catch (error) {
			console.error('Error fetching regions with count:', error)
			return []
		}
	}

	async getRegions() {
		try {
			const offers = await this.prisma.offer.findMany({
				select: { region: true },
				where: {
					region: { not: null },
					status: 'APPROVED',
				},
				distinct: ['region'],
			})

			return offers.map(offer => offer.region).filter(region => region) // Фильтруем null и undefined
		} catch (error) {
			console.error('Error fetching regions:', error)
			return []
		}
	}

	async getPriceRanges() {
		try {
			// Получаем минимальные и максимальные цены для обоих типов цен
			const perHeadPrices = await this.prisma.offer.aggregate({
				where: {
					priceType: 'PER_HEAD',
					status: 'APPROVED',
					pricePerHead: { gt: 0 },
				},
				_min: { pricePerHead: true },
				_max: { pricePerHead: true },
			})

			const perKgPrices = await this.prisma.offer.aggregate({
				where: {
					priceType: 'PER_KG',
					status: 'APPROVED',
					pricePerKg: { gt: 0 },
				},
				_min: { pricePerKg: true },
				_max: { pricePerKg: true },
			})

			return {
				perHead: {
					min: perHeadPrices._min.pricePerHead || 0,
					max: perHeadPrices._max.pricePerHead || 0,
				},
				perKg: {
					min: perKgPrices._min.pricePerKg || 0,
					max: perKgPrices._max.pricePerKg || 0,
				},
			}
		} catch (error) {
			console.error('Error fetching price ranges:', error)
			return {
				perHead: { min: 0, max: 0 },
				perKg: { min: 0, max: 0 },
			}
		}
	}

	async getBreeds() {
		try {
			const breeds = await this.prisma.offer.findMany({
				select: { breed: true },
				where: {
					breed: { not: null },
					status: 'APPROVED',
				},
				distinct: ['breed'],
			})

			return breeds.map(offer => offer.breed).filter(breed => breed)
		} catch (error) {
			console.error('Error fetching breeds:', error)
			return []
		}
	}

	async findOne(id: string) {
		try {
			const offer = await this.prisma.offer.findUnique({
				where: { id },
				include: {
					images: true,
					user: {
						select: {
							id: true,
							name: true,
							role: true,
							mercuryNumber: true,
						},
					},
				},
			})

			if (!offer) {
				throw new NotFoundException('Объявление не найдено')
			}

			// Удаляем конфиденциальную информацию
			const { fullAddress, contactPhone, contactPerson, ...safeOfferData } =
				offer

			return {
				...safeOfferData,
				fullAddress: undefined, // Явно устанавливаем как undefined
				contactPhone: undefined,
				contactPerson: undefined,
			}
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw error
			}
			throw new InternalServerErrorException('Ошибка при получении объявления')
		}
	}

	async requestContacts(offerId: string, userId: string, message: string) {
		try {
			const offer = await this.prisma.offer.findUnique({
				where: { id: offerId },
				include: {
					user: true,
				},
			})

			if (!offer) {
				throw new NotFoundException('Объявление не найдено')
			}

			// Создаем запрос на контакты
			const contactRequest = await this.prisma.contactRequest.create({
				data: {
					comment: message,
					status: 'PENDING', // Добавляем статус
					offer: {
						connect: {
							id: offerId,
						},
					},
					buyer: {
						connect: {
							id: userId,
						},
					},
					seller: {
						connect: {
							id: offer.userId,
						},
					},
				},
			})

			// Отправляем уведомление продавцу в Telegram
			if (offer.user.telegramId) {
				await this.telegramClient.sendMessage(
					offer.user.telegramId,
					`🔔 Новый запрос контактов!\n\nОбъявление: ${offer.title}\nСообщение: ${message}\n\nПроверьте запрос в личном кабинете.`,
				)
			}

			return {
				success: true,
				message: '🎊 Запрос успешно отправлен! Ожидайте ответа от продавца.',
			}
		} catch (error) {
			console.error('Ошибка при отправке запроса контактов:', error)
			throw new InternalServerErrorException('Ошибка при отправке запроса')
		}
	}

	async update(
		id: string,
		userId: string,
		dto: CreateOfferDto,
		files: Express.Multer.File[],
	) {
		// Проверяем, существует ли объявление и принадлежит ли оно пользователю
		const existingOffer = await this.prisma.offer.findFirst({
			where: {
				id,
				userId,
			},
			include: {
				images: true,
			},
		})

		if (!existingOffer) {
			throw new Error(
				'Offer not found or you do not have permission to update it',
			)
		}

		// Загружаем новые фотографии, если они есть
		let uploadedFiles = []
		if (files && files.length > 0) {
			const uploadPromises = files.map(file => this.s3Service.uploadFile(file))
			uploadedFiles = await Promise.all(uploadPromises)
		}

		// Обновляем объявление
		return this.prisma.offer.update({
			where: { id },
			data: {
				title: dto.title,
				description: dto.description,
				price: dto.price,
				quantity: dto.quantity,
				breed: dto.breed,
				age: dto.age,
				weight: dto.weight,
				location: dto.location,
				cattleType: dto.cattleType,
				purpose: dto.purpose,
				priceType: dto.priceType,
				pricePerKg: dto.pricePerKg || 0,
				pricePerHead: dto.pricePerHead || 0,
				gktDiscount: dto.gktDiscount || 0,
				region: dto.region,
				fullAddress: dto.fullAddress,
				customsUnion: dto.customsUnion,
				videoUrl: dto.videoUrl,
				mercuryNumber: dto.mercuryNumber,
				contactPerson: dto.contactPerson,
				contactPhone: dto.contactPhone,
				...(uploadedFiles.length > 0 && {
					images: {
						create: uploadedFiles.map(file => ({
							url: file.url,
							key: file.key,
						})),
					},
				}),
			},
			include: {
				images: true,
			},
		})
	}
}
