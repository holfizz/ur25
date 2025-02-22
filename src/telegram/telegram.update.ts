import { PrismaService } from '@/prisma.service'
import { Ctx, On, Start, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { TelegramService } from './telegram.service'

@Update()
export class TelegramUpdate {
	constructor(
		private readonly telegramService: TelegramService,
		private readonly prisma: PrismaService,
	) {}

	@Start()
	async start(@Ctx() ctx: Context) {
		await this.telegramService.handleStart(ctx)
	}

	@On('text')
	async onText(@Ctx() ctx: Context) {
		const message = ctx.message as Message.TextMessage
		if (!message?.text) return

		const userId = ctx.from.id
		const user = await this.prisma.user.findUnique({
			where: { telegramId: userId.toString() },
		})

		if (!user?.isVerified) {
			await this.telegramService.handleRegistrationFlow(ctx, message.text)
			return
		}

		// Обработка текстового ввода для редактирования
		await this.telegramService.handleTextInput(ctx, message.text)
	}
}
