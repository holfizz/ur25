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
					bot_id: this.configService.get('COZE_BOT_ID'),
					user: 'user',
					query: question,
					stream: false,
					chat_history: [
						{
							role: 'assistant',
							type: 'context',
							content: context,
							content_type: 'text',
						},
					],
				},
				{
					headers: {
						Authorization: `Bearer ${this.configService.get('COZE_TOKEN')}`,
						'Content-Type': 'application/json',
						Accept: '*/*',
						Connection: 'keep-alive',
					},
				},
			)

			// Получаем ответ из сообщений
			const messages = response.data.messages
			const answer = messages.find(
				m => m.type === 'answer' && m.role === 'assistant',
			)

			return answer ? answer.content : 'Не удалось получить ответ от AI'
		} catch (error) {
			console.error('Ошибка при запросе к Coze API:', error)
			return 'Произошла ошибка при обработке запроса'
		}
	}
}
