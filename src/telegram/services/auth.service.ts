import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Role } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Context } from 'telegraf'
import { Message } from 'telegraf/types'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'

@Injectable()
export class TelegramAuthService {
	private registrationStates: Map<number, any> = new Map()
	private loginStates: Map<number, { email?: string; password?: string }> =
		new Map()

	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService,
		private telegramClient: TelegramClient,
		private configService: ConfigService,
	) {}

	async handleRegistration(
		ctx: Context,
		userId: number,
		text: string,
	): Promise<boolean> {
		const state = this.registrationStates.get(userId)
		if (!state) return false

		// Проверка ИНН если выбран тип пользователя
		if (state.userType && !state.inn) {
			if (!/^\d{10}$|^\d{12}$/.test(text)) {
				await ctx.reply('❌ Неверный формат ИНН. Введите 10 или 12 цифр.')
				return true
			}

			try {
				const isValid = await this.checkInn(text)
				if (!isValid) {
					await ctx.reply('❌ ИНН не найден или неактивен. Попробуйте еще раз:')
					return true
				}

				state.inn = text
				state.currentStep = 'email'
				this.registrationStates.set(userId, state)

				// После успешной проверки ИНН запрашиваем email
				await ctx.reply('📧 Введите ваш email:\n\n📝 Пример: example@mail.com')
				return true
			} catch (error) {
				console.error('Ошибка при проверке ИНН:', error)
				await ctx.reply(
					'❌ Произошла ошибка при проверке ИНН. Попробуйте еще раз.',
				)
				return true
			}
		}

		// Обработка email
		if (state.currentStep === 'email' && !state.email) {
			if (!(await this.validateEmail(text))) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return true
			}
			state.email = text
			state.currentStep = 'password'
			this.registrationStates.set(userId, state)
			await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
			return true
		}

		// Обработка пароля
		if (state.currentStep === 'password' && !state.password) {
			if (text.length < 6) {
				await ctx.reply('❌ Пароль должен содержать минимум 6 символов')
				return true
			}
			state.password = text
			state.currentStep = 'confirmPassword'
			this.registrationStates.set(userId, state)
			await ctx.reply('🔄 Повторите пароль для подтверждения:')
			return true
		}

		// Добавляем обработку подтверждения пароля
		if (state.currentStep === 'confirmPassword') {
			if (text !== state.password) {
				await ctx.reply('❌ Пароли не совпадают. Введите пароль заново:')
				state.password = null
				state.currentStep = 'password'
				this.registrationStates.set(userId, state)
				return
			}

			state.currentStep = 'name'
			this.registrationStates.set(userId, state)
			await ctx.reply('👤 Введите ваше ФИО:')
			return true
		}

		// Обработка имени
		if (state.currentStep === 'name' && !state.name) {
			state.name = text
			state.currentStep = 'phone'
			this.registrationStates.set(userId, state)
			await ctx.reply('📱 Введите ваш номер телефона в формате +7XXXXXXXXXX:')
			return true
		}

		// Обработка телефона
		if (state.currentStep === 'phone' && !state.phone) {
			if (!this.validatePhone(text)) {
				await ctx.reply(
					'❌ Неверный формат номера телефона\n\n📝 Пример: +79991234567',
				)
				return true
			}
			state.phone = text
			state.currentStep = 'address'
			this.registrationStates.set(userId, state)
			await ctx.reply('📍 Введите адрес:')
			return true
		}

		// Обработка адреса
		if (state.currentStep === 'address' && !state.address) {
			state.address = text

			try {
				// Создаем запрос на регистрацию с опциональными полями
				await this.prisma.registrationRequest.create({
					data: {
						email: state.email,
						name: state.name,
						phone: state.phone,
						address: state.address,
						inn: state.inn,
						role: state.role as Role,
						userType: state.userType,
						ogrn: null, // Добавляем null для опциональных полей
						mercuryNumber: null, // Добавляем null для опциональных полей
					},
				})

				await ctx.reply(
					'✅ Ваша заявка на регистрацию отправлена на модерацию. Ожидайте подтверждения.',
				)
				this.registrationStates.delete(userId)
			} catch (error) {
				console.error('Ошибка при регистрации:', error)
				await ctx.reply('❌ Произошла ошибка при регистрации')
			}
			return true
		}

		return false
	}

	private validatePhone(phone: string): boolean {
		const phoneRegex = /^\+?[0-9]{10,15}$/ // Пример: +79991234567
		return phoneRegex.test(phone)
	}

	private async checkInn(inn: string): Promise<boolean> {
		const apiKey = this.configService.get('DATANEWTON_API_KEY')
		const url = `https://api.datanewton.ru/v1/counterparty?key=${apiKey}&inn=${inn}`

		const response = await fetch(url)
		const data = await response.json()

		if (data.code === 1) {
			console.error('Контрагент не найден:', data.message)
			return false
		}

		// Проверяем наличие данных о компании
		if (data && data.company && data.company.company_names) {
			if (data.company.status && data.company.status.active_status) {
				return true // ИНН валиден
			} else {
				console.error('Компания не активна:', data.company.status)
				return false // Компания не активна
			}
		} else {
			console.error('Неизвестный ответ от API:', data)
			return false
		}
	}

	private async checkOgrn(ogrn: string): Promise<boolean> {
		const apiKey = this.configService.get('DATANEWTON_API_KEY')
		const url = `https://api.datanewton.ru/v1/counterparty?key=${apiKey}&ogrn=${ogrn}`

		const response = await fetch(url)
		const data = await response.json()
		if (data.code === 1) {
			console.error('Контрагент не найден:', data.message)
			return false
		}

		if (data && data.company && data.company.company_names) {
			return data.company.status && data.company.status.active_status
		} else {
			console.error('Неизвестный ответ от API:', data)
			return false
		}
	}

	async isUserLoggedIn(userId: number): Promise<boolean> {
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		return !!user // Возвращает true, если пользователь найден
	}

	async getActiveUser(userId: number) {
		return this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})
	}

	async handleLogin(ctx: Context) {
		const userId = ctx.from.id
		const loginState = this.loginStates.get(userId)

		if (!loginState) {
			await ctx.reply(
				'❌ Вы не находитесь в процессе входа. Пожалуйста, начните заново.',
			)
			return
		}

		const message = ctx.message as Message.TextMessage

		if (!loginState.email) {
			// Сохраняем email
			loginState.email = message.text
			this.loginStates.set(userId, loginState)
			await ctx.reply('🔑 Введите ваш пароль:')
			return
		}

		if (!loginState.password) {
			// Сохраняем пароль и пытаемся войти
			loginState.password = message.text

			const loginResult = await this.login({
				email: loginState.email,
				password: loginState.password,
			})

			if (loginResult.success) {
				await this.telegramClient.handleMenu(ctx)
				this.deleteLoginState(userId)
			} else {
				await ctx.reply(`❌ ${loginResult.message}`)
				this.deleteLoginState(userId)
			}
			return
		}
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

	async startRegistration(userId: number) {
		this.registrationStates.set(userId, {
			inputType: null,
			userType: null,
			inn: null,
			ogrn: null,
		})
	}

	public async getRegistrationState(userId: number) {
		return this.registrationStates.get(userId)
	}

	async handleRoleSelection(ctx: Context, role: string) {
		const userId = ctx.from.id
		const state = this.registrationStates.get(userId) || {}
		state.role = role
		this.registrationStates.set(userId, state)
	}

	async handleUserTypeSelection(ctx: Context, userType: string) {
		const userId = ctx.from.id
		const state = this.registrationStates.get(userId) || {}
		state.userType = userType
		this.registrationStates.set(userId, state)

		if (userType === 'individual') {
			await ctx.reply('📝 Введите ваш ИНН:')
		} else {
			await ctx.reply('Выберите что хотите ввести:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '📝 ИНН', callback_data: 'input_inn' },
							{ text: '📋 ОГРН', callback_data: 'input_ogrn' },
						],
					],
				},
			})
		}
	}

	async handleTextInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const loginState = this.loginStates.get(userId)

		if (loginState) {
			await this.handleLogin(ctx)
			return
		}

		const state = this.registrationStates.get(userId)

		if (!state) {
			return
		}

		// Если ожидаем ИНН/ОГРН
		if (state.userType && !state.inn && !state.ogrn) {
			if (state.inputType === 'inn') {
				// Проверяем формат ИНН
				const innPattern =
					state.userType === 'individual' ? /^\d{12}$/ : /^\d{10}$/
				if (!innPattern.test(text)) {
					await ctx.reply(
						state.userType === 'individual'
							? '❌ Неверный формат ИНН. Для физических лиц требуется 12 цифр.'
							: '❌ Неверный формат ИНН. Для организаций требуется 10 цифр.',
					)
					return
				}

				try {
					const isValidInn = await this.checkInn(text)
					if (!isValidInn) {
						await ctx.reply(
							'❌ ИНН не найден или не активен. Попробуйте еще раз:',
						)
						return
					}

					state.inn = text
					state.currentStep = 'email'
					this.registrationStates.set(userId, state)
					console.log(`Пользователь ${userId} ввел ИНН: ${text}`)

					await ctx.reply('✅ ИНН введен верно! Теперь введите ваш email:')
					await ctx.reply(
						'📧 Введите ваш email:\n\n📝 Пример: example@mail.com',
					)
					return
				} catch (error) {
					console.error('Ошибка при проверке ИНН:', error)
					await ctx.reply(
						'❌ Произошла ошибка при проверке ИНН. Попробуйте еще раз:',
					)
					return
				}
			} else if (state.inputType === 'ogrn') {
				// Проверяем формат ОГРН (13 цифр)
				if (!/^\d{13}$/.test(text)) {
					await ctx.reply('❌ Неверный формат ОГРН. Требуется 13 цифр.')
					return
				}

				try {
					const isValidOgrn = await this.checkOgrn(text)
					if (!isValidOgrn) {
						await ctx.reply(
							'❌ ОГРН не найден или не активен. Попробуйте еще раз:',
						)
						return
					}

					state.ogrn = text
					state.currentStep = 'email'
					this.registrationStates.set(userId, state)
					console.log(`Пользователь ${userId} ввел ОГРН: ${text}`)

					await ctx.reply('✅ ОГРН введен верно! Теперь введите ваш email:')
					await ctx.reply(
						'📧 Введите ваш email:\n\n📝 Пример: example@mail.com',
					)
					return
				} catch (error) {
					console.error('Ошибка при проверке ОГРН:', error)
					await ctx.reply(
						'❌ Произошла ошибка при проверке ОГРН. Попробуйте еще раз:',
					)
					return
				}
			}
		}

		// Обработка email
		if (state.currentStep === 'email' && !state.email) {
			if (!(await this.validateEmail(text))) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return
			}
			state.email = text
			state.currentStep = 'password'
			this.registrationStates.set(userId, state)
			await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
			return
		}

		// Обработка пароля
		if (state.currentStep === 'password' && !state.password) {
			if (text.length < 6) {
				await ctx.reply('❌ Пароль должен содержать минимум 6 символов')
				return
			}
			state.password = text
			state.currentStep = 'confirmPassword'
			this.registrationStates.set(userId, state)
			await ctx.reply('🔄 Повторите пароль для подтверждения:')
			return
		}

		// Добавляем обработку подтверждения пароля
		if (state.currentStep === 'confirmPassword') {
			if (text !== state.password) {
				await ctx.reply('❌ Пароли не совпадают. Введите пароль заново:')
				state.password = null
				state.currentStep = 'password'
				this.registrationStates.set(userId, state)
				return
			}

			state.currentStep = 'name'
			this.registrationStates.set(userId, state)
			await ctx.reply('👤 Введите ваше ФИО:')
			return
		}

		// Обработка имени
		if (state.currentStep === 'name' && !state.name) {
			state.name = text
			state.currentStep = 'phone'
			this.registrationStates.set(userId, state)
			await ctx.reply('📱 Введите ваш номер телефона в формате +7XXXXXXXXXX:')
			return
		}

		// Обработка телефона
		if (state.currentStep === 'phone' && !state.phone) {
			if (!this.validatePhone(text)) {
				await ctx.reply(
					'❌ Неверный формат номера телефона. Введите в формате +7XXXXXXXXXX',
				)
				return
			}
			state.phone = text
			state.currentStep = 'mercury'
			this.registrationStates.set(userId, state)
			await ctx.reply('📋 Введите ваш RU-номер в системе "Меркурий":')
			return
		}

		// Обработка номера в системе "Меркурий"
		if (state.currentStep === 'mercury' && !state.mercuryNumber) {
			state.mercuryNumber = text
			state.currentStep = 'location'
			this.registrationStates.set(userId, state)
			await ctx.reply('📍 Введите адрес фермы размещения скота:')
			return
		}

		// Обработка адреса фермы
		if (state.currentStep === 'location' && !state.location) {
			state.location = text
			state.currentStep = 'complete'
			this.registrationStates.set(userId, state)

			// Завершение регистрации
			try {
				await this.completeRegistration(ctx, state)
				this.registrationStates.delete(userId) // Очищаем состояние после успешной регистрации
			} catch (error) {
				console.error('Ошибка при завершении регистрации:', error)
				await ctx.reply(
					'❌ Произошла ошибка при регистрации. Попробуйте еще раз.',
				)
			}
			return
		}
	}

	private async completeRegistration(ctx: Context, state: any) {
		try {
			const user = await this.prisma.user.create({
				data: {
					email: state.email,
					password: await bcrypt.hash(state.password, 10),
					phone: state.phone,
					mercuryNumber: state.mercuryNumber,
					address: state.location,
					inn: state.inn,
					ogrn: state.ogrn,
					role: state.role,
					name: state.name || 'Не указано',
					telegramId: ctx.from.id.toString(),
				},
			})

			await ctx.reply('✅ Регистрация успешно завершена!')
		} catch (error) {
			console.error('Ошибка при завершении регистрации:', error)
			await ctx.reply(
				'❌ Произошла ошибка при регистрации. Попробуйте еще раз.',
			)
		}
	}

	public getLoginState(userId: number) {
		return this.loginStates.get(userId)
	}

	public setLoginState(
		userId: number,
		state: { email?: string; password?: string },
	) {
		this.loginStates.set(userId, state)
	}

	public deleteLoginState(userId: number) {
		this.loginStates.delete(userId)
	}

	async login(loginDto: { email: string; password: string }) {
		console.log('Login attempt:', loginDto)

		if (!loginDto.email || !loginDto.password) {
			return { success: false, message: 'Email и пароль обязательны' }
		}

		const user = await this.prisma.user.findUnique({
			where: { email: loginDto.email },
		})

		if (!user) {
			return { success: false, message: 'Пользователь не найден' }
		}

		const isPasswordValid = await bcrypt.compare(
			loginDto.password,
			user.password,
		)
		if (!isPasswordValid) {
			return { success: false, message: 'Неверный пароль' }
		}

		if (!user.isVerified) {
			return { success: false, message: 'Аккаунт не подтвержден' }
		}

		return { success: true, user }
	}
}
