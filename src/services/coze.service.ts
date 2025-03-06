import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

@Injectable()
export class CozeService {
	private readonly apiUrl = 'https://api.coze.com/open_api/v2/chat'

	constructor(private configService: ConfigService) {
		this.apiUrl = this.configService.get('COZE_API_URL') || this.apiUrl
	}

	// Метод для общего общения с ИИ
	async generateResponse(context: string, question: string): Promise<string> {
		try {
			// Объединяем контекст и вопрос в один запрос
			const fullQuery = `${context}\n\nВопрос: ${question}`
			const response = await axios.post(
				this.apiUrl,
				{
					bot_id: this.configService.get('COZE_BOT_ID'),
					user: 'telegram_user',
					query: fullQuery,
					stream: false,
				},
				{
					headers: {
						Authorization: `Bearer ${this.configService.get('COZE_TOKEN')}`,
						'Content-Type': 'application/json',
						Connection: 'keep-alive',
						Accept: '*/*',
					},
				},
			)

			console.log('Получен ответ от Coze API:', response)

			if (
				response.data &&
				response.data.messages &&
				response.data.messages.length > 0
			) {
				const answerMessage = response.data.messages.find(
					msg => msg.role === 'assistant' && msg.type === 'answer',
				)

				if (answerMessage) {
					return answerMessage.content
				}

				return response.data.messages[response.data.messages.length - 1].content
			}

			// Если не удалось найти ответ в ожидаемом формате
			console.error('Неверный формат ответа от Coze API:', response.data)
			return 'Извините, не удалось получить ответ от ИИ. Попробуйте переформулировать вопрос.'
		} catch (error) {
			console.error('Ошибка при запросе к Coze API:', {
				message: error.message,
				url: this.apiUrl,
				config: error.config,
				response: error.response?.data,
			})

			// Возвращаем понятное сообщение об ошибке вместо выброса исключения
			return 'Извините, произошла ошибка при обращении к ИИ. Пожалуйста, попробуйте позже.'
		}
	}

	// Метод для анализа объявлений
	async analyzeOffers(data: string): Promise<string> {
		try {
			console.log('Отправляем запрос к Coze API для анализа объявлений')

			// Отправляем запрос к Coze API
			const response = await axios.post(
				this.apiUrl,
				{
					bot_id: this.configService.get('COZE_ANALYZER_BOT_ID'),
					user: 'analyzer_bot', // Идентификатор пользователя
					query: data, // Данные для анализа
					stream: false, // Не использовать потоковую передачу
				},
				{
					headers: {
						Authorization: `Bearer ${this.configService.get('COZE_TOKEN')}`,
						'Content-Type': 'application/json',
						Connection: 'keep-alive',
						Accept: '*/*',
					},
				},
			)

			console.log(`Получен ответ от Coze API: ${response.status}`)
			console.log('Получен ответ от Coze API:', response.data)

			// Проверяем, что ответ содержит данные
			if (
				!response.data ||
				!response.data.messages ||
				!response.data.messages.length
			) {
				console.error('Пустой ответ от Coze API')
				return '{}'
			}

			// Находим ответ с типом 'answer'
			const answerMessage = response.data.messages.find(
				(msg: any) => msg.role === 'assistant' && msg.type === 'answer',
			)

			if (!answerMessage) {
				console.error('Не найден ответ с типом "answer" в ответе Coze API')
				return '{}'
			}

			return answerMessage.content
		} catch (error) {
			console.error('Ошибка при отправке запроса к Coze API:', error)
			return '{}'
		}
	}

	// Вспомогательный метод для обработки ошибок API
	private handleApiError(error: any): void {
		if (axios.isAxiosError(error)) {
			console.error('Ошибка Axios:', {
				status: error.response?.status,
				data: error.response?.data,
				message: error.message,
			})
		} else {
			console.error('Неизвестная ошибка:', error)
		}
	}

	// Добавляем метод sendMessage в CozeService
	async sendMessage(prompt: string): Promise<string> {
		try {
			// Используем существующий метод generateResponse
			return await this.generateResponse(
				prompt,
				'Ответь на запрос пользователя',
			)
		} catch (error) {
			console.error('Ошибка при отправке сообщения в Coze:', error)
			return ''
		}
	}
}
