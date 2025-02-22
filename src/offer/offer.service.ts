import { Injectable } from '@nestjs/common'
import { S3Service } from '../common/services/s3.service'
import { PrismaService } from '../prisma.service'
import { CreateOfferDto } from './dto/create-offer.dto'

@Injectable()
export class OfferService {
	constructor(
		private prisma: PrismaService,
		private s3Service: S3Service,
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
				...dto,
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
}
