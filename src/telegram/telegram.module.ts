import { AuthService } from '@/auth/auth.service'
import { MailService } from '@/auth/mail.service'
import { OfferService } from '@/offer/offer.service'
import { UserService } from '@/user/user.service'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { TelegrafModule } from 'nestjs-telegraf'
import { S3Service } from '../common/services/s3.service'
import { PrismaService } from '../prisma.service'
import { CozeService } from '../services/coze.service'
import { TelegramAuthService } from './services/auth.service'
import { TelegramMessageService } from './services/message.service'
import { TelegramOfferService } from './services/offer.service'
import { TelegramProfileService } from './services/profile.service'
import { TelegramRequestService } from './services/request.service'
import { TelegramClient } from './telegram.client'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'
import { TelegramUpdate } from './telegram.update'

@Module({
	imports: [
		ConfigModule,
		TelegrafModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => {
				const token = configService.get<string>('TELEGRAM_BOT_TOKEN')

				return {
					token,
					include: [TelegramModule],
					options: {
						handlerTimeout: 60000,
					},
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
				}
			},
			inject: [ConfigService],
		}),
	],
	controllers: [TelegramController],
	providers: [
		TelegramUpdate,
		TelegramService,
		TelegramClient,
		TelegramOfferService,
		TelegramProfileService,
		PrismaService,
		S3Service,
		CozeService,
		TelegramAuthService,
		TelegramRequestService,
		TelegramMessageService,
		JwtService,
		OfferService,
		AuthService,
		UserService,
		MailService,
	],
	exports: [TelegramService, TelegramClient],
})
export class TelegramModule {}
