import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Role } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Context } from 'telegraf'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'

interface RegistrationState {
	role: string | null
	userType: string | null
	entityType: string | null
	inputType: string | null
	email: string | null
	name: string | null
	phone: string | null
	address: string | null
	inn: string | null
	ogrn: string | null
	mercuryNumber: string | null
	password: string | null
	buyerType: string | null
}

@Injectable()
export class TelegramAuthService {
	private registrationStates: Map<number, RegistrationState> = new Map()
	private loginStates: Map<number, { email?: string; password?: string }> =
		new Map()

	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService,
		private telegramClient: TelegramClient,
		private configService: ConfigService,
	) {}

	async handleTextInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const state = this.getRegistrationState(userId)

		if (!state) {
			console.log(`Состояние регистрации не найдено для пользователя ${userId}`)
			return
		}

		// Обработка ввода ИНН
		if (state.inputType === 'inn') {
			try {
				const isValid = await this.checkInn(text)
				if (!isValid) {
					await ctx.reply(
						'❌ ИНН не найден или не активен. Попробуйте еще раз:',
					)
					return
				}

				state.inn = text
				state.inputType = 'email'
				this.registrationStates.set(userId, state)
				await ctx.reply('✅ ИНН введен верно! Теперь введите ваш email:')
				return
			} catch (error) {
				console.error('Ошибка при проверке ИНН:', error)
				await ctx.reply(
					'❌ Произошла ошибка при проверке ИНН. Попробуйте еще раз:',
				)
				return
			}
		}

		// Обработка ввода email
		if (state.inputType === 'email') {
			if (!this.validateEmail(text)) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return
			}

			state.email = text
			state.inputType = 'password'
			await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
			this.registrationStates.set(userId, state)
			return
		}

		// Обработка ввода пароля
		if (state.inputType === 'password') {
			if (text.length < 6) {
				await ctx.reply('❌ Пароль должен содержать минимум 6 символов')
				return
			}

			state.password = text
			state.inputType = 'confirmPassword'
			this.registrationStates.set(userId, state)
			await ctx.reply('🔄 Повторите пароль для подтверждения:')
			return
		}

		// Обработка подтверждения пароля
		if (state.inputType === 'confirmPassword') {
			if (text !== state.password) {
				await ctx.reply('❌ Пароли не совпадают. Введите пароль заново:')
				state.inputType = 'password'
				state.password = null
				this.registrationStates.set(userId, state)
				return
			}
			state.inputType = 'name'
			this.registrationStates.set(userId, state)
			await ctx.reply('👤 Введите ваше ФИО:')
			return
		}

		// Обработка ввода имени
		if (state.inputType === 'name') {
			state.name = text
			state.inputType = 'phone'
			await ctx.reply(
				'📱 Введите ваш номер телефона:\n\n📝 Пример: +79991234567',
			)
			this.registrationStates.set(userId, state)
			return
		}

		// Обработка ввода телефона
		if (state.inputType === 'phone') {
			if (!this.validatePhone(text)) {
				await ctx.reply(
					'❌ Неверный формат номера телефона\n\n📝 Пример: +79991234567',
				)
				return
			}

			state.phone = text
			state.inputType = 'mercury'
			await ctx.reply(
				'📋 Введите ваш RU-номер в системе "Меркурий" или нажмите "Пропустить":',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '⏭️ Пропустить', callback_data: 'skip_mercury' }],
						],
					},
				},
			)
			this.registrationStates.set(userId, state)
			return
		}

		// Обработка ввода номера Меркурий
		if (state.inputType === 'mercury') {
			state.mercuryNumber = text
			state.inputType = 'address'
			await ctx.reply('📍 Введите ваш адрес:')
			this.registrationStates.set(userId, state)
			return
		}

		// Обработка ввода адреса
		if (state.inputType === 'address') {
			state.address = text
			await this.completeRegistration(ctx, state)
			return
		}

		// Обработка ИНН/ОГРН
		if (state.entityType === 'ORGANIZATION') {
			if (state.inputType === 'inn') {
				const isValid = await this.checkInn(text)
				if (!isValid) {
					await ctx.reply(
						'❌ ИНН не найден или не активен. Попробуйте еще раз:',
					)
					return
				}
				state.inn = text
				state.inputType = 'email'
				await ctx.reply('✅ ИНН введен верно! Теперь введите ваш email:')
			} else if (state.inputType === 'ogrn') {
				const isValid = await this.checkOgrn(text)
				if (!isValid) {
					await ctx.reply(
						'❌ ОГРН не найден или не активен. Попробуйте еще раз:',
					)
					return
				}
				state.ogrn = text
				state.inputType = 'email'
				await ctx.reply('✅ ОГРН введен верно! Теперь введите ваш email:')
			}
		}

		this.registrationStates.set(userId, state)
	}

	private async handleEmailInput(ctx: Context, text: string, state: any) {
		if (!(await this.validateEmail(text))) {
			await ctx.reply('❌ Неверный формат email\n\n📝 Пример: example@mail.com')
			return
		}
		state.email = text
		state.inputType = 'password'
		await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
	}

	private async handleNameInput(ctx: Context, text: string, state: any) {
		state.name = text
		state.inputType = 'phone'
		await ctx.reply('📱 Введите ваш номер телефона в формате +7XXXXXXXXXX:')
	}

	private async handlePhoneInput(ctx: Context, text: string, state: any) {
		if (!this.validatePhone(text)) {
			await ctx.reply(
				'❌ Неверный формат номера телефона\n\n📝 Пример: +79991234567',
			)
			return
		}
		state.phone = text
		state.inputType = 'mercury'
		await ctx.reply(
			'📋 Введите ваш RU-номер в системе "Меркурий" или нажмите "Пропустить":',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '⏭️ Пропустить', callback_data: 'skip_mercury' }],
					],
				},
			},
		)
	}

	private async handleMercuryInput(ctx: Context, text: string, state: any) {
		state.mercuryNumber = text
		state.inputType = 'address'
		await ctx.reply('📍 Введите адрес:')
	}

	private async handleAddressInput(ctx: Context, text: string, state: any) {
		state.address = text
		await this.completeRegistration(ctx, state)
	}

	private async completeRegistration(ctx: Context, state: any) {
		const userId = ctx.from.id

		try {
			// Хешируем пароль
			const hashedPassword = await bcrypt.hash(state.password, 5)

			// Создаем пользователя напрямую
			const user = await this.prisma.user.create({
				data: {
					email: state.email,
					name: state.name,
					phone: state.phone,
					address: state.address,
					password: hashedPassword,
					role: state.role.toUpperCase(),
					inn: state.inn,
					ogrn: state.ogrn,
					mercuryNumber: state.mercuryNumber,
					isVerified: false,
					telegramId: userId.toString(),
				},
			})

			await ctx.reply(
				'✅ Регистрация успешно завершена!\n\n' +
					'Ваша заявка отправлена на рассмотрение администратору.\n' +
					'После подтверждения вы получите уведомление и сможете войти в систему.',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '« На главную', callback_data: 'start' }],
						],
					},
				},
			)

			// Очищаем состояние регистрации
			this.registrationStates.delete(userId)
		} catch (error) {
			console.error('Ошибка при регистрации:', error)
			await ctx.reply('❌ Произошла ошибка при регистрации. Попробуйте позже.')
		}
	}

	private validatePhone(phone: string): boolean {
		const phoneRegex = /^\+?[0-9]{10,15}$/
		return phoneRegex.test(phone)
	}

	private async checkInn(inn: string): Promise<boolean> {
		try {
			// Проверяем формат ИНН
			const innRegex = /^\d{10}$|^\d{12}$/
			if (!innRegex.test(inn)) {
				return false
			}

			const apiKey = this.configService.get('DATANEWTON_API_KEY')
			const url = `https://api.datanewton.ru/v1/counterparty?key=${apiKey}&inn=${inn}`

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
		} catch (error) {
			console.error('Ошибка при проверке ИНН через API:', error)
			throw error
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

	public getRegistrationState(userId: number) {
		const state = this.registrationStates.get(userId)
		console.log(
			`Получено состояние для пользователя ${userId}: ${JSON.stringify(state)}`,
		)
		return state
	}

	public setRole(userId: number, role: string) {
		const state = this.getRegistrationState(userId)
		state.role = role
		this.registrationStates.set(userId, state)
	}

	async handleRegister(ctx: Context) {
		const userId = ctx.from.id
		this.registrationStates.set(userId, {
			role: null,
			userType: null,
			entityType: null,
			inputType: null,
			email: null,
			name: null,
			phone: null,
			address: null,
			inn: null,
			ogrn: null,
			mercuryNumber: null,
			password: null,
			buyerType: null,
		})
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
			role: null,
			userType: null,
			entityType: null,
			inputType: null,
			email: null,
			name: null,
			phone: null,
			address: null,
			inn: null,
			ogrn: null,
			mercuryNumber: null,
			password: null,
			buyerType: null,
		})
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
		await ctx.reply(
			'Чтобы продолжить использовать бота, используйте команду /start',
		)
	}

	async getActiveUser(userId: number) {
		return this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})
	}

	async handleRoleSelection(ctx: Context, role: string) {
		const userId = ctx.from.id
		let state = this.registrationStates.get(userId)

		if (!state) {
			await this.startRegistration(userId)
			state = this.registrationStates.get(userId)
		}

		state.role = role.toUpperCase()

		if (role === 'BUYER') {
			await ctx.reply('Выберите тип покупателя:', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '👤 Частное лицо',
								callback_data: 'user_type_individual',
							},
							{ text: '🏠 КФХ', callback_data: 'user_type_farm' },
						],
						[
							{
								text: '🏭 С/х предприятие',
								callback_data: 'user_type_agricultural',
							},
							{
								text: '🏢 Мясокомбинат',
								callback_data: 'user_type_meat_factory',
							},
						],
						[
							{
								text: '🚜 Откормочная площадка',
								callback_data: 'user_type_feedlot',
							},
							{
								text: '📋 Участник гранта',
								callback_data: 'user_type_grant_member',
							},
						],
					],
				},
			})
		} else if (role === 'SUPPLIER') {
			await ctx.reply('Выберите тип поставщика:', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '👤 Частное лицо',
								callback_data: 'user_type_individual',
							},
							{ text: '🏠 КФХ', callback_data: 'user_type_farm' },
						],
						[
							{
								text: '🏭 С/х предприятие',
								callback_data: 'user_type_agricultural',
							},
						],
					],
				},
			})
		}

		this.registrationStates.set(userId, state)
	}

	async handleUserTypeSelection(ctx: Context, userType: string) {
		const userId = ctx.from.id
		let state = this.registrationStates.get(userId)

		if (!state) {
			await this.startRegistration(userId)
			state = this.registrationStates.get(userId)
		}

		state.userType = userType
		state.entityType = userType
		this.registrationStates.set(userId, state)

		if (userType === 'individual') {
			// Для физических лиц сразу переходим к вводу email
			state.inputType = 'email'
			this.registrationStates.set(userId, state)
			await ctx.reply('📧 Введите ваш email:\n\n📝 Пример: example@mail.com')
			return
		}

		// Для организаций оставляем прежнюю логику
		await ctx.reply('Введите ваш ИНН или ОГРН:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '📝 Ввести ИНН', callback_data: 'input_inn' },
						{ text: '📋 Ввести ОГРН', callback_data: 'input_ogrn' },
					],
				],
			},
		})

		this.registrationStates.set(userId, state)
	}

	public setBuyerType(userId: number, buyerType: string) {
		const state = this.getRegistrationState(userId)
		if (state) {
			state.buyerType = buyerType
			this.registrationStates.set(userId, state)
		}
	}

	public async isUserLoggedIn(userId: number): Promise<boolean> {
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})
		return user !== null // Если пользователь найден, значит он вошел в систему
	}

	public setEntityType(userId: number, entityType: string) {
		const state = this.getRegistrationState(userId)
		if (state) {
			state.entityType = entityType
			this.registrationStates.set(userId, state)
		}
	}

	async handleLoginInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const loginState = this.loginStates.get(userId)

		if (!loginState) {
			await ctx.reply('❌ Сессия входа истекла. Пожалуйста, начните заново.')
			return
		}

		if (!loginState.email) {
			if (!this.validateEmail(text)) {
				await ctx.reply('❌ Неверный формат email. Попробуйте еще раз.')
				return
			}

			const user = await this.prisma.user.findUnique({
				where: { email: text },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден. Проверьте email.')
				return
			}

			if (!user.isVerified) {
				// Очищаем состояние входа
				this.loginStates.delete(userId)

				await ctx.reply(
					'⏳ Ваш аккаунт еще не подтвержден администратором.\n\n' +
						'Пожалуйста, дождитесь подтверждения. Вы получите уведомление, когда ваш аккаунт будет активирован.\n\n' +
						'Используйте команду /start чтобы вернуться в главное меню.',
				)
				return
			}

			loginState.email = text
			this.loginStates.set(userId, loginState)
			await ctx.reply('🔑 Введите пароль:')
			return
		}

		if (!loginState.password) {
			try {
				const user = await this.prisma.user.findUnique({
					where: { email: loginState.email },
				})

				if (!user) {
					throw new Error('Пользователь не найден')
				}

				const isPasswordValid = await bcrypt.compare(text, user.password)
				if (!isPasswordValid) {
					throw new Error('Неверный пароль')
				}

				// Обновляем telegramId пользователя
				await this.prisma.user.update({
					where: { email: loginState.email },
					data: { telegramId: userId.toString() },
				})

				await ctx.reply('✅ Вход выполнен успешно!')
				await ctx.reply('Выберите нужное действие:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '📝 Создать объявление', callback_data: 'create_ad' },
								{ text: '📋 Мои объявления', callback_data: 'my_ads' },
							],
							[
								{ text: '❓ Помощь', callback_data: 'help' },
								{ text: '🚪 Выйти', callback_data: 'logout' },
							],
							[{ text: '🏠 Главное меню', callback_data: 'menu' }],
						],
					},
				})
			} catch (error) {
				await ctx.reply('❌ Неверный email или пароль')
			} finally {
				this.loginStates.delete(userId)
			}
		}
	}

	async initLoginState(userId: number) {
		console.log('Инициализация состояния входа для пользователя:', userId)
		this.loginStates.set(userId, {})
	}

	async notifyAdminsAboutRegistration(registrationRequest: any) {
		// Реализация метода для уведомления администраторов о новой заявке
	}

	async approveRegistration(registrationId: string) {
		const registration = await this.prisma.registrationRequest.findUnique({
			where: { id: registrationId },
		})

		if (!registration) {
			throw new NotFoundException('Заявка на регистрацию не найдена')
		}

		// Создаем пользователя с хешированным паролем из заявки
		const user = await this.prisma.user.create({
			data: {
				email: registration.email,
				name: registration.name,
				phone: registration.phone,
				address: registration.address,
				password: registration.password, // Пароль уже хешированный
				role: registration.role,
				isVerified: true,
				inn: registration.inn,
				ogrn: registration.ogrn,
				mercuryNumber: registration.mercuryNumber,
			},
		})

		// Помечаем заявку как обработанную
		await this.prisma.registrationRequest.update({
			where: { id: registrationId },
			data: { isProcessed: true },
		})

		return user
	}

	async setInputType(ctx: Context, inputType: string) {
		const userId = ctx.from.id
		const state = this.getRegistrationState(userId)

		if (!state) return

		state.inputType = inputType
		this.registrationStates.set(userId, state)

		if (inputType === 'inn') {
			await ctx.reply('📝 Введите ваш ИНН:')
		} else if (inputType === 'ogrn') {
			await ctx.reply('📋 Введите ваш ОГРН:')
		}
	}

	async handleSkipMercury(ctx: Context) {
		const userId = ctx.from.id
		const state = this.getRegistrationState(userId)

		if (!state) {
			await ctx.reply(
				'❌ Состояние регистрации не найдено. Пожалуйста, начните регистрацию заново.',
			)
			return
		}

		// Устанавливаем состояние, что номер в системе "Меркурий" пропущен
		state.mercuryNumber = null
		state.inputType = 'address' // Переход к следующему шагу
		this.registrationStates.set(userId, state)

		await ctx.reply('📍 Введите адрес:')
	}
}
