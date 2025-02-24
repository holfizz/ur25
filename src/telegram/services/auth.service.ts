import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Role } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Context } from 'telegraf'
import { PrismaService } from '../../prisma.service'
import { TelegramClient } from '../telegram.client'

@Injectable()
export class TelegramAuthService {
	public registrationStates: Map<number, any> = new Map()
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

		// Проверка, выбрана ли роль
		if (!state.role) {
			await ctx.reply('❓ Выберите вашу роль для регистрации:', {
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '👤 Покупатель', callback_data: 'role_buyer' },
							{ text: '🛠️ Поставщик', callback_data: 'role_supplier' },
							{ text: '🚚 Перевозчик', callback_data: 'role_carrier' },
						],
					],
				},
			})
			return
		}

		// Обработка ввода ИНН
		if (state.inputType === 'inn') {
			const isValid = await this.checkInn(text)
			if (!isValid) {
				await ctx.reply('❌ ИНН не найден или не активен. Попробуйте еще раз:')
				return
			}
			state.inn = text
			state.inputType = 'email' // Переход к следующему шагу
			console.log(`Пользователь ${userId} ввел ИНН: ${text}`)
			await ctx.reply('✅ ИНН введен верно! Теперь введите ваш email:')
			this.registrationStates.set(userId, state)
			return
		}

		// Логика для обработки email
		if (state.inputType === 'email') {
			if (!(await this.validateEmail(text))) {
				await ctx.reply(
					'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
				)
				return
			}

			// Проверяем, существует ли пользователь с таким email
			const existingUser = await this.prisma.user.findUnique({
				where: { email: text },
			})

			if (existingUser) {
				await ctx.reply(
					'❌ Пользователь с такой почтой уже существует. Пожалуйста, введите другой email:',
				)
				return
			}

			state.email = text
			state.inputType = 'password'
			await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
			this.registrationStates.set(userId, state)
			return
		}

		// Логика для обработки пароля
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

		// Логика для обработки подтверждения пароля
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

		// Логика для обработки ФИО
		if (state.inputType === 'name') {
			await this.handleNameInput(ctx, text, state)
			this.registrationStates.set(userId, state)
			return
		}

		if (state.inputType === 'phone') {
			await this.handlePhoneInput(ctx, text, state)
			this.registrationStates.set(userId, state)
			return
		}

		if (state.inputType === 'mercury') {
			await this.handleMercuryInput(ctx, text, state)
			this.registrationStates.set(userId, state)
			return
		}

		if (state.inputType === 'address') {
			await this.handleAddressInput(ctx, text, state)
			this.registrationStates.set(userId, state)
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
			// Проверяем email еще раз перед созданием пользователя
			const existingUser = await this.prisma.user.findUnique({
				where: { email: state.email },
			})

			if (existingUser) {
				await ctx.reply(
					'❌ Пользователь с такой почтой уже существует. Пожалуйста, начните регистрацию заново.',
				)
				this.registrationStates.delete(userId)
				return
			}

			const user = await this.prisma.user.create({
				data: {
					email: state.email,
					password: state.password,
					phone: state.phone,
					inn: state.inn,
					ogrn: state.ogrn,
					role: state.role.toUpperCase(),
					name: state.name,
					telegramId: userId.toString(),
					mercuryNumber: state.mercuryNumber,
				},
			})

			await ctx.reply(
				'✅ Регистрация успешна!\n\n⏳ Ваша заявка отправлена на проверку администратору.\n📧 Уведомление о результатах проверки придет на указанную почту.',
			)

			// Очищаем состояние регистрации
			this.registrationStates.delete(userId)
		} catch (error) {
			console.error('Ошибка при регистрации:', error)
			await ctx.reply(
				'❌ Произошла ошибка при регистрации. Пожалуйста, попробуйте еще раз.',
			)
		}
	}

	private validatePhone(phone: string): boolean {
		const phoneRegex = /^\+?[0-9]{10,15}$/
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

		if (data && data.company && data.company.company_names) {
			return data.company.status && data.company.status.active_status
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
			role: null,
			entityType: null,
			email: null,
			password: null,
			name: null,
			phone: null,
			mercuryNumber: null,
			address: null,
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
		const state = this.getRegistrationState(userId)
		state.role = role.toUpperCase()

		await ctx.reply('✅ Роль выбрана! Теперь выберите тип регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '🏢 Организация', callback_data: 'type_organization' },
						{ text: '👤 Физическое лицо', callback_data: 'type_individual' },
					],
				],
			},
		})

		this.registrationStates.set(userId, state)
	}

	async handleUserTypeSelection(ctx: Context, userType: string) {
		const userId = ctx.from.id
		const state = this.getRegistrationState(userId)
		state.entityType = userType

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

	async handleStart(ctx: Context) {
		await ctx.reply(' Пожалуйста, выберите вашу роль для регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '👤 Покупатель', callback_data: 'role_buyer' },
						{ text: '🛠️ Поставщик', callback_data: 'role_supplier' },
					],
					[{ text: '🚚 Перевозчик', callback_data: 'role_carrier' }],
				],
			},
		})
	}

	async handleRegisterCommand(ctx: Context) {
		const userId = ctx.from.id
		await this.startRegistration(userId)
		await this.handleStart(ctx)
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
		state.mercuryNumber = null // Или любое другое значение, которое вы хотите установить
		state.inputType = 'address' // Переход к следующему шагу
		this.registrationStates.set(userId, state)

		await ctx.reply('📍 Введите адрес:')
	}

	async handleLoginInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const loginState = this.loginStates.get(userId)
		console.log('Обработка входа:', { userId, text, loginState })

		if (!loginState) {
			await ctx.reply('❌ Сессия входа истекла. Пожалуйста, начните заново.')
			return
		}

		if (!loginState.email) {
			// Проверка формата email
			if (!this.validateEmail(text)) {
				await ctx.reply('❌ Неверный формат email. Попробуйте еще раз.')
				return
			}

			// Проверка существования пользователя
			const user = await this.prisma.user.findUnique({
				where: { email: text },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден. Проверьте email.')
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

				// Добавляем вызов меню после успешного входа
				await ctx.reply('Выберите нужное действие:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '📝 Создать объявление', callback_data: 'create_ad' },
								{ text: '📋 Мои объявления', callback_data: 'my_ads' },
							],
							[
								{ text: '📱 Профиль', callback_data: 'profile' },
								{ text: '🔑 Войти', callback_data: 'login' },
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
}
