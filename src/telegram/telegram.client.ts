import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Context, Telegraf } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'

@Injectable()
export class TelegramClient {
	private bot: Telegraf<Context>

	constructor(private configService: ConfigService) {
		this.bot = new Telegraf(this.configService.get('TELEGRAM_BOT_TOKEN'))
	}

	async sendMessage(
		chatId: string,
		text: string,
		options?: any,
	): Promise<Message.TextMessage> {
		return this.bot.telegram.sendMessage(chatId, text, options)
	}

	async sendPhoto(
		chatId: string,
		photo: string,
		options?: any,
	): Promise<Message.PhotoMessage> {
		return this.bot.telegram.sendPhoto(chatId, photo, options)
	}

	async handleMenu(ctx: Context) {
		await ctx.reply('📱 Главное меню\n\nВыберите нужное действие:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: 'Создать объявление', callback_data: 'create_ad' },
						{ text: 'Мои объявления', callback_data: 'my_ads' },
					],
					[
						{ text: 'Профиль', callback_data: 'profile' },
						{ text: 'Помощь', callback_data: 'help' },
					],
					[{ text: 'Выйти', callback_data: 'logout' }],
				],
			},
		})
	}
}
