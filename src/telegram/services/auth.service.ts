import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { BuyerType, Equipment, Role, VehicleType } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Action, Ctx } from 'nestjs-telegraf'
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
	vehicleType?: VehicleType
	vehicleBrand?: string
	vehicleModel?: string
	vehicleYear?: number
	vehicleCapacity?: number
	vehicleLicensePlate?: string
	vehicleVin?: string
	companyType?: string
	confirmPassword?: string
	hasCattleExp?: boolean
	cattleExpYears?: number
	equipment?: Equipment[]
	workingRegions?: string[]
	sanitaryPassport?: boolean
	sanitaryExpDate?: Date
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
			await ctx.reply('❌ Начните регистрацию заново')
			return
		}

		switch (state.inputType) {
			case 'inn':
				try {
					const isValid = await this.checkInn(text)
					if (isValid) {
						state.inn = text
						state.inputType = 'email'
						await ctx.reply(
							'✅ ИНН проверен и подтвержден! Теперь введите ваш email:',
						)
					} else {
						await ctx.reply('❌ Неверный ИНН или организация не активна')
					}
				} catch (error) {
					await ctx.reply('❌ Ошибка при проверке ИНН')
				}
				break

			case 'ogrn':
				try {
					const isValid = await this.checkOgrn(text)
					if (isValid) {
						state.ogrn = text
						state.inputType = 'email'
						await ctx.reply(
							'✅ ОГРН проверен и подтвержден! Теперь введите ваш email:',
						)
					} else {
						await ctx.reply('❌ Неверный ОГРН или организация не активна')
					}
				} catch (error) {
					await ctx.reply('❌ Ошибка при проверке ОГРН')
				}
				break

			case 'email':
				if (await this.validateEmail(text)) {
					state.email = text
					state.inputType = 'password'
					await ctx.reply('🔑 Придумайте пароль (минимум 6 символов):')
				} else {
					await ctx.reply(
						'❌ Неверный формат email\n\n📝 Пример: example@mail.com',
					)
				}
				break

			case 'password':
				if (text.length < 6) {
					await ctx.reply('❌ Пароль должен содержать минимум 6 символов')
					return
				}
				state.password = text
				state.inputType = 'confirm_password'
				await ctx.reply('🔄 Повторите пароль для подтверждения:')
				break

			case 'confirm_password':
				if (text !== state.password) {
					await ctx.reply('❌ Пароли не совпадают. Попробуйте еще раз:')
					return
				}
				state.inputType = 'name'
				await ctx.reply('👤 Введите ваше имя:')
				break

			case 'name':
				state.name = text
				state.inputType = 'phone'
				await ctx.reply('📱 Введите ваш номер телефона в формате +7XXXXXXXXXX:')
				break

			case 'phone':
				if (this.validatePhone(text)) {
					state.phone = text
					state.inputType = 'address'
					await ctx.reply('📍 Введите ваш адрес:')
				} else {
					await ctx.reply(
						'❌ Неверный формат номера телефона\n\n📝 Пример: +79991234567',
					)
				}
				break

			case 'address':
				state.address = text
				// Если это перевозчик, переходим к вопросам о транспорте
				if (state.role === 'CARRIER') {
					state.inputType = 'vehicle_type'
					await ctx.reply('🚛 Укажите тип транспортного средства:', {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: '🚛 Грузовик', callback_data: 'vehicle_type_TRUCK' },
									{
										text: '🚐 Скотовоз',
										callback_data: 'vehicle_type_CATTLE_TRUCK',
									},
								],
							],
						},
					})
				} else {
					// Для остальных ролей завершаем регистрацию
					await this.completeRegistration(ctx, state)
				}
				break

			case 'vehicle_type':
				state.vehicleType = text as VehicleType
				state.inputType = 'vehicle_brand'
				await ctx.reply('🚛 Введите марку транспортного средства:')
				break

			case 'vehicle_brand':
				state.vehicleBrand = text
				state.inputType = 'vehicle_model'
				await ctx.reply('📝 Введите модель транспортного средства:')
				break

			case 'vehicle_model':
				state.vehicleModel = text
				state.inputType = 'vehicle_year'
				await ctx.reply('📅 Введите год выпуска:')
				break

			case 'vehicle_year':
				const year = parseInt(text)
				if (isNaN(year) || year < 1970 || year > new Date().getFullYear()) {
					await ctx.reply('❌ Введите корректный год выпуска')
					return
				}
				state.vehicleYear = year
				state.inputType = 'vehicle_capacity'
				await ctx.reply('🔢 Введите вместимость (количество голов КРС):')
				break

			case 'vehicle_capacity':
				const capacity = parseInt(text)
				if (isNaN(capacity) || capacity <= 0) {
					await ctx.reply('❌ Введите корректную вместимость')
					return
				}
				state.vehicleCapacity = capacity
				state.inputType = 'vehicle_license'
				await ctx.reply('🚗 Введите государственный номер:')
				break

			case 'vehicle_license':
				state.vehicleLicensePlate = text
				state.inputType = 'vehicle_vin'
				await ctx.reply('🔍 Введите VIN номер (можно пропустить):', {
					reply_markup: {
						inline_keyboard: [
							[{ text: '⏩ Пропустить', callback_data: 'skip_vin' }],
						],
					},
				})
				break

			case 'vehicle_vin':
				if (text !== 'skip') {
					state.vehicleVin = text
				}
				state.inputType = 'cattle_exp'
				await ctx.reply('🚛 Есть ли у вас опыт перевозки КРС?', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✅ Да', callback_data: 'cattle_exp_yes' },
								{ text: '❌ Нет', callback_data: 'cattle_exp_no' },
							],
						],
					},
				})
				break

			case 'cattle_exp_years':
				const years = parseInt(text)
				if (isNaN(years) || years < 0) {
					await ctx.reply('❌ Введите корректное количество лет')
					return
				}
				state.cattleExpYears = years
				state.inputType = 'equipment'
				await ctx.reply('🔧 Выберите имеющееся оборудование:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '💧 Поилки', callback_data: 'eq_water' },
								{ text: '💨 Вентиляция', callback_data: 'eq_vent' },
							],
							[
								{ text: '🌡️ Контроль температуры', callback_data: 'eq_temp' },
								{ text: '📹 Видеонаблюдение', callback_data: 'eq_cctv' },
							],
							[
								{ text: '📍 GPS-трекер', callback_data: 'eq_gps' },
								{ text: '🛗 Погрузочная рампа', callback_data: 'eq_ramp' },
							],
							[{ text: '➡️ Далее', callback_data: 'equipment_done' }],
						],
					},
				})
				break

			case 'working_regions':
				state.workingRegions = text.split(',').map(r => r.trim())
				state.inputType = 'sanitary'
				await ctx.reply('📋 Есть ли у вас санитарный паспорт на транспорт?', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✅ Да', callback_data: 'sanitary_yes' },
								{ text: '❌ Нет', callback_data: 'sanitary_no' },
							],
						],
					},
				})
				break

			case 'sanitary':
				state.sanitaryPassport = text === 'sanitary_yes'
				state.sanitaryExpDate = text === 'sanitary_yes' ? new Date() : null
				state.inputType = 'sanitary_exp_date'
				await ctx.reply(
					'📅 Введите дату окончания действия санитарного паспорта (ДД.ММ.ГГГГ):',
				)
				break

			case 'sanitary_exp_date':
				try {
					const [day, month, year] = text.split('.').map(Number)
					const date = new Date(year, month - 1, day)

					if (isNaN(date.getTime())) {
						await ctx.reply('❌ Введите корректную дату в формате ДД.ММ.ГГГГ')
						return
					}

					state.sanitaryExpDate = date
					// Завершаем регистрацию
					await this.completeRegistration(ctx, state)
				} catch (error) {
					await ctx.reply('❌ Введите дату в формате ДД.ММ.ГГГГ')
				}
				break

			case 'address':
				state.address = text
				await this.completeRegistration(ctx, state)
				break
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

	public async completeRegistration(ctx: Context, state: RegistrationState) {
		try {
			const hashedPassword = await bcrypt.hash(state.password, 10)

			// Проверяем существует ли пользователь
			const existingUser = await this.prisma.user.findUnique({
				where: { telegramId: ctx.from.id.toString() },
			})

			if (existingUser) {
				// Если пользователь существует - обновляем его данные
				const user = await this.prisma.user.update({
					where: { telegramId: ctx.from.id.toString() },
					data: {
						email: state.email,
						password: hashedPassword,
						name: state.name,
						phone: state.phone,
						address: state.address,
						role: state.role as Role,
						buyerType: state.buyerType as BuyerType,
						inn: state.inn,
						ogrn: state.ogrn,
						mercuryNumber: state.mercuryNumber,
						// Создаем транспортное средство, если это перевозчик
						...(state.role === 'CARRIER' && {
							vehicles: {
								create: {
									type: state.vehicleType,
									brand: state.vehicleBrand,
									model: state.vehicleModel,
									year: state.vehicleYear,
									capacity: state.vehicleCapacity,
									licensePlate: state.vehicleLicensePlate,
									vin: state.vehicleVin || null,
									hasCattleExp: state.hasCattleExp || false,
									cattleExpYears: state.cattleExpYears || 0,
									equipment: state.equipment || [],
									workingRegions: state.workingRegions || [],
									sanitaryPassport: state.sanitaryPassport || false,
									sanitaryExpDate: state.sanitaryExpDate || null,
								},
							},
						}),
					},
				})
			} else {
				// Если пользователь не существует - создаем нового
				const user = await this.prisma.user.create({
					data: {
						email: state.email,
						password: hashedPassword,
						name: state.name,
						phone: state.phone,
						address: state.address,
						role: state.role as Role,
						telegramId: ctx.from.id.toString(),
						buyerType: state.buyerType as BuyerType,
						inn: state.inn,
						ogrn: state.ogrn,
						mercuryNumber: state.mercuryNumber,
						...(state.role === 'CARRIER' && {
							vehicles: {
								create: {
									type: state.vehicleType,
									brand: state.vehicleBrand,
									model: state.vehicleModel,
									year: state.vehicleYear,
									capacity: state.vehicleCapacity,
									licensePlate: state.vehicleLicensePlate,
									vin: state.vehicleVin || null,
									hasCattleExp: state.hasCattleExp || false,
									cattleExpYears: state.cattleExpYears || 0,
									equipment: state.equipment || [],
									workingRegions: state.workingRegions || [],
									sanitaryPassport: state.sanitaryPassport || false,
									sanitaryExpDate: state.sanitaryExpDate || null,
								},
							},
						}),
					},
				})
			}

			// Очищаем состояние регистрации
			this.registrationStates.delete(ctx.from.id)

			// Отправляем сообщение об успешной регистрации
			await ctx.reply('✅ Регистрация успешно завершена!')
			await this.showMainMenu(ctx)
		} catch (error) {
			console.error('Ошибка при завершении регистрации:', error)
			await ctx.reply(
				'❌ Произошла ошибка при регистрации. Попробуйте еще раз.',
			)
			throw error
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
			const ogrnRegex = /^\d{13}$/
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
		const userId = ctx.from.id
		const state: RegistrationState = {
			role: role,
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
		}

		if (role === 'CARRIER') {
			await ctx.reply('Выберите тип регистрации:', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '👤 Физическое лицо',
								callback_data: 'carrier_type_PRIVATE',
							},
							{
								text: '🏢 Организация',
								callback_data: 'carrier_type_ORGANIZATION',
							},
						],
					],
				},
			})
		} else if (role === 'BUYER') {
			await ctx.reply('Выберите тип покупателя:', {
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '👤 Частное лицо',
								callback_data: 'buyer_type_PRIVATE',
							},
							{
								text: '🌾 КФХ',
								callback_data: 'buyer_type_FARM',
							},
						],
						[
							{
								text: '🏭 С/х предприятие',
								callback_data: 'buyer_type_AGRICULTURAL',
							},
							{
								text: '🥩 Мясокомбинат',
								callback_data: 'buyer_type_MEAT_FACTORY',
							},
						],
						[
							{
								text: '🐮 Откормочная площадка',
								callback_data: 'buyer_type_FEEDLOT',
							},
							{
								text: '📋 Участник гранта',
								callback_data: 'buyer_type_GRANT_MEMBER',
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
								text: '👤 Физическое лицо',
								callback_data: 'supplier_type_INDIVIDUAL',
							},
							{
								text: '🏢 Организация',
								callback_data: 'supplier_type_ORGANIZATION',
							},
						],
					],
				},
			})
		}

		this.registrationStates.set(userId, state)
	}

	async handleUserTypeSelection(ctx: Context, type: string) {
		const userId = ctx.from.id
		const state = this.registrationStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Пожалуйста, начните регистрацию заново')
			return
		}

		state.userType = type

		// Только частное лицо и участник гранта идут сразу к email
		if (type === 'PRIVATE' || type === 'GRANT_MEMBER') {
			state.inputType = 'email'
			await ctx.reply('📧 Введите ваш email:')
		} else {
			// Все остальные типы (КФХ, С/х предприятие, Мясокомбинат, Откормочная площадка, Организация)
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

		this.registrationStates.set(userId, state)
	}

	async handleVehicleInput(
		ctx: Context,
		text: string,
		state: RegistrationState,
	) {
		switch (state.inputType) {
			case 'vehicle_type':
				state.vehicleType = text as VehicleType
				state.inputType = 'vehicle_brand'
				await ctx.reply('🚛 Введите марку транспортного средства:')
				break

			case 'vehicle_brand':
				state.vehicleBrand = text
				state.inputType = 'vehicle_model'
				await ctx.reply('📝 Введите модель транспортного средства:')
				break

			case 'vehicle_model':
				state.vehicleModel = text
				state.inputType = 'vehicle_year'
				await ctx.reply('📅 Введите год выпуска:')
				break

			case 'vehicle_year':
				const year = parseInt(text)
				if (isNaN(year) || year < 1970 || year > new Date().getFullYear()) {
					await ctx.reply('❌ Введите корректный год выпуска')
					return
				}
				state.vehicleYear = year
				state.inputType = 'vehicle_capacity'
				await ctx.reply('🔢 Введите вместимость (количество голов КРС):')
				break

			case 'vehicle_capacity':
				const capacity = parseInt(text)
				if (isNaN(capacity) || capacity <= 0) {
					await ctx.reply('❌ Введите корректную вместимость')
					return
				}
				state.vehicleCapacity = capacity
				state.inputType = 'vehicle_license'
				await ctx.reply('🚗 Введите государственный номер:')
				break

			case 'vehicle_license':
				state.vehicleLicensePlate = text
				state.inputType = 'vehicle_vin'
				await ctx.reply('🔍 Введите VIN номер (можно пропустить):', {
					reply_markup: {
						inline_keyboard: [
							[{ text: '⏩ Пропустить', callback_data: 'skip_vin' }],
						],
					},
				})
				break

			case 'vehicle_vin':
				if (text !== 'skip') {
					state.vehicleVin = text
				}
				state.inputType = 'cattle_exp'
				await ctx.reply('🚛 Есть ли у вас опыт перевозки КРС?', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✅ Да', callback_data: 'cattle_exp_yes' },
								{ text: '❌ Нет', callback_data: 'cattle_exp_no' },
							],
						],
					},
				})
				break

			case 'cattle_exp_years':
				const years = parseInt(text)
				if (isNaN(years) || years < 0) {
					await ctx.reply('❌ Введите корректное количество лет')
					return
				}
				state.cattleExpYears = years
				state.inputType = 'equipment'
				await ctx.reply('🔧 Выберите имеющееся оборудование:', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '💧 Поилки', callback_data: 'eq_water' },
								{ text: '💨 Вентиляция', callback_data: 'eq_vent' },
							],
							[
								{ text: '🌡️ Контроль температуры', callback_data: 'eq_temp' },
								{ text: '📹 Видеонаблюдение', callback_data: 'eq_cctv' },
							],
							[
								{ text: '📍 GPS-трекер', callback_data: 'eq_gps' },
								{ text: '🛗 Погрузочная рампа', callback_data: 'eq_ramp' },
							],
							[{ text: '➡️ Далее', callback_data: 'equipment_done' }],
						],
					},
				})
				break

			case 'working_regions':
				state.workingRegions = text.split(',').map(r => r.trim())
				state.inputType = 'sanitary'
				await ctx.reply('📋 Есть ли у вас санитарный паспорт на транспорт?', {
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✅ Да', callback_data: 'sanitary_yes' },
								{ text: '❌ Нет', callback_data: 'sanitary_no' },
							],
						],
					},
				})
				break

			case 'sanitary':
				state.sanitaryPassport = text === 'sanitary_yes'
				state.sanitaryExpDate = text === 'sanitary_yes' ? new Date() : null
				state.inputType = 'sanitary_exp_date'
				await ctx.reply(
					'📅 Введите дату окончания действия санитарного паспорта (ДД.ММ.ГГГГ):',
				)
				break

			case 'sanitary_exp_date':
				try {
					const [day, month, year] = text.split('.').map(Number)
					const date = new Date(year, month - 1, day)

					if (isNaN(date.getTime())) {
						await ctx.reply('❌ Введите корректную дату в формате ДД.ММ.ГГГГ')
						return
					}

					state.sanitaryExpDate = date
					// Завершаем регистрацию
					await this.completeRegistration(ctx, state)
				} catch (error) {
					await ctx.reply('❌ Введите дату в формате ДД.ММ.ГГГГ')
				}
				break

			case 'address':
				state.address = text
				await this.completeRegistration(ctx, state)
				break

			// ... остальные case
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

	@Action(/eq_.*/)
	async handleEquipmentSelection(@Ctx() ctx: Context) {
		try {
			await ctx.answerCbQuery()
			const callbackQuery = ctx.callbackQuery as any
			const equipment = callbackQuery.data.replace('eq_', '')
			const userId = ctx.from.id
			const state = await this.getRegistrationState(userId)

			if (state) {
				state.equipment = state.equipment || []

				// Преобразуем callback в enum
				const equipmentMap = {
					water: Equipment.WATER_SYSTEM,
					vent: Equipment.VENTILATION,
					temp: Equipment.TEMPERATURE_CONTROL,
					cctv: Equipment.CCTV,
					gps: Equipment.GPS_TRACKER,
					ramp: Equipment.LOADING_RAMP,
				}

				const equipmentEnum =
					equipmentMap[equipment as keyof typeof equipmentMap]
				if (!equipmentEnum) return

				const equipmentIndex = state.equipment.indexOf(equipmentEnum)
				if (equipmentIndex === -1) {
					state.equipment.push(equipmentEnum)
				} else {
					state.equipment.splice(equipmentIndex, 1)
				}

				await this.updateRegistrationState(userId, state)

				const keyboard = [
					[
						{
							text: `${state.equipment.includes(Equipment.WATER_SYSTEM) ? '✅' : '💧'} Поилки`,
							callback_data: 'eq_water',
						},
						{
							text: `${state.equipment.includes(Equipment.VENTILATION) ? '✅' : '💨'} Вентиляция`,
							callback_data: 'eq_vent',
						},
					],
					[
						{
							text: `${state.equipment.includes(Equipment.TEMPERATURE_CONTROL) ? '✅' : '🌡️'} Контроль температуры`,
							callback_data: 'eq_temp',
						},
						{
							text: `${state.equipment.includes(Equipment.CCTV) ? '✅' : '📹'} Видеонаблюдение`,
							callback_data: 'eq_cctv',
						},
					],
					[
						{
							text: `${state.equipment.includes(Equipment.GPS_TRACKER) ? '✅' : '📍'} GPS-трекер`,
							callback_data: 'eq_gps',
						},
						{
							text: `${state.equipment.includes(Equipment.LOADING_RAMP) ? '✅' : '🛗'} Погрузочная рампа`,
							callback_data: 'eq_ramp',
						},
					],
					[{ text: '➡️ Далее', callback_data: 'equipment_done' }],
				]

				await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard })
			}
		} catch (error) {
			console.error('Ошибка при выборе оборудования:', error)
			await ctx.reply('❌ Произошла ошибка при обработке запроса')
		}
	}
}
