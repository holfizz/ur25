import { AuthService } from '@/auth/auth.service'
import { S3Service } from '@/common/services/s3.service'
import { OfferService } from '@/offer/offer.service'
import { UserService } from '@/user/user.service'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TelegrafModule } from 'nestjs-telegraf'
import * as LocalSession from 'telegraf-session-local'
import { PrismaService } from '../prisma.service'
import { TelegramAuthService } from './services/auth.service'
import { TelegramMessageService } from './services/message.service'
import { TelegramOfferService } from './services/offer.service'
import { TelegramProfileService } from './services/profile.service'
import { TelegramRequestService } from './services/request.service'
import { TelegramClient } from './telegram.client'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'
import { TelegramUpdate } from './telegram.update'

const sessions = new LocalSession({ database: 'sessions.json' })

@Module({
	imports: [
		JwtModule.registerAsync({
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => ({
				secret: configService.get('JWT_SECRET'),
				signOptions: { expiresIn: '60d' },
			}),
			inject: [ConfigService],
		}),
		ConfigModule,
		TelegrafModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => ({
				token: configService.get('TELEGRAM_BOT_TOKEN'),
				middlewares: [sessions.middleware()],
			}),
			inject: [ConfigService],
		}),
	],
	controllers: [TelegramController],
	providers: [
		TelegramUpdate,
		TelegramService,
		TelegramAuthService,
		PrismaService,
		TelegramClient,
		OfferService,
		S3Service,
		TelegramOfferService,
		TelegramRequestService,
		TelegramMessageService,
		TelegramProfileService,
		AuthService,
		UserService,
	],
})
export class TelegramModule {}
