import { Ctx, On, Start, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { TelegramService } from './telegram.service'

@Update()
export class TelegramUpdate {
	constructor(private readonly telegramService: TelegramService) {}

	@Start()
	async start(@Ctx() ctx: Context) {
		const chatId = ctx.message.chat.id.toString()
		const telegramId = ctx.message.from.id.toString()
		await this.telegramService.handleStart(telegramId, chatId)
	}

	@On('text')
	async onText(@Ctx() ctx: Context) {
		const message = ctx.message as Message.TextMessage
		if (!message?.text) return

		const userId = ctx.from.id
		const registrationState = this.telegramService.getRegistrationState(userId)

		if (registrationState) {
			// Если пользователь в процессе регистрации, передаем управление в сервис
			await this.telegramService.handleRegistrationFlow(ctx, message.text)
			return
		}

		// Здесь обработка обычных текстовых сообщений
		await ctx.reply(`Получено сообщение: ${message.text}`)
	}
}
