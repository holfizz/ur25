import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import { PrismaService } from '../../prisma.service'

@Injectable()
export class AIService {
	private openai: OpenAI

	constructor(
		private prisma: PrismaService,
		private configService: ConfigService,
	) {
		this.openai = new OpenAI({
			apiKey: this.configService.get('OPENAI_API_KEY'),
		})
	}

	private calculateAverageRating(offers: any[]): number {
		if (!offers || offers.length === 0) return 0
		const totalRating = offers.reduce(
			(sum, offer) => sum + (offer.rating || 0),
			0,
		)
		return totalRating / offers.length
	}

	// Метод для определения статуса поставщика на основе его активности
	async determineSupplierStatus(
		supplierId: string,
	): Promise<'REGULAR' | 'PREMIUM' | 'SUPER_PREMIUM'> {
		try {
			// Получаем данные о поставщике и его активности
			const supplier = await this.prisma.user.findUnique({
				where: { id: supplierId },
				include: {
					offers: {
						include: {
							matches: true,
						},
					},
				},
			})

			if (!supplier) return 'REGULAR'

			// Анализируем активность с помощью GPT
			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4',
				messages: [
					{
						role: 'system',
						content: `Проанализируй активность поставщика КРС и определи его статус:
              - REGULAR: базовый статус
              - PREMIUM: активные продажи, хорошие отзывы, стабильное качество
              - SUPER_PREMIUM: высокий объем продаж, отличные отзывы, премиальное качество`,
					},
					{
						role: 'user',
						content: JSON.stringify({
							totalOffers: supplier.offers.length,
							successfulDeals: supplier.offers.filter(
								o => o.status === 'APPROVED',
							).length,
							averageRating: this.calculateAverageRating(supplier.offers),
							// другие метрики...
						}),
					},
				],
			})

			return (completion.choices[0]?.message?.content || 'REGULAR') as
				| 'REGULAR'
				| 'PREMIUM'
				| 'SUPER_PREMIUM'
		} catch (error) {
			console.error('Ошибка при определении статуса:', error)
			return 'REGULAR'
		}
	}
}
