// Сервис для работы с профилем
import { PrismaService } from '@/prisma.service'
import { Injectable } from '@nestjs/common'
import { BuyerType, Role } from '@prisma/client'
import { Context, Markup } from 'telegraf'
import { EditState } from '../interfaces/states.interface'

@Injectable()
export class TelegramProfileService {
	private editStates: Map<number, EditState> = new Map()

	constructor(private prisma: PrismaService) {}

	getRoleEmoji(role: Role): string {
		const roleEmoji = {
			BUYER: '🛒',
			SUPPLIER: '📦',
			CARRIER: '🚛',
			ADMIN: '👑',
		}
		return roleEmoji[role] || '👤'
	}

	private getRoleText(role: Role): string {
		const roleTexts = {
			BUYER: 'покупатель',
			SUPPLIER: 'поставщик',
			CARRIER: 'перевозчик',
			ADMIN: 'администратор',
		}
		return roleTexts[role] || 'пользователь'
	}

	async handleProfile(ctx) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Вы не авторизованы')
			return
		}

		const buyerTypes = {
			PRIVATE: '👤 Частное лицо',
			FARM: '🌾 Крестьянское фермерское хозяйство',
			AGRICULTURAL: '🏭 Сельскохозяйственное предприятие',
			MEAT_FACTORY: '🥩 Мясокомбинат',
			FEEDLOT: '🐮 Откормочная площадка',
			GRANT_MEMBER: '📋 Участник гранта',
		}

		const profileText = `
👤 <b>Ваш профиль:</b>

📝 Название: ${user.name}
📧 Email: ${user.email}
📱 Телефон: ${user.phone || 'Не указан'}
📍 Адрес: ${user.address || 'Не указан'}
${this.getRoleEmoji(user.role)} Роль: ${this.getRoleText(user.role)}
${user.role === 'BUYER' ? `🏢 Тип: ${buyerTypes[user.buyerType]}` : ''}
🔔 Уведомления: ${user.notificationsEnabled ? 'Включены' : 'Отключены'}

Выберите действие для редактирования:`

		const buttons = [
			[
				Markup.button.callback('✏️ Изменить название', 'edit_name'),
				Markup.button.callback('📱 Изменить телефон', 'edit_phone'),
			],
			[
				Markup.button.callback('📍 Изменить адрес', 'edit_address'),
				Markup.button.callback('🔑 Изменить пароль', 'edit_password'),
			],
			[
				Markup.button.callback(
					`${user.notificationsEnabled ? '🔕' : '🔔'} ${
						user.notificationsEnabled ? 'Отключить' : 'Включить'
					} уведомления`,
					'toggle_notifications',
				),
			],
			[Markup.button.callback('« Меню', 'menu')],
		]

		await ctx.reply(profileText, {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard(buttons),
		})
	}

	async handleEditCallback(ctx) {
		const action = ctx.callbackQuery.data.split('_')[1]
		const editMessages = {
			name: '✏️ Введите новое название организации:',
			phone: '📱 Введите новый номер телефона:',
			address: '📍 Введите новый адрес:',
			password: '🔑 Введите новый пароль:',
		}

		await ctx.reply(editMessages[action], {
			reply_markup: Markup.inlineKeyboard([
				[Markup.button.callback('« Отмена', 'profile')],
			]),
		})
	}

	private formatPhoneNumber(phone: string): string | null {
		// Удаляем все нецифровые символы
		const digits = phone.replace(/\D/g, '')

		// Проверяем длину (например, для России: 11 цифр)
		if (digits.length !== 11) {
			return null
		}

		// Форматируем в вид: +7 (XXX) XXX-XX-XX
		return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
	}

	async handleEditPhone(ctx) {
		const userId = ctx.from.id
		this.editStates.set(userId, { field: 'phone' })
		await ctx.reply(
			'Введите новый номер телефона:\n\n' +
				'📱 Формат: +7XXXXXXXXXX\n' +
				'✅ Пример: +79991234567',
		)
	}

	async handleEditAddress(ctx) {
		const userId = ctx.from.id
		this.editStates.set(userId, { field: 'address' })
		await ctx.reply('Введите новый адрес:')
	}

	async handleEditState(ctx, userId: number, text: string): Promise<boolean> {
		const editState = this.editStates.get(userId)
		if (!editState) return false

		try {
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (editState.field === 'phone') {
				// Проверяем и форматируем телефон
				const formattedPhone = this.formatPhoneNumber(text)
				if (!formattedPhone) {
					await ctx.reply(
						'❌ Неверный формат номера телефона\n\n' +
							'📱 Формат: +7XXXXXXXXXX\n' +
							'✅ Пример: +79991234567\n\n' +
							'Попробуйте еще раз:',
					)
					return true
				}

				await this.prisma.user.update({
					where: { id: user.id },
					data: { phone: formattedPhone },
				})
				await ctx.reply('✅ Номер телефона успешно обновлен')
			} else if (editState.field === 'address') {
				if (text.length < 5) {
					await ctx.reply('❌ Адрес слишком короткий. Введите полный адрес:')
					return true
				}

				await this.prisma.user.update({
					where: { id: user.id },
					data: { address: text },
				})
				await ctx.reply('✅ Адрес успешно обновлен')
			}

			this.editStates.delete(userId)
			await this.handleProfile(ctx)
			return true
		} catch (error) {
			console.error('Ошибка при обновлении профиля:', error)
			await ctx.reply('❌ Произошла ошибка при обновлении данных')
			this.editStates.delete(userId)
			return true
		}
	}

	async handleToggleNotifications(ctx) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		await this.prisma.user.update({
			where: { id: user.id },
			data: { notificationsEnabled: !user.notificationsEnabled },
		})

		await ctx.reply(
			`✅ Уведомления ${
				!user.notificationsEnabled ? 'включены' : 'отключены'
			}!\n\nВозвращаемся в профиль...`,
		)
		await this.handleProfile(ctx)
	}

	async showContacts(ctx, userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		const contactsText = `
👤 <b>Контакты ${user.name}:</b>

📱 Телефон: ${user.phone || 'Не указан'}
📧 Email: ${user.email}
📍 Адрес: ${user.address || 'Не указан'}
${this.getRoleEmoji(user.role)} Роль: ${this.getRoleText(user.role)}
${
	user.role === 'BUYER'
		? `🏢 Тип: ${this.getBuyerTypeText(user.buyerType)}`
		: ''
}

💬 Используйте кнопку ниже, чтобы написать сообщение`

		await ctx.reply(contactsText, {
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('💬 Написать сообщение', `chat_${user.id}`)],
				[
					Markup.button.callback(
						'« Назад',
						ctx.callbackQuery.data.replace('contacts_', 'view_offer_'),
					),
				],
				[Markup.button.callback('« Меню', 'menu')],
			]),
		})
	}

	private getBuyerTypeText(buyerType: BuyerType): string {
		const types = {
			PRIVATE: 'Частное лицо',
			FARM: 'КФХ',
			AGRICULTURAL: 'С/х предприятие',
			MEAT_FACTORY: 'Мясокомбинат',
			FEEDLOT: 'Откормочная площадка',
			GRANT_MEMBER: 'Участник гранта',
		}
		return types[buyerType] || buyerType
	}

	async showProfile(ctx: Context) {
		try {
			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			// Формируем информацию о профиле
			let profileInfo = `👤 <b>Ваш профиль:</b>\n\n`
			profileInfo += `📝 Имя: ${user.name || 'Не указано'}\n`
			profileInfo += `📧 Email: ${user.email}\n`
			profileInfo += `📱 Телефон: ${user.phone || 'Не указан'}\n`
			profileInfo += `📍 Адрес: ${user.address || 'Не указан'}\n`
			profileInfo += `🔑 Роль: ${this.getRoleText(user.role)}\n`

			if (user.role === 'BUYER') {
				profileInfo += `🏢 Тип покупателя: ${this.getBuyerTypeText(user.buyerType)}\n`
			}

			if (user.mercuryNumber) {
				profileInfo += `🔖 Номер в системе Меркурий: ${user.mercuryNumber}\n`
			}

			// Отправляем информацию о профиле с кнопками
			await ctx.reply(profileInfo, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '✏️ Редактировать профиль',
								callback_data: 'edit_profile',
							},
						],
						[{ text: '« Меню', callback_data: 'menu' }],
					],
				},
			})
		} catch (error) {
			console.error('Ошибка при отображении профиля:', error)
			await ctx.reply('❌ Произошла ошибка при загрузке профиля')
		}
	}

	// Добавляем метод для редактирования профиля
	async handleEditProfile(ctx: Context) {
		try {
			console.log('Вызван метод handleEditProfile')

			const userId = ctx.from.id
			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			console.log('Пользователь найден:', user.id)

			// Показываем кнопки для выбора поля для редактирования
			await ctx.reply('✏️ Выберите, что вы хотите изменить:', {
				reply_markup: {
					inline_keyboard: [
						[{ text: '👤 Имя', callback_data: 'edit_name' }],
						[{ text: '📱 Телефон', callback_data: 'edit_phone' }],
						[{ text: '📍 Адрес', callback_data: 'edit_address' }],
						[{ text: '« Назад к профилю', callback_data: 'profile' }],
					],
				},
			})

			console.log('Отправлено меню редактирования профиля')
		} catch (error) {
			console.error('Ошибка при редактировании профиля:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании профиля')
		}
	}

	// Метод для обработки выбора поля для редактирования
	async handleEditField(ctx: Context, field: string) {
		try {
			console.log(`Вызван метод handleEditField с полем: ${field}`)

			const userId = ctx.from.id

			// Проверяем, что поле имеет допустимое значение
			if (!['name', 'phone', 'address'].includes(field)) {
				console.error(`Недопустимое поле для редактирования: ${field}`)
				await ctx.reply('❌ Произошла ошибка при редактировании профиля')
				return
			}

			// Сохраняем состояние редактирования с правильной типизацией
			this.editStates.set(userId, {
				field: field as 'name' | 'phone' | 'address',
			})

			console.log(
				`Установлено состояние редактирования для пользователя ${userId}:`,
				this.editStates.get(userId),
			)

			// Отправляем сообщение с просьбой ввести новое значение
			const fieldNames = {
				name: 'имя',
				phone: 'номер телефона',
				address: 'адрес',
			}

			await ctx.reply(`📝 Пожалуйста, введите новое ${fieldNames[field]}:`)
		} catch (error) {
			console.error('Ошибка при выборе поля для редактирования:', error)
			await ctx.reply('❌ Произошла ошибка при редактировании профиля')
		}
	}

	// Метод для обработки ввода нового значения поля
	async handleProfileInput(ctx: Context, text: string) {
		try {
			const userId = ctx.from.id
			const state = this.editStates.get(userId)

			console.log(
				`Обработка ввода для редактирования профиля пользователя ${userId}:`,
				state,
				text,
			)

			if (!state) {
				console.error(
					`Состояние редактирования не найдено для пользователя ${userId}`,
				)
				await ctx.reply('❌ Начните редактирование профиля заново')
				return
			}

			const user = await this.prisma.user.findUnique({
				where: { telegramId: userId.toString() },
			})

			if (!user) {
				await ctx.reply('❌ Пользователь не найден')
				return
			}

			console.log(
				`Обновление поля ${state.field} для пользователя ${user.id} на значение: ${text}`,
			)

			// Обновляем выбранное поле
			await this.prisma.user.update({
				where: { id: user.id },
				data: {
					[state.field]: text,
				},
			})

			// Очищаем состояние
			this.editStates.delete(userId)

			console.log(`Состояние редактирования очищено для пользователя ${userId}`)

			// Отправляем сообщение об успешном обновлении
			await ctx.reply(
				`✅ ${state.field === 'name' ? 'Имя' : state.field === 'phone' ? 'Номер телефона' : 'Адрес'} успешно обновлен!`,
				{
					reply_markup: {
						inline_keyboard: [
							[{ text: '👤 Вернуться к профилю', callback_data: 'profile' }],
							[{ text: '« Меню', callback_data: 'menu' }],
						],
					},
				},
			)
		} catch (error) {
			console.error('Ошибка при обновлении профиля:', error)
			await ctx.reply('❌ Произошла ошибка при обновлении профиля')
		}
	}

	// Метод для получения состояния редактирования
	getEditState(userId: number): EditState | undefined {
		return this.editStates.get(userId)
	}
}
