import { PrismaService } from '@/prisma.service'
import { Controller } from '@nestjs/common'
import { Action, Command, Ctx, On, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { TelegramService } from './telegram.service'

@Update()
@Controller()
export class TelegramController {
	constructor(
		private readonly telegramService: TelegramService,
		private readonly prisma: PrismaService,
	) {}

	@Command('start')
	async handleStart(@Ctx() ctx: Context) {
		await this.telegramService.handleStart(ctx)
	}

	@Command('menu')
	async handleMenu(@Ctx() ctx: Context) {
		await this.telegramService.handleMenu(ctx)
	}

	@Action('profile')
	async handleProfileAction(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply(
				'❌ Вы не прошли модерацию. Ожидайте подтверждения на почту.',
			)
			return
		}

		// Используем существующий метод для отображения профиля
		await this.telegramService.showProfile(ctx)
	}

	@Action('create_ad')
	async handleCreateAd(@Ctx() ctx: Context) {
		await this.telegramService.handleCreateAd(ctx)
	}

	@Action('menu')
	async handleMenuAction(@Ctx() ctx: Context) {
		await this.telegramService.handleMenu(ctx)
	}

	@Action('enable_notifications')
	async handleEnableNotifications(@Ctx() ctx: Context) {
		await this.telegramService.toggleNotifications(ctx, true)
	}

	@Action('disable_notifications')
	async handleDisableNotifications(@Ctx() ctx: Context) {
		await this.telegramService.toggleNotifications(ctx, false)
	}

	@Action(/^edit_(.+)/)
	async handleEdit(@Ctx() ctx: Context) {
		if (!ctx.callbackQuery) return
		const field = ctx.callbackQuery['data'].split('_')[1]
		await this.telegramService.handleEdit(ctx, field)
	}

	@Command('help')
	async handleHelp(@Ctx() ctx: Context) {
		await ctx.reply(
			'📋 Список доступных команд:\n\n' +
				'/profile - Посмотреть профиль\n' +
				'/help - Получить помощь\n' +
				'/logout - Выйти из аккаунта\n\n' +
				'По всем вопросам обращайтесь к администратору.',
		)
	}

	@Command('logout')
	async handleLogout(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		await this.telegramService.handleLogout(ctx, userId)
	}

	@On('text')
	async handleMessage(@Ctx() ctx: Context) {
		if (!ctx.message || !('text' in ctx.message)) return

		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		const message = ctx.message as { text: string }

		if (!user?.isVerified) {
			await this.telegramService.handleRegistrationFlow(ctx, message.text)
			return
		}

		// Обработка текстового ввода для редактирования или входа
		await this.telegramService.handleTextInput(ctx, message.text)
	}

	@Action('my_ads')
	async handleMyAdsAction(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply(
				'❌ Вы не прошли модерацию. Ожидайте подтверждения на почту.',
			)
			return
		}

		await ctx.reply(
			'📋 Мои объявления\n\n' +
				'📭 У вас пока нет объявлений.\n' +
				'Нажмите "Создать объявление", чтобы разместить новое.',
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: '📝 Создать объявление', callback_data: 'create_ad' }],
						[{ text: '« Меню', callback_data: 'menu' }],
					],
				},
			},
		)
	}

	@Action('incoming_requests')
	async handleIncomingRequestsAction(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply(
				'❌ Вы не прошли модерацию. Ожидайте подтверждения на почту.',
			)
			return
		}

		await ctx.reply(
			'📨 Входящие заявки\n\n' +
				'📭 У вас пока нет входящих заявок.\n' +
				'Они появятся, когда кто-то откликнется на ваше объявление.',
			{
				reply_markup: {
					inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
				},
			},
		)
	}

	@Action('messages')
	async handleMessagesAction(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply(
				'❌ Вы не прошли модерацию. Ожидайте подтверждения на почту.',
			)
			return
		}

		await ctx.reply(
			'💬 Сообщения\n\n' +
				'📭 У вас пока нет сообщений.\n' +
				'Здесь будут отображаться ваши диалоги с другими пользователями.',
			{
				reply_markup: {
					inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
				},
			},
		)
	}

	@Action('help')
	async handleHelpAction(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user || !user.isVerified) {
			await ctx.reply(
				'❌ Вы не прошли модерацию. Ожидайте подтверждения на почту.',
			)
			return
		}

		await ctx.reply(
			'ℹ️ Помощь\n\n' +
				'📋 Основные команды:\n' +
				'• /start - Начать работу с ботом\n' +
				'• /menu - Открыть главное меню\n' +
				'• /help - Показать это сообщение\n\n' +
				'❓ По всем вопросам обращайтесь в поддержку: support@example.com',
			{
				reply_markup: {
					inline_keyboard: [[{ text: '« Меню', callback_data: 'menu' }]],
				},
			},
		)
	}

	@Action(/^role_(.+)/)
	async handleRoleSelection(@Ctx() ctx: Context) {
		await this.telegramService.handleRoleSelection(ctx)
	}

	@Action('register')
	async handleRegisterAction(@Ctx() ctx: Context) {
		// Логика для начала регистрации
		await ctx.reply('Пожалуйста, введите ваш email для регистрации:')
		// Здесь можно вызвать метод для начала регистрации
	}

	@Action('login')
	async handleLoginAction(@Ctx() ctx: Context) {
		// Логика для начала входа
		await ctx.reply('Пожалуйста, введите ваш email для входа:')
		// Здесь можно вызвать метод для начала входа
	}

	@Action('cancel')
	async handleCancelAction(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		// Удаляем состояние редактирования или регистрации
		this.telegramService.clearEditState(userId)
		this.telegramService.clearRegistrationState(userId)

		await ctx.reply('❌ Действие отменено. Вы вернулись в главное меню.', {
			reply_markup: {
				inline_keyboard: [[{ text: '📱 Главное меню', callback_data: 'menu' }]],
			},
		})
	}
}
