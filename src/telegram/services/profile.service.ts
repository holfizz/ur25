// Сервис для работы с профилем
import { PrismaService } from '@/prisma.service'
import { Injectable } from '@nestjs/common'
import { BuyerType, Role } from '@prisma/client'
import { Context, Markup } from 'telegraf'

@Injectable()
export class TelegramProfileService {
	private editStates: Map<number, { field: 'phone' | 'address' }> = new Map()

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
		return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(
			7,
			9,
		)}-${digits.slice(9)}`
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

	private getBuyerTypeText(type: BuyerType): string {
		const types = {
			PRIVATE: 'Частное лицо',
			FARM: 'КФХ',
			AGRICULTURAL: 'С/х предприятие',
			MEAT_FACTORY: 'Мясокомбинат',
			FEEDLOT: 'Откормочная площадка',
			GRANT_MEMBER: 'Участник гранта',
		}
		return types[type] || type
	}

	async showProfile(ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user) {
			await ctx.reply('❌ Пользователь не найден')
			return
		}

		const profileText = `
👤 <b>Ваш профиль:</b>

📝 Название: ${user.name}
📧 Email: ${user.email}
📱 Телефон: ${user.phone || 'Не указан'}
📍 Адрес: ${user.address || 'Не указан'}
${this.getRoleEmoji(user.role)} Роль: ${this.getRoleText(user.role)}
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
}
