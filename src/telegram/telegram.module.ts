import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TelegrafModule } from 'nestjs-telegraf'
import { PrismaService } from '../prisma.service'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'
import { TelegramServiceClient } from './telegram.service.client'

@Module({
	imports: [
		ConfigModule,
		TelegrafModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => ({
				token: configService.get<string>('TELEGRAM_BOT_TOKEN'),
				middlewares: [
					async (ctx, next) => {
						try {
							console.log('Incoming update:', ctx.update)
							await next()
						} catch (err) {
							console.error('Ошибка в middleware:', err)
						}
					},
				],
			}),
			inject: [ConfigService],
		}),
	],
	providers: [
		TelegramService,
		TelegramController,
		PrismaService,
		TelegramServiceClient,
	],
	exports: [TelegramService],
})
export class TelegramModule {}
