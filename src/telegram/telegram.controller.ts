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

		// Обработка текстового ввода для редактирования
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

		// Логика для отображения объявлений
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

		// Логика для отображения входящих заявок
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

		// Логика для отображения сообщений
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

		// Логика для отображения помощи
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
}
