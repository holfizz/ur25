import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma.service'
import { CozeService } from './coze.service'

interface AIAnalysisResult {
	score: number
	status: 'REGULAR' | 'PREMIUM' | 'SUPER_PREMIUM'
	details: {
		completeness: number
		attractiveness: number
	}
}

@Injectable()
export class AiAnalysisService {
	constructor(
		private prisma: PrismaService,
		private cozeService: CozeService,
		private configService: ConfigService,
	) {}

	async analyzeOffer(offerId: string): Promise<AIAnalysisResult | null> {
		const offer = await this.prisma.offer.findUnique({
			where: { id: offerId },
			include: {
				images: true,
				user: true,
			},
		})

		if (!offer) return null

		const context = {
			title: offer.title,
			description: offer.description,
			price:
				offer.priceType === 'PER_HEAD' ? offer.pricePerHead : offer.pricePerKg,
			priceType: offer.priceType,
			quantity: offer.quantity,
			weight: offer.weight,
			age: offer.age,
			breed: offer.breed,
			imagesCount: offer.images.length,
			supplierRating: offer.user.rating,
			gktDiscount: offer.gktDiscount,
			customsUnion: offer.customsUnion,
		}

		// Запрашиваем анализ у Coze с ожиданием структурированного ответа
		const analysis = await this.cozeService.generateResponse(
			JSON.stringify(context),
			'Проанализируй объявление и верни JSON с оценкой и рекомендуемым статусом',
		)

		try {
			const result: AIAnalysisResult = JSON.parse(analysis)

			// Обновляем данные в базе
			await this.prisma.offer.update({
				where: { id: offerId },
				data: {
					aiScore: result.score,
					quality:
						(result.details.completeness + result.details.attractiveness) / 2,
					lastAnalyzed: new Date(),
				},
			})

			// Обновляем статус поставщика если нужно
			if (result.score >= 85) {
				await this.prisma.user.update({
					where: { id: offer.userId },
					data: { status: 'SUPER_PREMIUM' },
				})
			} else if (result.score >= 70) {
				await this.prisma.user.update({
					where: { id: offer.userId },
					data: { status: 'PREMIUM' },
				})
			}

			return result
		} catch (error) {
			console.error('Ошибка при парсинге ответа AI:', error)
			return null
		}
	}

	// Метод для периодического анализа объявлений
	async scheduleAnalysis() {
		const offers = await this.prisma.offer.findMany({
			where: {
				OR: [
					{ lastAnalyzed: null },
					{
						lastAnalyzed: {
							lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Старше 24 часов
						},
					},
				],
				user: {
					status: {
						in: ['PREMIUM', 'SUPER_PREMIUM'],
					},
				},
			},
		})

		for (const offer of offers) {
			await this.analyzeOffer(offer.id)
		}
	}
}
