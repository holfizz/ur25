import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Context } from 'telegraf'
import { CallbackQuery } from 'telegraf/typings/core/types/typegram'
import { PrismaService } from '../prisma.service'
import { TelegramServiceClient } from './telegram.service.client'

interface RegistrationState {
	email: string | null
	password: string | null
	confirmPassword: string | null
	name: string | null
	phone: string | null
	address: string | null
	role?: Role | null
}

@Injectable()
export class TelegramService {
	private registrationStates: Map<number, any> = new Map() // Храним состояние регистрации
	private editStates: Map<number, { field: string }> = new Map() // Храним состояние редактирования

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly telegramClient: TelegramServiceClient,
	) {}

	public async handleStart(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply(
				'👋 Добро пожаловать на нашу площадку для торговли КРС (крупного рогатого скота)! \n\n' +
					'Пожалуйста, выберите действие:',
				{
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '📝 Регистрация', callback_data: 'register' },
								{ text: '🔑 Вход', callback_data: 'login' },
							],
						],
					},
				},
			)
		} else {
			await ctx.reply(
				`👤 Ваш профиль:\n\n` +
					`📝 Название: ${user.name}\n` +
					`📧 Email: ${user.email}\n` +
					`📱 Телефон: ${user.phone}\n` +
					`📍 Адрес: ${user.address}\n` +
					`📦 Роль: ${this.getRoleInRussian(user.role)}\n`,
			)
		}
	}

	async handleMenu(ctx: Context) {
		await ctx.reply('Главное меню\n\nВыберите нужное действие:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '📝 Создать объявление', callback_data: 'create_ad' },
						{ text: '📋 Мои объявления', callback_data: 'my_ads' },
					],
					[
						{ text: '📨 Входящие заявки', callback_data: 'incoming_requests' },
						{ text: '💬 Сообщения', callback_data: 'messages' },
					],
					[
						{ text: '👤 Профиль', callback_data: 'profile' },
						{ text: 'ℹ️ Помощь', callback_data: 'help' },
					],
					[{ text: '📤 Выйти', callback_data: 'logout' }],
				],
			},
		})
	}

	async showProfile(ctx: Context) {
		const user = await this.prisma.user.findUnique({
			where: { telegramId: ctx.from.id.toString() },
		})

		if (!user || !user.isVerified) {
			await this.handleLogout(ctx, ctx.from.id)
			return
		}

		if (user) {
			await ctx.reply(
				'👤 Ваш профиль:\n\n' +
					`📝 Название: ${user.name}\n` +
					`📧 Email: ${user.email}\n` +
					`📱 Телефон: ${user.phone}\n` +
					`📍 Адрес: ${user.address}\n` +
					`📦 Роль: ${this.getRoleInRussian(user.role)}\n` +
					`🔔 Уведомления: ${
						user.notificationsEnabled ? 'Включены' : 'Отключены'
					}\n\n` +
					'Выберите действие для редактирования:',
				{
					reply_markup: {
						inline_keyboard: [
							[
								{ text: '✏️ Изменить название', callback_data: 'edit_name' },
								{ text: '📱 Изменить телефон', callback_data: 'edit_phone' },
							],
							[
								{ text: '📍 Изменить адрес', callback_data: 'edit_address' },
								{ text: '🔑 Изменить пароль', callback_data: 'edit_password' },
							],
							[
								{
									text: user.notificationsEnabled
										? '🔕 Отключить уведомления'
										: '🔔 Включить уведомления',
									callback_data: user.notificationsEnabled
										? 'disable_notifications'
										: 'enable_notifications',
								},
							],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				},
			)
		}
	}

	async handleCreateAd(ctx: Context) {
		await ctx.reply(
			'📸 Отправьте фотографии КРС\n\n' +
				'❗️ Важно: отправьте все фотографии одним сообщением (до 10 штук)\n' +
				'✅ Рекомендуется:\n' +
				'• Фото животных в полный рост\n' +
				'• При хорошем освещении\n' +
				'• С разных ракурсов',
			{
				reply_markup: {
					inline_keyboard: [[{ text: '« Отмена', callback_data: 'cancel' }]],
				},
			},
		)
	}

	async toggleNotifications(ctx: Context, enable: boolean) {
		const userId = ctx.from.id
		await this.prisma.user.update({
			where: { telegramId: userId.toString() },
			data: { notificationsEnabled: enable },
		})

		await ctx.reply(
			`✅ Уведомления ${
				enable ? 'включены' : 'отключены'
			}!\n\nВозвращаемся в профиль...`,
		)
		await this.showProfile(ctx)
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

	public async handleLogout(ctx: Context, userId: number) {
		await this.prisma.user.update({
			where: { telegramId: userId.toString() },
			data: { telegramId: null },
		})

		await ctx.reply(
			'✅ Вы успешно вышли из аккаунта.\n' +
				'Для входа используйте команду /start',
		)
	}

	public async handleRegistrationFlow(ctx: Context, text: string) {
		const userId = ctx.from.id

		// Проверяем, если пользователь уже зарегистрирован и ожидает подтверждения
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (user && user.isVerified) {
			await ctx.reply('❌ Вы уже зарегистрированы и подтверждены.')
			return
		}

		const state = this.registrationStates.get(userId) || {
			email: null,
			password: null,
			confirmPassword: null,
			name: null,
			phone: null,
			address: null,
		}

		// Логика сбора данных
		if (!state.email) {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
			if (!emailRegex.test(text)) {
				await ctx.reply(
					'❌ Неверный формат email!\n\n📝 Пример: example@mail.com',
				)
				return
			}
			state.email = text
			await ctx.reply(
				'🔑 Придумайте пароль:\n\n📝 Минимум 6 символов, буквы и цифры',
			)
		} else if (!state.password) {
			if (
				text.length < 6 ||
				!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/.test(text)
			) {
				await ctx.reply(
					'❌ Пароль должен содержать минимум 6 символов, включая буквы и цифры',
				)
				return
			}
			state.password = text
			await ctx.reply('🔄 Повторите пароль для подтверждения')
		} else if (!state.confirmPassword) {
			if (text !== state.password) {
				await ctx.reply('❌ Пароли не совпадают! Попробуйте еще раз')
				return
			}
			state.confirmPassword = text
			await ctx.reply('📝 Введите название вашей организации')
		} else if (!state.name) {
			state.name = text
			await ctx.reply('📱 Введите номер телефона:\n\n📝 Пример: +7XXXXXXXXXX')
		} else if (!state.phone) {
			const phoneRegex = /^\+7\d{10}$/
			if (!phoneRegex.test(text)) {
				await ctx.reply(
					'❌ Неверный формат номера телефона!\n\n📝 Используйте формат: +7XXXXXXXXXX',
				)
				return
			}
			state.phone = text
			await ctx.reply(
				'📍 Введите ваш адрес:\n\n✅ Пример: г. Москва, ул. Примерная, д. 1',
			)
		} else if (!state.address) {
			state.address = text

			// Создаем пользователя
			await this.prisma.user.create({
				data: {
					email: state.email,
					password: await bcrypt.hash(state.password, 10),
					name: state.name,
					phone: state.phone,
					address: state.address,
					role: 'BUYER',
					isVerified: false,
					telegramId: userId.toString(),
				},
			})

			await ctx.reply(
				'✅ Ваша заявка на регистрацию отправлена на модерацию. Ожидайте подтверждения на почту.',
			)
			this.registrationStates.delete(userId) // Удаляем состояние после завершения
		}

		// Сохраняем состояние в памяти
		this.registrationStates.set(userId, state)
	}

	// Обработка выбора роли
	public async handleRoleSelection(ctx: Context) {
		const userId = ctx.from.id

		const query = ctx.callbackQuery as CallbackQuery.DataQuery
		if (!query.data) {
			await ctx.reply('❌ Ошибка: данные не найдены.')
			return
		}

		const role = query.data.split('_')[1]

		const state = this.registrationStates.get(userId) || {
			role: null,
			email: null,
			password: null,
			name: null,
			phone: null,
			address: null,
		}
		state.role = role // Сохраняем роль в состоянии

		this.registrationStates.set(userId, state)

		await ctx.reply(
			'✅ Роль успешно выбрана! Пожалуйста, продолжайте регистрацию.',
		)
		await this.handleRegistrationFlow(ctx, '') // Продолжаем процесс регистрации
	}

	public async handleEdit(ctx: Context, field: string) {
		const userId = ctx.from.id

		// Получаем пользователя из базы данных
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		// Сохраняем состояние редактирования
		this.editStates.set(userId, { field })

		let promptMessage = ''
		switch (field) {
			case 'name':
				promptMessage = '✏️ Введите новое название организации:'
				break
			case 'phone':
				promptMessage = '📱 Введите новый номер телефона:'
				break
			case 'address':
				promptMessage = '📍 Введите новый адрес:'
				break
			case 'password':
				promptMessage = '🔑 Введите новый пароль:'
				break
			default:
				promptMessage = '✏️ Введите новое значение:'
		}

		await ctx.reply(promptMessage)
	}

	public async handleTextInput(ctx: Context, text: string) {
		const userId = ctx.from.id
		const editState = this.editStates.get(userId)

		if (!editState) return

		try {
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Определяем тип для объекта обновления
			const updateData: {
				phone?: string
				password?: string
				name?: string
				address?: string
			} = {}
			let isValid = true
			let errorMessage = ''

			switch (editState.field) {
				case 'phone':
					if (!this.validatePhone(text)) {
						isValid = false
						errorMessage = '❌ Неверный формат телефона. Пример: +79991234567'
					} else {
						updateData.phone = text
					}
					break
				case 'password':
					if (!this.validatePassword(text)) {
						isValid = false
						errorMessage =
							'❌ Пароль должен содержать минимум 6 символов, включая буквы и цифры.'
					} else {
						updateData.password = await bcrypt.hash(text, 10) // Хешируем пароль
					}
					break
				case 'name':
					updateData.name = text
					break
				case 'address':
					updateData.address = text
					break
			}

			if (isValid) {
				await this.prisma.user.update({
					where: { id: user.id },
					data: updateData,
				})

				await ctx.reply('✅ Данные успешно обновлены!')
				await this.showProfile(ctx)
			} else {
				await ctx.reply(errorMessage)
			}
		} catch (error) {
			console.error('Ошибка при обновлении данных:', error)
			await ctx.reply('❌ Произошла ошибка при обновлении данных')
		}
	}

	private validatePhone(phone: string): boolean {
		const phoneRegex = /^\+?[0-9]{10,15}$/ // Пример: +79991234567
		return phoneRegex.test(phone)
	}

	private validatePassword(password: string): boolean {
		const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/ // Минимум 6 символов, буквы и цифры
		return passwordRegex.test(password)
	}
}
