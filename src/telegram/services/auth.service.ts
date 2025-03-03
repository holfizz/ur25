import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { BuyerType, Role } from '@prisma/client'
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

// Добавляем интерфейс для состояния авторизации
interface AuthState {
	step?: string
	role?: 'BUYER' | 'SUPPLIER' | 'CARRIER'
	inputType?: string
	email?: string
	password?: string
	name?: string
	phone?: string
	address?: string
	buyerType?: string
}

interface LoginState {
	email: string | null
	password: string | null
	step: 'email' | 'password'
}

@Injectable()
export class TelegramAuthService {
	private registrationStates: Map<number, RegistrationState> = new Map()
	private loginStates: Map<number, LoginState> = new Map()
	private authStates = new Map<number, AuthState>()

	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService,
		private telegramClient: TelegramClient,
		private configService: ConfigService,
	) {}

	async handleTextInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const state = this.registrationStates.get(userId)

		if (!state) {
			console.log(`Состояние регистрации не найдено для пользователя ${userId}`)
			return
		}

		// Обработка ввода ИНН
		if (state.inputType === 'inn') {
			try {
				// Базовая валидация ИНН
				if (text.length !== 10 && text.length !== 12) {
					await ctx.reply(
						'❌ ИНН должен содержать 10 или 12 цифр. Попробуйте еще раз:',
					)
					return
				}

				// Проверка ИНН через API Newton
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
				await ctx.reply(
					'✅ ИНН проверен и подтвержден! Теперь введите ваш email:',
				)
				return
			} catch (error) {
				console.error('Ошибка при проверке ИНН:', error)
				await ctx.reply(
					'❌ Произошла ошибка при проверке ИНН. Попробуйте еще раз:',
				)
				return
			}
		}

		// Обработка ввода ОГРН
		if (state.inputType === 'ogrn') {
			try {
				// Базовая валидация ОГРН
				if (text.length !== 13 && text.length !== 15) {
					await ctx.reply(
						'❌ ОГРН должен содержать 13 или 15 цифр. Попробуйте еще раз:',
					)
					return
				}

				// Проверка ОГРН через API Newton
				const isValid = await this.checkOgrn(text)
				if (!isValid) {
					await ctx.reply(
						'❌ ОГРН не найден или не активен. Попробуйте еще раз:',
					)
					return
				}

				state.ogrn = text
				state.inputType = 'email'
				this.registrationStates.set(userId, state)
				await ctx.reply(
					'✅ ОГРН проверен и подтвержден! Теперь введите ваш email:',
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
							[{ text: '⏩ Пропустить', callback_data: 'skip_mercury_reg' }],
							[{ text: '« Отмена', callback_data: 'menu' }],
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
			if (text.length < 5) {
				await ctx.reply('❌ Адрес должен содержать минимум 5 символов')
				return
			}

			state.address = text

			try {
				// Хешируем пароль перед сохранением
				const hashedPassword = await bcrypt.hash(state.password, 10)

				// Проверяем, что buyerType является допустимым значением BuyerType
				let buyerType = state.buyerType as BuyerType

				// Создаем пользователя в базе данных
				await this.prisma.user.create({
					data: {
						email: state.email,
						password: hashedPassword,
						name: state.name,
						phone: state.phone,
						address: state.address,
						role: state.role as Role,
						telegramId: userId.toString(),
						mercuryNumber: state.mercuryNumber,
						buyerType: buyerType,
						isVerified: false, // Важно: устанавливаем isVerified в false
					},
				})

				// Очищаем состояние регистрации
				this.registrationStates.delete(userId)

				// Отправляем сообщение об ожидании модерации
				await ctx.reply(
					'✅ Регистрация успешно завершена!\n\n' +
						'Ваша заявка отправлена на модерацию. ' +
						'После проверки администратором вы получите уведомление и сможете войти в систему.',
					{
						reply_markup: {
							inline_keyboard: [
								[{ text: '🔑 Войти', callback_data: 'login' }],
								[{ text: '« На главную', callback_data: 'start' }],
							],
						},
					},
				)
			} catch (error) {
				console.error('Ошибка при создании пользователя:', error)
				await ctx.reply(
					'❌ Произошла ошибка при регистрации. Попробуйте позже.',
				)
			}
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
						[{ text: '⏩ Пропустить', callback_data: 'skip_mercury_reg' }],
						[{ text: '« Отмена', callback_data: 'menu' }],
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
			const hashedPassword = await bcrypt.hash(state.password, 10)

			// Создаем пользователя напрямую
			const user = await this.prisma.user.create({
				data: {
					email: state.email,
					password: hashedPassword,
					name: state.name,
					phone: state.phone,
					address: state.address,
					role: state.role.toUpperCase(),
					telegramId: userId.toString(),
					mercuryNumber: state.mercuryNumber,
					buyerType: state.buyerType as BuyerType,
					isVerified: false,
				},
			})

			// Очищаем состояние регистрации
			this.registrationStates.delete(userId)

			// Отправляем сообщение об успешной регистрации
			await ctx.reply(
				'✅ Регистрация успешно завершена!\n\n' +
					'Ваша заявка отправлена на модерацию. ' +
					'После проверки администратором вы получите уведомление и сможете войти в систему.',
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '🔑 Войти', callback_data: 'login' }],
							[{ text: '« На главную', callback_data: 'start' }],
						],
					},
				},
			)

			// Уведомляем администраторов о новой регистрации
			await this.notifyAdminsAboutRegistration(user)
		} catch (error) {
			console.error('Ошибка при создании пользователя:', error)
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
		try {
			// Проверяем формат ОГРН
			const ogrnRegex = /^\d{13}$|^\d{15}$/
			if (!ogrnRegex.test(ogrn)) {
				return false
			}

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
		} catch (error) {
			console.error('Ошибка при проверке ОГРН через API:', error)
			throw error
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
		const initialState: AuthState = {
			step: 'role',
			inputType: null,
			email: null,
			password: null,
			name: null,
			phone: null,
			address: null,
			role: null,
			buyerType: null,
		}
		this.authStates.set(userId, initialState)
		return initialState
	}

	public getLoginState(userId: number) {
		return this.loginStates.get(userId)
	}

	public setLoginState(userId: number, state: Partial<LoginState>) {
		const currentState = this.loginStates.get(userId) || {
			email: null,
			password: null,
			step: 'email',
		}

		this.loginStates.set(userId, {
			...currentState,
			...state,
		})
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
		try {
			const userId = ctx.from.id

			// Инициализируем состояние, если его нет
			if (!this.registrationStates.has(userId)) {
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

			const state = this.registrationStates.get(userId)
			console.log('Current state:', state) // Добавим лог для отладки

			// Преобразуем роль в правильный формат
			let userRole: 'BUYER' | 'SUPPLIER' | 'CARRIER'
			switch (role.toUpperCase()) {
				case 'BUYER':
					userRole = 'BUYER'
					break
				case 'SUPPLIER':
					userRole = 'SUPPLIER'
					break
				case 'CARRIER':
					userRole = 'CARRIER'
					break
				default:
					await ctx.reply('❌ Некорректная роль')
					return
			}

			// Сохраняем роль в состоянии
			state.role = userRole
			this.registrationStates.set(userId, state)
			console.log('Updated state:', this.registrationStates.get(userId)) // Добавим лог для отладки

			// Запрашиваем тип организации в зависимости от роли
			if (userRole === 'BUYER') {
				await ctx.reply('Выберите тип организации:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '👤 Частное лицо', callback_data: 'user_type_PRIVATE' },
								{ text: '🏡 КФХ', callback_data: 'user_type_FARM' },
							],
							[
								{
									text: '🏭 С/х предприятие',
									callback_data: 'user_type_AGRICULTURAL',
								},
								{
									text: '🏢 Мясокомбинат',
									callback_data: 'user_type_MEAT_FACTORY',
								},
							],
							[
								{
									text: '🐄 Откормочная площадка',
									callback_data: 'user_type_FEEDLOT',
								},
								{
									text: '📋 Участник гранта',
									callback_data: 'user_type_GRANT_MEMBER',
								},
							],
						],
					},
				})
			} else if (userRole === 'SUPPLIER') {
				await ctx.reply('Выберите тип поставщика:', {
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: '👤 Физическое лицо',
									callback_data: 'supplier_type_individual',
								},
								{
									text: '🏢 Организация',
									callback_data: 'supplier_type_organization',
								},
							],
						],
					},
				})
			} else {
				// Для перевозчиков сразу запрашиваем email
				state.inputType = 'email'
				this.registrationStates.set(userId, state)
				await ctx.reply('📧 Введите ваш email:')
			}
		} catch (error) {
			console.error('Ошибка при выборе роли:', error)
			await ctx.reply('❌ Произошла ошибка при выборе роли')
		}
	}

	// Добавим новый обработчик для типа поставщика
	async handleSupplierTypeSelection(ctx: Context, type: string) {
		try {
			const userId = ctx.from.id
			const state = this.registrationStates.get(userId)

			if (!state) {
				await ctx.reply('❌ Пожалуйста, начните регистрацию заново')
				return
			}

			state.entityType = type
			this.registrationStates.set(userId, state)

			if (type === 'INDIVIDUAL') {
				// Для физ.лиц сразу переходим к вводу ИНН
				state.inputType = 'inn'
				await ctx.reply(
					'📝 Введите ваш ИНН:\n\n' +
						'ИНН должен содержать 12 цифр\n' +
						'Пример: 500100732259',
				)
			} else if (type === 'ORGANIZATION') {
				// Для организаций даем выбор между ИНН и ОГРН
				await ctx.reply('Выберите тип идентификатора:', {
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
		} catch (error) {
			console.error('Ошибка при выборе типа поставщика:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
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
		try {
			const userId = ctx.from.id
			const loginState = this.getLoginState(userId)

			if (!loginState) return

			if (loginState.step === 'email') {
				if (!this.validateEmail(text)) {
					await ctx.reply(
						'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
					)
					return
				}

				const user = await this.prisma.user.findUnique({
					where: { email: text },
				})

				if (!user) {
					await ctx.reply('❌ Пользователь с таким email не найден')
					this.clearLoginState(userId)
					return
				}

				this.setLoginState(userId, { email: text, step: 'password' })
				await ctx.reply('🔑 Введите пароль:')
				return
			}

			if (loginState.step === 'password') {
				// Проверяем пароль
				const user = await this.prisma.user.findUnique({
					where: { email: loginState.email },
				})

				if (!user) {
					await ctx.reply('❌ Пользователь не найден')
					this.clearLoginState(userId)
					return
				}

				const isPasswordValid = await bcrypt.compare(text, user.password)

				if (!isPasswordValid) {
					await ctx.reply('❌ Неверный пароль')
					this.clearLoginState(userId)
					return
				}

				// Обновляем telegramId, только если пользователь еще не привязан к другому аккаунту
				const existingUser = await this.prisma.user.findUnique({
					where: { telegramId: userId.toString() },
				})

				if (existingUser && existingUser.id !== user.id) {
					// Если текущий пользователь уже привязан к другому аккаунту, отвязываем его
					await this.prisma.user.update({
						where: { id: existingUser.id },
						data: { telegramId: null },
					})
				}

				// Привязываем новый telegramId
				await this.prisma.user.update({
					where: { id: user.id },
					data: { telegramId: userId.toString() },
				})

				await this.showMainMenu(ctx) // Показываем меню сразу после успешного входа
				this.clearLoginState(userId)
			}
		} catch (error) {
			console.error('Ошибка при обработке входа:', error)
			await ctx.reply('❌ Произошла ошибка при входе')
			this.clearLoginState(ctx.from.id)
		}
	}

	async initLoginState(userId: number) {
		console.log('Инициализация состояния входа для пользователя:', userId)
		this.loginStates.set(userId, {
			email: null,
			password: null,
			step: 'email', // Начинаем с ввода email
		})
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
		const state = this.registrationStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните регистрацию заново')
			return
		}

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
		const state = this.registrationStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните регистрацию заново')
			return
		}

		// Пропускаем номер Меркурий и переходим к следующему шагу регистрации
		state.mercuryNumber = null
		state.inputType = 'address'
		this.registrationStates.set(userId, state)
		await ctx.reply('📍 Введите ваш адрес:')
	}

	getAuthState(userId: number): AuthState | undefined {
		return this.authStates.get(userId)
	}

	async handleAuthInput(ctx: Context, text: string) {
		const userId = ctx.from.id

		// Проверяем, находится ли пользователь в процессе входа
		const loginState = this.loginStates.get(userId)
		if (loginState) {
			await this.handleLoginInput(ctx, text)
			return
		}

		// Проверяем, находится ли пользователь в процессе регистрации
		const registerState = this.registrationStates.get(userId)
		if (registerState) {
			await this.handleTextInput(ctx, text)
			return
		}

		// Если пользователь не находится в процессе авторизации, используем стандартный обработчик
		await this.handleTextInput(ctx, text)
	}

	async updateAuthState(userId: number, state: AuthState): Promise<void> {
		this.authStates.set(userId, state)
	}

	async handleUserTypeSelection(ctx: Context, userType: string) {
		const userId = ctx.from.id
		const state = await this.getAuthState(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните регистрацию заново')
			return
		}

		// Сохраняем тип пользователя
		state.buyerType = userType
		await this.updateAuthState(userId, state)

		// Для всех типов пользователей запрашиваем email
		state.inputType = 'email'
		await this.updateAuthState(userId, state)
		await ctx.reply('📧 Введите ваш email:')
	}

	// Добавим метод для обновления состояния регистрации
	async updateRegistrationState(userId: number, state: RegistrationState) {
		this.registrationStates.set(userId, state)
	}

	private clearLoginState(userId: number) {
		this.loginStates.delete(userId)
	}

	private async showMainMenu(ctx: Context) {
		await ctx.reply('✅ Вход выполнен успешно!', {
			reply_markup: {
				inline_keyboard: [[{ text: '📱 Меню', callback_data: 'menu' }]],
			},
		})
	}
}
