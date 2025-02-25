import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { TelegramClient } from '../telegram/telegram.client'
import { CreateDealDto } from './dto/create-deal.dto'
import { UpdateDealDto } from './dto/update-deal.dto'

@Injectable()
export class DealService {
	constructor(
		private prisma: PrismaService,
		private telegramClient: TelegramClient,
	) {}

	async create(createDealDto: CreateDealDto) {
		const deal = await this.prisma.deal.create({
			data: {
				offer: { connect: { id: createDealDto.offerId } },
				buyer: { connect: { id: createDealDto.buyerId } },
				seller: { connect: { id: createDealDto.sellerId } },
				status: 'PENDING',
				price: createDealDto.price,
				quantity: createDealDto.quantity,
			},
			include: {
				offer: true,
				buyer: true,
				seller: true,
			},
		})

		// Уведомляем продавца через Telegram, если есть telegramId
		if (deal.seller.telegramId) {
			await this.telegramClient.sendMessage(
				deal.seller.telegramId,
				`🤝 <b>Новое предложение о сделке!</b>\n\n` +
					`Пользователь ${deal.buyer.name || deal.buyer.email} предлагает сделку по вашему объявлению "${deal.offer.title}".\n\n` +
					`Количество: ${deal.quantity} голов\n` +
					`Цена: ${deal.price.toLocaleString('ru-RU')} ₽${deal.offer.priceType === 'PER_HEAD' ? '/голову' : '/кг'}\n\n` +
					`Вы можете принять или отклонить это предложение в личном кабинете.`,
				{
					parse_mode: 'HTML',
				},
			)
		}

		return deal
	}

	async findAll(params: {
		status?: string
		userId?: string
		offerId?: string
		page: number
		limit: number
	}) {
		const { status, userId, offerId, page, limit } = params
		const skip = (page - 1) * limit

		const where: any = {}

		if (status) {
			where.status = status
		}

		if (userId) {
			where.OR = [{ buyerId: userId }, { sellerId: userId }]
		}

		if (offerId) {
			where.offerId = offerId
		}

		const [deals, total] = await Promise.all([
			this.prisma.deal.findMany({
				where,
				include: {
					offer: true,
					buyer: {
						select: {
							id: true,
							name: true,
							email: true,
						},
					},
					seller: {
						select: {
							id: true,
							name: true,
							email: true,
						},
					},
				},
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
			}),
			this.prisma.deal.count({ where }),
		])

		return {
			data: deals,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		}
	}

	async findOne(id: string) {
		const deal = await this.prisma.deal.findUnique({
			where: { id },
			include: {
				offer: true,
				buyer: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
				seller: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
			},
		})

		if (!deal) {
			throw new NotFoundException(`Сделка с ID ${id} не найдена`)
		}

		return deal
	}

	async update(id: string, updateDealDto: UpdateDealDto) {
		const deal = await this.prisma.deal.findUnique({
			where: { id },
		})

		if (!deal) {
			throw new NotFoundException(`Сделка с ID ${id} не найдена`)
		}

		return this.prisma.deal.update({
			where: { id },
			data: updateDealDto,
			include: {
				offer: true,
				buyer: true,
				seller: true,
			},
		})
	}

	async updateStatus(id: string, status: 'APPROVED' | 'REJECTED') {
		const deal = await this.prisma.deal.findUnique({
			where: { id },
			include: {
				offer: true,
				buyer: true,
				seller: true,
			},
		})

		if (!deal) {
			throw new NotFoundException(`Сделка с ID ${id} не найдена`)
		}

		const updatedDeal = await this.prisma.deal.update({
			where: { id },
			data: { status },
			include: {
				offer: true,
				buyer: true,
				seller: true,
			},
		})

		// Отправляем уведомление покупателю через Telegram
		if (deal.buyer.telegramId) {
			if (status === 'APPROVED') {
				await this.telegramClient.sendMessage(
					deal.buyer.telegramId,
					`✅ <b>Предложение о сделке принято!</b>\n\n` +
						`Продавец принял ваше предложение о сделке по объявлению "${deal.offer.title}".\n\n` +
						`Количество: ${deal.quantity} голов\n` +
						`Цена: ${deal.price.toLocaleString('ru-RU')} ₽${deal.offer.priceType === 'PER_HEAD' ? '/голову' : '/кг'}\n\n` +
						`Теперь вы можете связаться с продавцом для обсуждения деталей.`,
					{
						parse_mode: 'HTML',
					},
				)
			} else {
				await this.telegramClient.sendMessage(
					deal.buyer.telegramId,
					`❌ <b>Предложение о сделке отклонено</b>\n\n` +
						`Продавец отклонил ваше предложение о сделке по объявлению "${deal.offer.title}".`,
					{
						parse_mode: 'HTML',
					},
				)
			}
		}

		return updatedDeal
	}
}
