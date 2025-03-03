import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

@Injectable()
export class CozeService {
	private readonly apiUrl = 'https://api.coze.com/open_api/v2/chat'

	constructor(private configService: ConfigService) {}

	async generateResponse(context: string, question: string): Promise<string> {
		try {
			const response = await axios.post(
				this.apiUrl,
				{
					bot_id: this.configService.get('COZE_ANALYZER_BOT_ID'),
					messages: [
						{
							role: 'user',
							content: context,
						},
						{
							role: 'user',
							content: question,
						},
					],
				},
				{
					headers: {
						Authorization: `Bearer ${this.configService.get('COZE_TOKEN')}`,
						'Content-Type': 'application/json',
					},
				},
			)

			return response.data.messages[response.data.messages.length - 1].content
		} catch (error) {
			console.error('Ошибка при запросе к Coze API:', error)
			return ''
		}
	}
}
