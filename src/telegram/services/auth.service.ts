import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Role } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Context } from 'telegraf'
import { PrismaService } from '../../prisma.service'
import { RegistrationState } from './registration-state.interface'

@Injectable()
export class TelegramAuthService {
	private registrationStates: Map<number, RegistrationState> = new Map()
	private loginStates: Map<number, { email?: string; password?: string }> =
		new Map()

	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService,
	) {}

	async handleRegistration(
		ctx: Context,
		userId: number,
		text: string,
	): Promise<boolean> {
		const state = this.registrationStates.get(userId) || {
			role: null,
			email: null,
			password: null,
			confirmPassword: null,
			name: null,
			phone: null,
			address: null,
			inn: null,
		}

		if (!state.role) {
			await ctx.reply('Выберите вашу роль для регистрации:')
			return true
		}

		if (!state.email) {
			if (!(await this.validateEmail(text))) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return true
			}
			state.email = text
			this.registrationStates.set(userId, state)
			await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
			return true
		}

		if (!state.password) {
			if (text.length < 6) {
				await ctx.reply('❌ Пароль должен содержать минимум 6 символов')
				return true
			}
			state.password = text
			this.registrationStates.set(userId, state)
			await ctx.reply('🔄 Повторите пароль:')
			return true
		}

		if (!state.confirmPassword) {
			if (text !== state.password) {
				await ctx.reply('❌ Пароли не совпадают. Попробуйте еще раз')
				return true
			}
			state.confirmPassword = text
			this.registrationStates.set(userId, state)

			if (state.role === 'BUYER') {
				await ctx.reply('📍 Введите адрес фермы размещения скота:')
			} else if (state.role === 'SUPPLIER') {
				await ctx.reply('👤 Введите ваш ИНН:')
			} else if (state.role === 'CARRIER') {
				await ctx.reply('🚛 Введите данные вашего транспорта:')
			}
			return true
		}

		if (state.role === 'BUYER' && !state.address) {
			state.address = text
			this.registrationStates.set(userId, state)
			await ctx.reply('👤 Введите название организации:')
			return true
		}

		if (state.role === 'SUPPLIER' && !state.inn) {
			state.inn = text
			this.registrationStates.set(userId, state)
			await ctx.reply('👤 Введите название организации:')
			return true
		}

		if (!state.name) {
			state.name = text
			this.registrationStates.set(userId, state)
			await ctx.reply('📱 Введите номер телефона:')
			return true
		}

		if (!state.phone) {
			state.phone = text
			this.registrationStates.set(userId, state)
			await ctx.reply('📍 Введите адрес:')
			return true
		}

		if (!state.address) {
			state.address = text
			this.registrationStates.set(userId, state)

			try {
				const hashedPassword = await bcrypt.hash(state.password, 10)
				const user = await this.prisma.user.create({
					data: {
						email: state.email,
						password: hashedPassword,
						name: state.name,
						phone: state.phone,
						address: state.address,
						role: state.role as Role,
						telegramId: userId.toString(),
					},
				})

				const token = this.jwtService.sign({ id: user.id })
				this.registrationStates.delete(userId)
				await ctx.reply(
					`✅ Регистрация успешно завершена!\n\nВаши данные:\n📧 Email: ${state.email}\n👤 Организация: ${state.name}\n📱 Телефон: ${state.phone}\n📍 Адрес: ${state.address}\n\nВаш токен: ${token}`,
				)
				return true
			} catch (error) {
				console.error('Ошибка при регистрации:', error)
				await ctx.reply('❌ Произошла ошибка при регистрации')
				return true
			}
		}

		console.log('Текущее состояние регистрации:', state)
		return false
	}

	async isUserLoggedIn(userId: number): Promise<boolean> {
		const user = await this.getActiveUser(userId)
		return !!user
	}

	async getActiveUser(userId: number) {
		return this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})
	}

	async handleLogin(ctx: Context) {
		const userId = ctx.from.id
		if (await this.isUserLoggedIn(userId)) {
			await ctx.reply('❗️ Вы уже вошли в аккаунт')
			return
		}
		this.loginStates.set(userId, {})
		await ctx.reply('📧 Введите ваш email:')
	}

	async handleLoginState(
		ctx: Context,
		userId: number,
		text: string,
	): Promise<boolean> {
		const state = this.loginStates.get(userId)
		if (!state) return false

		if (!state.email) {
			if (!(await this.validateEmail(text))) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return true
			}
			state.email = text
			this.loginStates.set(userId, state)
			await ctx.reply('🔑 Введите пароль:')
			return true
		}

		if (!state.password) {
			try {
				const user = await this.prisma.user.findUnique({
					where: { email: state.email },
				})
				if (!user) {
					await ctx.reply('❌ Пользователь не найден')
					this.loginStates.delete(userId)
					return true
				}

				const isValidPassword = await bcrypt.compare(text, user.password)
				if (!isValidPassword) {
					await ctx.reply('❌ Неверный пароль')
					this.loginStates.delete(userId)
					return true
				}

				await this.prisma.user.update({
					where: { id: user.id },
					data: { telegramId: userId.toString() },
				})

				this.loginStates.delete(userId)
				const token = this.jwtService.sign({ id: user.id })
				await ctx.reply(`✅ Вы успешно вошли в аккаунт! Ваш токен: ${token}`)
				return true
			} catch (error) {
				console.error('Ошибка при входе:', error)
				await ctx.reply('❌ Произошла ошибка при входе')
				return true
			}
		}
		return false
	}

	async handleLogout(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.getActiveUser(userId)
		if (!user) {
			await ctx.reply('❌ Вы не авторизованы')
			return
		}

		await this.prisma.user.update({
			where: { id: user.id },
			data: { telegramId: null },
		})

		await ctx.reply('✅ Вы успешно вышли из аккаунта')
	}

	async handleRegister(ctx: Context) {
		const userId = ctx.from.id
		this.registrationStates.set(userId, {})
		await ctx.reply('📧 Введите ваш email:\n\n📝 Пример: example@mail.com')
	}

	async validateEmail(email: string): Promise<boolean> {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
		return emailRegex.test(email)
	}

	async handleRegisterWithEmail(ctx: Context, email: string, role: Role) {
		const hashedPassword = await bcrypt.hash('defaultPassword', 10)
		const user = await this.prisma.user.create({
			data: {
				email,
				password: hashedPassword,
				role,
				name: email.split('@')[0],
			},
		})

		const token = this.jwtService.sign({ id: user.id })
		await ctx.reply(`✅ Регистрация успешна! Ваш токен: ${token}`)
	}

	async startRegistration(userId: number, role: Role) {
		console.log(`Начало регистрации для пользователя ${userId} с ролью ${role}`)
		this.registrationStates.set(userId, { role } as RegistrationState)
	}

	getRegistrationState(userId: number) {
		return this.registrationStates.get(userId)
	}
}
