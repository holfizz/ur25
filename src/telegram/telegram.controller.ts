import { Controller } from '@nestjs/common'
import { Command, Ctx, On, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { TelegramService } from './telegram.service'

@Update()
@Controller()
export class TelegramController {
	constructor(private readonly telegramService: TelegramService) {}

	@Command('start')
	async handleStart(@Ctx() ctx: Context) {
		await this.telegramService.handleStart(ctx)
	}

	@Command('menu')
	async handleMenu(@Ctx() ctx: Context) {
		await this.telegramService.handleMenu(ctx)
	}

	@On('text')
	async handleMessage(@Ctx() ctx: Context) {
		const message = ctx.message as Message.TextMessage
		await this.telegramService.handleTextInput(ctx)
	}
}
