import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from '@prisma/client'
import { Context } from 'telegraf'
import { PrismaService } from '../prisma.service'
import { TelegramServiceClient } from './telegram.service.client'

@Injectable()
export class TelegramService {
	private registrationStates: Map<number, any> = new Map()

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly telegramClient: TelegramServiceClient,
	) {}

	async handleStart(telegramId: string, chatId: string) {
		await this.telegramClient.sendMessageWithKeyboard(
			chatId,
			'Добро пожаловать! Выберите действие:',
			{
				inline_keyboard: [
					[
						{ text: '🔑 Войти в аккаунт', callback_data: 'login' },
						{ text: '📝 Регистрация', callback_data: 'register' },
					],
				],
			},
		)
	}

	async handleRegister(ctx: Context) {
		await ctx.reply('Выберите вашу роль для регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '🛒 Покупатель', callback_data: 'register_BUYER' },
						{ text: '📦 Поставщик', callback_data: 'register_SUPPLIER' },
					],
					[{ text: '🚛 Перевозчик', callback_data: 'register_CARRIER' }],
				],
			},
		})
	}

	async startRegistration(userId: number, role: Role) {
		this.registrationStates.set(userId, { role })
	}

	async handleRegistrationFlow(ctx: Context, text: string) {
		const userId = ctx.from.id
		const state = this.registrationStates.get(userId)

		if (!state) return

		if (!state.email) {
			if (!this.validateEmail(text)) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return
			}
			state.email = text
			this.registrationStates.set(userId, state)
			await ctx.reply(
				'🔑 Придумайте пароль:\n\n' +
					'Требования к паролю:\n' +
					'- Минимум 6 символов\n' +
					'- Должен содержать буквы и цифры\n' +
					'- Можно использовать специальные символы',
			)
			return
		}

		if (!state.password) {
			if (!this.validatePassword(text)) {
				await ctx.reply(
					'❌ Пароль не соответствует требованиям:\n\n' +
						'- Минимум 6 символов\n' +
						'- Должен содержать буквы и цифры\n' +
						'- Можно использовать специальные символы',
				)
				return
			}
			state.password = text
			this.registrationStates.set(userId, state)
			await ctx.reply('🔄 Повторите пароль для подтверждения:')
			return
		}

		if (!state.confirmPassword) {
			if (text !== state.password) {
				await ctx.reply('❌ Пароли не совпадают. Попробуйте еще раз')
				return
			}
			state.confirmPassword = text
			this.registrationStates.set(userId, state)

			// Запрашиваем дополнительные данные в зависимости от роли
			if (state.role === 'BUYER') {
				await ctx.reply('📍 Введите адрес фермы размещения скота:')
			} else if (state.role === 'SUPPLIER') {
				await ctx.reply('👤 Введите ваш ИНН:')
			} else if (state.role === 'CARRIER') {
				await ctx.reply('🚛 Введите данные вашего транспорта:')
			}
			return
		}

		// Сохранение всех данных в базе данных
		await this.saveUserData(userId, state)
		await ctx.reply(
			'✅ Регистрация успешно завершена! Вы можете войти в аккаунт.',
		)
		await this.showProfile(ctx, userId)
	}

	private async saveUserData(userId: number, state: any) {
		await this.prisma.user.create({
			data: {
				email: state.email,
				password: state.password, // Не забудьте хешировать пароль перед сохранением
				name: state.name || 'Не указано',
				phone: state.phone || 'Не указано',
				address: state.address || 'Не указано',
				role: state.role,
				telegramId: userId.toString(),
			},
		})
	}

	public async showProfile(ctx: Context, userId: number) {
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (user) {
			await ctx.reply(
				`✅ Регистрация успешно завершена! Вы зарегистрированы как ${this.getRoleInRussian(
					user.role,
				)}\n\n` +
					`Ваши данные:\n` +
					`📧 Email: ${user.email}\n` +
					`👤 Организация: ${user.name || 'Не указано'}\n` +
					`📱 Телефон: ${user.phone || 'Не указано'}\n` +
					`📍 Адрес: ${user.address || 'Не указано'}\n\n` +
					`Вы автоматически вошли в аккаунт.\n\n` +
					`Доступные команды:`,
				{
					reply_markup: {
						inline_keyboard: [
							[
								{ text: 'Посмотреть профиль', callback_data: 'profile' },
								{ text: 'Получить помощь', callback_data: 'help' },
							],
							[{ text: 'Выйти из аккаунта', callback_data: 'logout' }],
						],
					},
				},
			)
		}
	}

	private validateEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
		return emailRegex.test(email)
	}

	private validatePassword(password: string): boolean {
		const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W]{6,}$/
		return passwordRegex.test(password)
	}

	getRegistrationState(userId: number) {
		return this.registrationStates.get(userId)
	}

	private getRoleInRussian(role: Role): string {
		switch (role) {
			case 'BUYER':
				return 'покупатель'
			case 'SUPPLIER':
				return 'поставщик'
			case 'CARRIER':
				return 'перевозчик'
			default:
				return 'не указано'
		}
	}

	async handleLogout(ctx: Context, userId: number) {
		await this.prisma.user.update({
			where: { telegramId: userId.toString() },
			data: { telegramId: null },
		})

		await ctx.reply(
			'✅ Вы успешно вышли из аккаунта.\n' +
				'Для входа используйте команду /start',
		)
	}
}
