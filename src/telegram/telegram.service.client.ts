import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectBot } from 'nestjs-telegraf'
import { Context, Telegraf } from 'telegraf'

@Injectable()
export class TelegramServiceClient {
	constructor(
		@InjectBot() private bot: Telegraf<Context>,
		private configService: ConfigService,
	) {}

	async sendMessage(chatId: string, text: string) {
		try {
			await this.bot.telegram.sendMessage(chatId, text, {
				parse_mode: 'HTML',
			})
		} catch (error) {
			console.error('Error sending message:', error)
		}
	}

	async sendMessageWithKeyboard(chatId: string, text: string, keyboard: any) {
		try {
			await this.bot.telegram.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				reply_markup: keyboard,
			})
		} catch (error) {
			console.error('Error sending message with keyboard:', error)
		}
	}

	// Другие методы для отправки сообщений
}
