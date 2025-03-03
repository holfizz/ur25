import { Injectable } from '@nestjs/common'
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

	async findAll() {
		return this.prisma.offer.findMany({
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
		})
	}

	async findOne(id: string) {
		return this.prisma.offer.findUnique({
			where: { id },
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
		})
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
