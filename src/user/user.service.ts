import { MailService } from '@/auth/mail.service'
import {
	BadRequestException,
	Inject,
	Injectable,
	forwardRef,
} from '@nestjs/common'
import { Prisma, VerificationStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { returnUserObject } from './return-user.object'
import { UserDto } from './user.dto'

@Injectable()
export class UserService {
	constructor(
		private prisma: PrismaService,
		private mailService: MailService,
		@Inject(forwardRef(() => TelegramService))
		private telegramService: TelegramService,
	) {}

	async byId(id: string, selectObject?: Prisma.UserSelect) {
		const user = await this.prisma.user.findUnique({
			where: { id },
			select: {
				...returnUserObject,
				...selectObject,
			},
		})
		if (!user) {
			throw new Error('User not found')
		}
		return user
	}

	async updateProfile(id: string, dto: UserDto) {
		const isSameUser = await this.prisma.user.findUnique({
			where: { email: dto.email },
		})

		if (isSameUser && id !== isSameUser.id) {
			throw new BadRequestException('Email занят')
		}

		const user = await this.prisma.user.update({
			where: { id },
			data: {
				email: dto.email,
				name: dto.name,
				phone: dto.phone,
				password: dto.password ? await bcrypt.hash(dto.password, 5) : undefined,
			},
			select: returnUserObject,
		})

		return user
	}

	async getPendingUsers() {
		return this.prisma.user.findMany({
			where: {
				verificationStatus: 'PENDING',
			},
			select: {
				id: true,
				email: true,
				name: true,
				role: true,
				createdAt: true,
				verificationStatus: true,
			},
		})
	}

	async verifyUser(id: string, status: 'APPROVED' | 'REJECTED') {
		const user = await this.prisma.user.update({
			where: { id },
			data: {
				isVerified: status === 'APPROVED',
				verificationStatus: status as VerificationStatus,
			},
			select: {
				id: true,
				email: true,
				name: true,
				telegramId: true,
				verificationStatus: true,
			},
		})

		if (status === 'APPROVED') {
			// Отправляем email с уведомлением
			if (user.email) {
				await this.mailService.sendVerificationEmail(user.email)
			}

			// Отправляем уведомление в Telegram
			if (user.telegramId) {
				await this.telegramService.sendMessage(
					user.telegramId,
					'🎉 Поздравляем! Ваш аккаунт успешно верифицирован. Теперь вы можете использовать все функции платформы.',
				)
			}
		} else {
			// Уведомление об отклонении
			if (user.email) {
				await this.mailService.sendMail({
					to: user.email,
					subject: 'Верификация отклонена ❌',
					html: `
						<h2>Здравствуйте, ${user.name}!</h2>
						<p>К сожалению, ваша заявка на верификацию была отклонена.</p>
						<p>Пожалуйста, убедитесь, что все предоставленные данные корректны и попробуйте снова.</p>
						<p>Если у вас есть вопросы, свяжитесь с нашей службой поддержки.</p>
					`,
				})
			}

			if (user.telegramId) {
				await this.telegramService.sendMessage(
					user.telegramId,
					'❌ К сожалению, ваша заявка на верификацию была отклонена. Пожалуйста, убедитесь, что все предоставленные данные корректны и попробуйте снова.',
				)
			}
		}

		return {
			message: `User verification ${status.toLowerCase()}`,
			user,
		}
	}
}
