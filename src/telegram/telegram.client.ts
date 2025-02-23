import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Context, Telegraf } from 'telegraf'

@Injectable()
export class TelegramClient {
	private bot: Telegraf

	constructor(private configService: ConfigService) {
		this.bot = new Telegraf(this.configService.get('TELEGRAM_BOT_TOKEN'))
	}

	async sendMessage(chatId: string, message: string, extra?: any) {
		try {
			await this.bot.telegram.sendMessage(chatId, message, extra)
		} catch (error) {
			console.error('Error sending telegram message:', error)
		}
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
