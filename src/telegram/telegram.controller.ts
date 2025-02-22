import { Controller } from '@nestjs/common'
import { Role } from '@prisma/client'
import { Action, Command, Ctx, On, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { TelegramService } from './telegram.service'

@Update()
@Controller()
export class TelegramController {
	constructor(private readonly telegramService: TelegramService) {}

	@Command('start')
	async handleStart(@Ctx() ctx: Context) {
		const chatId = ctx.message.chat.id.toString()
		const telegramId = ctx.message.from.id.toString()
		await this.telegramService.handleStart(telegramId, chatId)
	}

	@Command('profile')
	async handleProfile(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		await this.telegramService.showProfile(ctx, userId)
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

	@Action('register')
	async handleRegister(@Ctx() ctx: Context) {
		await this.telegramService.handleRegister(ctx)
	}

	@Action(/^register_(.+)/)
	async handleRegistrationAction(@Ctx() ctx: Context) {
		if (!ctx.callbackQuery) return
		const callbackData = ctx.callbackQuery['data'] as string
		const role = callbackData.split('_')[1] as Role
		const userId = ctx.from.id

		await this.telegramService.startRegistration(userId, role)
		await ctx.reply('📧 Введите ваш email:\n\n📝 Пример: example@mail.com')
	}

	@On('text')
	async handleMessage(@Ctx() ctx: Context) {
		if (!ctx.message || !('text' in ctx.message)) return
		const text = ctx.message.text

		if (text.startsWith('/')) {
			return
		}

		await this.telegramService.handleRegistrationFlow(ctx, text)
	}
}
